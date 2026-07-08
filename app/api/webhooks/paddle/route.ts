// app/api/webhooks/paddle/route.ts
// Paddle webhook handler.
// - Raw body ile imza doğrulama (req.text() — ASLA req.json() kullanma)
// - transaction.completed -> kredi yükleme
// - Idempotency: credit_purchases.paddle_transaction_id UNIQUE

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  Paddle,
  EventName,
  Environment,
  type TransactionCompletedEvent,
} from "@paddle/paddle-node-sdk";
import { getPackageByPriceId } from "@/lib/packages";

export const runtime = "nodejs";

const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
  environment:
    process.env.PADDLE_ENV === "production"
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

  if (event.eventType === EventName.TransactionCompleted) {
    try {
      await handleTransactionCompleted(event as TransactionCompletedEvent);
    } catch (err) {
      console.error("[paddle-webhook] Handler error:", err);
      return NextResponse.json({ error: "Handler failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleTransactionCompleted(event: TransactionCompletedEvent) {
  const txn = event.data;
  const txnId = txn.id;

  const customData = txn.customData as { userId?: string } | null;
  const userId = customData?.userId;
  if (!userId) {
    console.error(`[paddle-webhook] ${txnId}: customData.userId missing`);
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
}
