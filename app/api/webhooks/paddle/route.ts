// app/api/webhooks/paddle/route.ts
// Paddle webhook handler.
// - Signature verification on the raw body (req.text() — NEVER req.json())
// - transaction.completed  -> grant credits (idempotent via
//   credit_purchases.paddle_transaction_id UNIQUE)
// - adjustment.created / adjustment.updated with action "refund" and status
//   "approved" -> revoke the purchased credits once (idempotent via
//   credit_purchases.status transition completed -> refunded)

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  Paddle,
  EventName,
  Environment,
  type TransactionCompletedEvent,
  type AdjustmentCreatedEvent,
  type AdjustmentUpdatedEvent,
  type SubscriptionCreatedEvent,
  type SubscriptionUpdatedEvent,
} from "@paddle/paddle-node-sdk";
import { getPackageByPriceId } from "@/lib/packages";
import { getPaddleEnvironment } from "@/lib/paddle-env";

export const runtime = "nodejs";

const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
  environment:
    getPaddleEnvironment() === "production"
      ? Environment.production
      : Environment.sandbox,
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function POST(req: Request) {
  const signature = req.headers.get("paddle-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event;
  try {
    event = await paddle.webhooks.unmarshal(
      rawBody,
      process.env.PADDLE_WEBHOOK_SECRET!,
      signature
    );
  } catch (err) {
    console.error("[paddle-webhook] Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.eventType) {
      case EventName.TransactionCompleted:
        await handleTransactionCompleted(event as TransactionCompletedEvent);
        break;
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionPastDue:
        await handleSubscription(event as SubscriptionCreatedEvent | SubscriptionUpdatedEvent);
        break;
      case EventName.AdjustmentCreated:
      case EventName.AdjustmentUpdated:
        await handleAdjustment(
          event as AdjustmentCreatedEvent | AdjustmentUpdatedEvent
        );
        break;
      default:
        // Other events are acknowledged but ignored.
        break;
    }
  } catch (err) {
    console.error(`[paddle-webhook] ${event.eventType} handler error:`, err);
    // 500 makes Paddle retry the delivery, which is what we want for
    // transient DB failures. Idempotency guards make retries safe.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** Returns true when the id belongs to a real auth user. */
async function userExists(userId: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return false;
  }
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  return !error && Boolean(data?.user);
}

async function handleTransactionCompleted(event: TransactionCompletedEvent) {
  const txn = event.data;
  const txnId = txn.id;

  const customData = txn.customData as { userId?: string } | null;

  // Subscription payments (first payment and every renewal).
  if (txn.subscriptionId) {
    const claimed = customData?.userId && (await userExists(customData.userId)) ? customData.userId : null;
    const { grantForTransaction } = await import("@/lib/subscriptions-server");
    const result = await grantForTransaction(supabaseAdmin, {
      id: txnId,
      subscriptionId: txn.subscriptionId,
      priceId: txn.items?.[0]?.price?.id ?? null,
      userId: claimed,
      customerId: txn.customerId ?? null,
      billedAt: txn.billedAt ?? null,
    });
    if (result.status === "granted") {
      console.log(`[paddle-webhook] ${txnId}: subscription ${txn.subscriptionId} +${result.credits} credits`);
      await liftWatermarks(customData?.userId ?? null, txn.subscriptionId, txnId);
    } else {
      console.log(`[paddle-webhook] ${txnId}: subscription grant ${result.status}`);
    }
    return;
  }

  const userId = customData?.userId;
  if (!userId) {
    console.error(`[paddle-webhook] ${txnId}: customData.userId missing`);
    return;
  }

  // customData is set client-side at checkout, so never trust it blindly.
  if (!(await userExists(userId))) {
    console.error(`[paddle-webhook] ${txnId}: unknown userId ${userId}`);
    return;
  }

  const priceId = txn.items?.[0]?.price?.id;
  const pkg = priceId ? getPackageByPriceId(priceId) : undefined;
  if (!pkg) {
    console.error(`[paddle-webhook] ${txnId}: unknown priceId ${priceId}`);
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from("credit_purchases")
    .insert({
      user_id: userId,
      paddle_transaction_id: txnId,
      package_id: pkg.id,
      credits: pkg.credits,
      amount_usd: pkg.priceUsd,
      status: "completed",
    });

  if (insertError) {
    if (insertError.code === "23505") {
      console.log(`[paddle-webhook] ${txnId}: already processed, skipping`);
      return;
    }
    throw insertError;
  }

  const { error: rpcError } = await supabaseAdmin.rpc("add_credits", {
    p_user_id: userId,
    p_amount: pkg.credits,
    p_type: "purchase",
    p_reason: `Paddle purchase: ${pkg.name} (${txnId})`,
  });

  if (rpcError) {
    console.error(
      `[paddle-webhook] ${txnId}: add_credits FAILED for user ${userId}:`,
      rpcError
    );
    throw rpcError;
  }

  console.log(
    `[paddle-webhook] ${txnId}: +${pkg.credits} credits -> user ${userId}`
  );

  // Invite & earn: the inviter gets a share of the credits (idempotent per transaction).
  try {
    const { rewardReferrer } = await import("@/lib/referrals/referrals");
    const reward = await rewardReferrer(supabaseAdmin, { referredUserId: userId, transactionId: txnId, credits: pkg.credits, packName: pkg.name, netUsd: pkg.priceUsd * 0.95 - 0.5 });
    if (reward) console.log(`[paddle-webhook] ${txnId}: referral +${reward.credits} credits -> user ${reward.referrer}`);
  } catch (err) {
    console.error(`[paddle-webhook] ${txnId}: referral reward failed:`, err);
  }

  // First purchase lifts the free-trial watermark, also on earlier work.
  // Never fail the webhook over it (credits are already granted).
  try {
    const { removeWatermarksForUser } = await import("@/lib/pipeline/unwatermark");
    const result = await removeWatermarksForUser(userId);
    console.log(`[paddle-webhook] ${txnId}: watermark removed from ${result.projects} projects, ${result.rerenders} clean re-renders`);
  } catch (err) {
    console.error(`[paddle-webhook] ${txnId}: watermark removal failed:`, err);
  }
}

/** First paid subscription also lifts the free-trial watermark. */
async function liftWatermarks(claimedUserId: string | null, subscriptionId: string, txnId: string) {
  try {
    const { data } = await supabaseAdmin.from("subscriptions").select("user_id").eq("paddle_subscription_id", subscriptionId).maybeSingle();
    const userId = (data?.user_id as string | undefined) ?? claimedUserId;
    if (!userId) return;
    const { removeWatermarksForUser } = await import("@/lib/pipeline/unwatermark");
    await removeWatermarksForUser(userId);
  } catch (err) {
    console.error(`[paddle-webhook] ${txnId}: watermark removal failed:`, err);
  }
}

async function handleSubscription(event: SubscriptionCreatedEvent | SubscriptionUpdatedEvent) {
  const sub = event.data;
  const claimed = (sub.customData as { userId?: string } | null)?.userId ?? null;
  const userId = claimed && (await userExists(claimed)) ? claimed : null;
  const { syncSubscription } = await import("@/lib/subscriptions-server");
  const result = await syncSubscription(supabaseAdmin, {
    id: sub.id,
    status: sub.status,
    customerId: sub.customerId ?? null,
    priceId: sub.items?.[0]?.price?.id ?? null,
    userId,
    periodEnd: sub.currentBillingPeriod?.endsAt ?? null,
    scheduledCancelAt: sub.scheduledChange?.action === "cancel" ? sub.scheduledChange.effectiveAt : null,
  });
  console.log(`[paddle-webhook] ${event.eventType} ${sub.id}: ${sub.status} (${result})`);
}

/**
 * A refund in Paddle arrives as an adjustment on the original transaction.
 * When it is approved we take the purchased credits back. The
 * completed -> refunded status transition on credit_purchases is the
 * idempotency guard, so repeated deliveries are harmless.
 */
async function handleAdjustment(
  event: AdjustmentCreatedEvent | AdjustmentUpdatedEvent
) {
  const adjustment = event.data;
  if (adjustment.action !== "refund" || adjustment.status !== "approved") {
    return;
  }

  const txnId = adjustment.transactionId;

  const { data: purchase, error: updateError } = await supabaseAdmin
    .from("credit_purchases")
    .update({ status: "refunded" })
    .eq("paddle_transaction_id", txnId)
    .eq("status", "completed")
    .select("user_id, credits, package_id")
    .maybeSingle();

  if (updateError) throw updateError;

  if (!purchase) {
    console.log(
      `[paddle-webhook] refund ${adjustment.id}: no completed purchase for ${txnId}, skipping`
    );
    return;
  }

  // Take back what was granted. The balance may go negative if the user
  // already spent the credits; that is the intended outcome of a refund.
  const { error: rpcError } = await supabaseAdmin.rpc("add_credits", {
    p_user_id: purchase.user_id,
    p_amount: -purchase.credits,
    p_type: "refund",
    p_reason: `Paddle refund: ${purchase.package_id} (${txnId})`,
  });

  if (rpcError) {
    // Roll the status back so the next delivery retries the revoke.
    await supabaseAdmin
      .from("credit_purchases")
      .update({ status: "completed" })
      .eq("paddle_transaction_id", txnId)
      .eq("status", "refunded");
    throw rpcError;
  }

  console.log(
    `[paddle-webhook] refund ${adjustment.id}: -${purchase.credits} credits <- user ${purchase.user_id}`
  );

  try {
    const { stopYearlyGrants } = await import("@/lib/subscriptions-server");
    await stopYearlyGrants(supabaseAdmin, txnId);
  } catch (err) {
    console.error(`[paddle-webhook] refund ${adjustment.id}: stopping yearly grants failed:`, err);
  }

  try {
    const { revokeReferralReward } = await import("@/lib/referrals/referrals");
    const taken = await revokeReferralReward(supabaseAdmin, txnId);
    if (taken) console.log(`[paddle-webhook] refund ${adjustment.id}: referral reward -${taken} reversed`);
  } catch (err) {
    console.error(`[paddle-webhook] refund ${adjustment.id}: referral reversal failed:`, err);
  }
}
