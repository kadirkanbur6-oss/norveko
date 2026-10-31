// lib/referrals/referrals.ts
// Invite & earn (31 Oct 2026). Every account gets a link norveko.app/?ref=<code>.
// The middleware keeps the code in a cookie (nv_ref, 60 days); right after the
// invited person's first sign-in the dashboard claims it (/api/referrals/claim).
// The inviter then earns REFERRAL_SHARE of the credits of every pack the invited
// account buys during its first REFERRAL_MONTHS months — paid in credits, taken
// back if Paddle refunds the purchase. Only purchases pay out, so fake sign-ups
// earn nothing.
//
// Tables (SQL in supabase/README.md, service role only):
//   referral_codes   (user_id pk, code unique)
//   referrals        (referred_user_id pk, referrer_user_id, code, created_at)
//   referral_rewards (paddle_transaction_id pk, referrer/referred, credits, status)

import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const REFERRAL_COOKIE = "nv_ref";
export const REFERRAL_COOKIE_DAYS = 60;
export const REFERRAL_SHARE = 0.2;
export const REFERRAL_MONTHS = 12;
/** A claim must happen soon after sign-up (an old account can't be "referred"). */
export const CLAIM_WINDOW_DAYS = 7;

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function isReferralCode(v: unknown): v is string {
  return typeof v === "string" && /^[a-z0-9]{6,12}$/.test(v);
}

export function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function rewardFor(credits: number): number {
  return Math.floor(credits * REFERRAL_SHARE);
}

/** The user's code, created on first use. */
export async function codeFor(db: SupabaseClient, userId: string): Promise<string> {
  const { data } = await db.from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
  if (data?.code) return data.code as string;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const { error } = await db.from("referral_codes").insert({ user_id: userId, code });
    if (!error) return code;
    if (error.code !== "23505") throw new Error(error.message);
    // Either the code collided or a parallel request created ours: re-read.
    const again = await db.from("referral_codes").select("code").eq("user_id", userId).maybeSingle();
    if (again.data?.code) return again.data.code as string;
  }
  throw new Error("Could not create a referral code.");
}

export type ClaimResult = "claimed" | "no_code" | "own_code" | "already" | "too_old" | "has_purchases";

/** Link a new account to its inviter. */
export async function claimReferral(
  db: SupabaseClient,
  user: { id: string; created_at?: string },
  code: string,
  now = new Date()
): Promise<ClaimResult> {
  const { data: owner } = await db.from("referral_codes").select("user_id").eq("code", code).maybeSingle();
  if (!owner?.user_id) return "no_code";
  if (owner.user_id === user.id) return "own_code";
  const created = user.created_at ? new Date(user.created_at).getTime() : 0;
  if (!created || now.getTime() - created > CLAIM_WINDOW_DAYS * 86_400_000) return "too_old";
  const { count } = await db
    .from("credit_purchases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) > 0) return "has_purchases";
  const { error } = await db
    .from("referrals")
    .insert({ referred_user_id: user.id, referrer_user_id: owner.user_id, code, created_at: now.toISOString() });
  if (error) {
    if (error.code === "23505") return "already";
    throw new Error(error.message);
  }
  return "claimed";
}

/** Paddle purchase completed: pay the inviter (idempotent per transaction). */
export async function rewardReferrer(
  db: SupabaseClient,
  args: { referredUserId: string; transactionId: string; credits: number; packName: string },
  now = new Date()
): Promise<{ referrer: string; credits: number } | null> {
  const { data: ref } = await db
    .from("referrals")
    .select("referrer_user_id, created_at")
    .eq("referred_user_id", args.referredUserId)
    .maybeSingle();
  if (!ref) return null;
  const ageMonths = (now.getTime() - new Date(ref.created_at as string).getTime()) / (30.44 * 86_400_000);
  if (ageMonths > REFERRAL_MONTHS) return null;
  const credits = rewardFor(args.credits);
  if (credits <= 0) return null;
  const { error } = await db.from("referral_rewards").insert({
    paddle_transaction_id: args.transactionId,
    referrer_user_id: ref.referrer_user_id,
    referred_user_id: args.referredUserId,
    credits,
    status: "earned",
  });
  if (error) {
    if (error.code === "23505") return null; // already paid for this transaction
    throw new Error(error.message);
  }
  const { error: rpcError } = await db.rpc("add_credits", {
    p_user_id: ref.referrer_user_id,
    p_amount: credits,
    p_type: "referral",
    p_reason: `Referral reward: a friend bought ${args.packName}`,
  });
  if (rpcError) {
    await db.from("referral_rewards").delete().eq("paddle_transaction_id", args.transactionId);
    throw new Error(rpcError.message);
  }
  return { referrer: ref.referrer_user_id as string, credits };
}

/** Paddle refund: take the inviter's reward for that purchase back. */
export async function revokeReferralReward(db: SupabaseClient, transactionId: string): Promise<number> {
  const { data: reward } = await db
    .from("referral_rewards")
    .update({ status: "refunded" })
    .eq("paddle_transaction_id", transactionId)
    .eq("status", "earned")
    .select("referrer_user_id, credits")
    .maybeSingle();
  if (!reward) return 0;
  const { error } = await db.rpc("add_credits", {
    p_user_id: reward.referrer_user_id,
    p_amount: -Number(reward.credits),
    p_type: "refund",
    p_reason: "Referral reward reversed: the friend's purchase was refunded",
  });
  if (error) {
    await db.from("referral_rewards").update({ status: "earned" }).eq("paddle_transaction_id", transactionId);
    throw new Error(error.message);
  }
  return Number(reward.credits);
}

export async function referralStats(db: SupabaseClient, userId: string) {
  const [{ count: signups }, { data: rewards }] = await Promise.all([
    db.from("referrals").select("referred_user_id", { count: "exact", head: true }).eq("referrer_user_id", userId),
    db.from("referral_rewards").select("referred_user_id, credits, status").eq("referrer_user_id", userId),
  ]);
  const earned = (rewards ?? []).filter((r: { status: string }) => r.status === "earned");
  return {
    signups: signups ?? 0,
    buyers: new Set(earned.map((r: { referred_user_id: string }) => r.referred_user_id)).size,
    creditsEarned: earned.reduce((n: number, r: { credits: number }) => n + Number(r.credits), 0),
  };
}
