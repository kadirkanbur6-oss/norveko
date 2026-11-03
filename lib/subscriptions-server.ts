// lib/subscriptions-server.ts
// Server side of subscriptions (lib/subscriptions.ts): keeps public.subscriptions
// in sync with Paddle webhooks and grants credits.
//
//   transaction.completed (with subscription_id) → grantForTransaction():
//     credit_purchases row (idempotent on the Paddle transaction id; the existing
//     refund flow, watermark removal and "has purchased" checks all reuse it),
//     add_credits, referral reward. Yearly plans: this is month 1 of 12; the
//     other 11 come from runSubscriptionGrants() (hourly cron) one month apart.
//   subscription.* → syncSubscription(): status, period end, scheduled cancel.
//   refund → stopYearlyGrants().
//
// Plan credits don't roll over (3 Nov 2026, Kadir): every grant is valid for one
// period (a week, or a month — yearly plans grant monthly). Plan credits are
// spent before pack credits, so when a grant expires, whatever is left of it
// (grant − net spending since it arrived, never more than the balance) is
// removed with an "expire" transaction. One-time packs never expire.
//
// Tables (SQL in supabase/README.md, service role only):
//   subscriptions       (paddle_subscription_id pk, user_id, plan_id, status, …)
//   subscription_grants (grant_key pk, user_id, paddle_subscription_id, credits)

import type { SupabaseClient } from "@supabase/supabase-js";
import { addOneMonth, getSubscriptionPlan, getSubscriptionPlanByPriceId, type SubscriptionPlan } from "./subscriptions";

/** When a grant of this plan, made at `from`, stops being usable. */
export function grantExpiry(plan: SubscriptionPlan, from: Date): Date {
  return plan.period === "week" ? new Date(from.getTime() + 7 * 86400_000) : addOneMonth(from);
}

/**
 * Remove the unused part of every plan grant whose period has ended.
 * Idempotent: each grant is expired once (expired_at). Returns credits removed.
 */
export async function expireSubscriptionCredits(db: SupabaseClient, now = new Date(), userId?: string): Promise<number> {
  let q = db
    .from("subscription_grants")
    .select("grant_key, user_id, credits, created_at, expires_at")
    .is("expired_at", null)
    .not("expires_at", "is", null)
    .lte("expires_at", now.toISOString())
    .order("expires_at")
    .limit(500);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) {
    console.warn("[subscriptions] expiry lookup failed:", error.message);
    return 0;
  }
  let removed = 0;
  for (const g of (data ?? []) as Array<{ grant_key: string; user_id: string; credits: number; created_at: string; expires_at: string }>) {
    // Claim first so two runs never expire the same grant twice.
    const { data: claimed } = await db
      .from("subscription_grants")
      .update({ expired_at: now.toISOString(), expired_credits: 0 })
      .eq("grant_key", g.grant_key)
      .is("expired_at", null)
      .select("grant_key")
      .maybeSingle();
    if (!claimed) continue;
    const { data: tx } = await db
      .from("credit_transactions")
      .select("amount, type")
      .eq("user_id", g.user_id)
      .in("type", ["spend", "refund"])
      .gte("created_at", g.created_at)
      .lt("created_at", g.expires_at);
    const spent = -((tx ?? []) as Array<{ amount: number }>).reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const { data: bal } = await db.from("user_credits").select("credits").eq("user_id", g.user_id).maybeSingle();
    const balance = Number(bal?.credits ?? 0);
    const amount = Math.max(0, Math.min(g.credits - Math.max(0, spent), balance));
    if (amount > 0) {
      const { error: expErr } = await db.rpc("add_credits", {
        p_user_id: g.user_id,
        p_amount: -amount,
        p_type: "expire",
        p_reason: "Unused plan credits expired (plan credits don't roll over)",
      });
      if (expErr) {
        // Try again next run.
        await db.from("subscription_grants").update({ expired_at: null }).eq("grant_key", g.grant_key);
        console.error(`[subscriptions] expiring ${g.grant_key} failed:`, expErr.message);
        continue;
      }
      removed += amount;
    }
    await db.from("subscription_grants").update({ expired_credits: amount }).eq("grant_key", g.grant_key);
  }
  return removed;
}

