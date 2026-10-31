// lib/pipeline/trial.ts
// Free-trial video entitlement: one 30-second video per account that has not
// bought a credit pack yet (beta/internal accounts excluded — they test the
// paid experience). Used by /api/features (UI) and /api/pipeline/start (charge).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPurchased, isForcedTrialUser, isWatermarkExempt } from "./watermark-policy";
import { trialUsedElsewhere, type AbuseContext } from "./abuse";

export async function hasUsedTrialVideo(db: SupabaseClient, userId: string): Promise<boolean> {
  const { count, error } = await db
    .from("pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("options->>trialVideo", "true");
  if (error) {
    console.warn(`[trial] lookup failed for ${userId}:`, error.message);
    return true; // fail closed: never hand out a second free video by accident
  }
  return (count ?? 0) > 0;
}

/**
 * ctx (e-mail + IP) adds the cross-account checks from lib/pipeline/abuse.ts:
 * no trial for throwaway inboxes, once per normalised e-mail and per IP (30 days).
 */
export async function trialVideoAvailable(db: SupabaseClient, userId: string, ctx: AbuseContext = {}): Promise<boolean> {
  if (isForcedTrialUser(userId)) return !(await hasUsedTrialVideo(db, userId));
  if (isWatermarkExempt(userId)) return false;
  if (await hasPurchased(db, userId)) return false;
  if (await hasUsedTrialVideo(db, userId)) return false;
  return !(await trialUsedElsewhere(db, userId, ctx));
}

/** Account that hasn't bought a pack and isn't a beta/internal account. */
export async function isFreeAccount(db: SupabaseClient, userId: string): Promise<boolean> {
  if (isForcedTrialUser(userId)) return true;
  if (isWatermarkExempt(userId)) return false;
  return !(await hasPurchased(db, userId));
}