export interface SubscriptionRow {
  paddle_subscription_id: string;
  user_id: string;
  plan_id: string;
  status: string;
  customer_id: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  next_grant_at: string | null;
  year_grants_left: number;
  updated_at?: string;
}

const ACTIVE = ["active", "trialing", "past_due"];

export async function subscriptionForUser(db: SupabaseClient, userId: string): Promise<SubscriptionRow | null> {
  const { data } = await db
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(5);
  const rows = (data ?? []) as SubscriptionRow[];
  return rows.find((r) => ACTIVE.includes(r.status)) ?? rows[0] ?? null;
}

export function isActive(row: SubscriptionRow | null): boolean {
  return Boolean(row && ACTIVE.includes(row.status));
}

/** Upsert from a subscription.* event. Unknown user → ignored (logged by caller). */
export async function syncSubscription(
  db: SupabaseClient,
  sub: {
    id: string;
    status: string;
    customerId: string | null;
    priceId: string | null;
    userId: string | null;
    periodEnd: string | null;
    scheduledCancelAt: string | null;
  }
): Promise<"ok" | "no_user" | "unknown_plan"> {
  const { data: existing } = await db.from("subscriptions").select("*").eq("paddle_subscription_id", sub.id).maybeSingle();
  const userId = (existing as SubscriptionRow | null)?.user_id ?? sub.userId;
  if (!userId) return "no_user";
  const plan = getSubscriptionPlanByPriceId(sub.priceId) ?? getSubscriptionPlan((existing as SubscriptionRow | null)?.plan_id);
  if (!plan) return "unknown_plan";
  const { error } = await db.from("subscriptions").upsert({
    paddle_subscription_id: sub.id,
    user_id: userId,
    plan_id: plan.id,
    status: sub.status,
    customer_id: sub.customerId,
    current_period_end: sub.periodEnd,
    cancel_at: sub.scheduledCancelAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return "ok";
}

async function addCredits(db: SupabaseClient, userId: string, credits: number, reason: string) {
  const { error } = await db.rpc("add_credits", { p_user_id: userId, p_amount: credits, p_type: "purchase", p_reason: reason });
  if (error) throw new Error(error.message);
}

async function payReferral(db: SupabaseClient, userId: string, grantKey: string, credits: number, plan: SubscriptionPlan) {
  try {
    const { rewardReferrer } = await import("./referrals/referrals");
    await rewardReferrer(db, { referredUserId: userId, transactionId: grantKey, credits, packName: `${plan.name} subscription` });
  } catch (err) {
    console.error(`[subscriptions] referral reward for ${grantKey} failed:`, err);
  }
}

export type GrantResult = { status: "granted"; plan: SubscriptionPlan; credits: number } | { status: "duplicate" | "unknown_plan" | "no_user" };

/** A paid subscription transaction (first payment or renewal). Idempotent per transaction. */
export async function grantForTransaction(
  db: SupabaseClient,
  txn: { id: string; subscriptionId: string; priceId: string | null; userId: string | null; customerId: string | null; billedAt: string | null }
): Promise<GrantResult> {
  const plan = getSubscriptionPlanByPriceId(txn.priceId);
  if (!plan) return { status: "unknown_plan" };
  const { data: existing } = await db.from("subscriptions").select("*").eq("paddle_subscription_id", txn.subscriptionId).maybeSingle();
  const userId = (existing as SubscriptionRow | null)?.user_id ?? txn.userId;
  if (!userId) return { status: "no_user" };

  const { error: insertError } = await db.from("credit_purchases").insert({
    user_id: userId,
    paddle_transaction_id: txn.id,
    package_id: plan.id,
    credits: plan.credits,
    amount_usd: plan.priceUsd,
    status: "completed",
  });
  if (insertError) {
    if (insertError.code === "23505") return { status: "duplicate" };
    throw new Error(insertError.message);
  }
  const billedAt = txn.billedAt ? new Date(txn.billedAt) : new Date();
  // The last period's leftover plan credits go before this period's arrive.
  await expireSubscriptionCredits(db, new Date(Math.max(Date.now(), billedAt.getTime())), userId);
  try {
    await addCredits(db, userId, plan.credits, `${plan.name} ${plan.period}ly plan (${txn.id})`);
  } catch (err) {
    // Let Paddle retry: remove the guard row so the next delivery grants again.
    await db.from("credit_purchases").delete().eq("paddle_transaction_id", txn.id);
    throw err;
  }
  await db.from("subscription_grants").insert({
    grant_key: txn.id,
    user_id: userId,
    paddle_subscription_id: txn.subscriptionId,
    credits: plan.credits,
    expires_at: grantExpiry(plan, billedAt).toISOString(),
  });

  const billed = txn.billedAt ? new Date(txn.billedAt) : new Date();
  await db.from("subscriptions").upsert({
    paddle_subscription_id: txn.subscriptionId,
    user_id: userId,
    plan_id: plan.id,
    status: (existing as SubscriptionRow | null)?.status ?? "active",
    customer_id: txn.customerId ?? (existing as SubscriptionRow | null)?.customer_id ?? null,
    current_period_end: (existing as SubscriptionRow | null)?.current_period_end ?? null,
    cancel_at: (existing as SubscriptionRow | null)?.cancel_at ?? null,
    // Yearly: 11 more monthly grants for this paid year.
    next_grant_at: plan.period === "year" ? addOneMonth(billed).toISOString() : null,
    year_grants_left: plan.period === "year" ? 11 : 0,
    updated_at: new Date().toISOString(),
  });
  await payReferral(db, userId, txn.id, plan.credits, plan);
  return { status: "granted", plan, credits: plan.credits };
}

/** Hourly: the monthly credits of yearly plans. Idempotent per (subscription, month). */
export async function runSubscriptionGrants(db: SupabaseClient, now = new Date()): Promise<{ granted: number }> {
  const { data } = await db
    .from("subscriptions")
    .select("*")
    .gt("year_grants_left", 0)
    .lte("next_grant_at", now.toISOString())
    .limit(200);
  let granted = 0;
  for (const row of (data ?? []) as SubscriptionRow[]) {
    const plan = getSubscriptionPlan(row.plan_id);
    if (!plan || plan.period !== "year" || !row.next_grant_at) continue;
    // Several months may be due if the cron was down: grant each one once.
    let due = new Date(row.next_grant_at);
    let left = row.year_grants_left;
    while (left > 0 && due.getTime() <= now.getTime()) {
      const key = `${row.paddle_subscription_id}:${due.toISOString().slice(0, 10)}`;
      await expireSubscriptionCredits(db, due, row.user_id);
      const { error } = await db.from("subscription_grants").insert({
        grant_key: key,
        user_id: row.user_id,
        paddle_subscription_id: row.paddle_subscription_id,
        credits: plan.credits,
        expires_at: addOneMonth(due).toISOString(),
      });
      if (!error) {
        try {
          await addCredits(db, row.user_id, plan.credits, `${plan.name} yearly plan — monthly credits`);
          granted++;
          await payReferral(db, row.user_id, key, plan.credits, plan);
        } catch (err) {
          await db.from("subscription_grants").delete().eq("grant_key", key);
          throw err;
        }
      } else if (error.code !== "23505") {
        throw new Error(error.message);
      }
      left -= 1;
      due = addOneMonth(due);
    }
    await db
      .from("subscriptions")
      .update({ year_grants_left: left, next_grant_at: left > 0 ? due.toISOString() : null, updated_at: new Date().toISOString() })
      .eq("paddle_subscription_id", row.paddle_subscription_id);
  }
  return { granted };
}

/** A refunded subscription payment: no more monthly grants from that year. */
export async function stopYearlyGrants(db: SupabaseClient, transactionId: string): Promise<void> {
  const { data } = await db.from("subscription_grants").select("paddle_subscription_id").eq("grant_key", transactionId).maybeSingle();
  if (!data?.paddle_subscription_id) return;
  await db
    .from("subscriptions")
    .update({ year_grants_left: 0, next_grant_at: null, updated_at: new Date().toISOString() })
    .eq("paddle_subscription_id", data.paddle_subscription_id);
}
