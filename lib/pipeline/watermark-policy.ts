// lib/pipeline/watermark-policy.ts
// Free-trial watermark rules (31 Oct 2026, Kadir): everything made before a
// user has bought any credit pack carries a small "Made with Norveko" badge;
// the first purchase removes it — also from work made earlier (see
// lib/pipeline/unwatermark.ts). Pure + env only, so it is safe for tests.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Path of the badge served from /public (rendered once from the BrandMark). */
export const WATERMARK_PUBLIC_PATH = "/brand/watermark.png";

function ids(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Internal/beta accounts (BETA_USER_IDS) never get the badge — their renders
 * become landing-page examples. WATERMARK_FORCE_USER_IDS forces it back on
 * for one of them to test the free-trial experience.
 */
export function isWatermarkExempt(userId: string): boolean {
  if (ids(process.env.WATERMARK_FORCE_USER_IDS).includes(userId)) return false;
  return ids(process.env.BETA_USER_IDS).includes(userId);
}

/** True when the user has at least one completed (non-refunded) credit purchase. */
export async function hasPurchased(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("credit_purchases")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "completed")
    .limit(1);
  if (error) {
    // Never watermark a paying customer because of a transient read error.
    console.warn(`[watermark] purchase lookup failed for ${userId}:`, error.message);
    return true;
  }
  return (data?.length ?? 0) > 0;
}

export async function needsWatermark(db: SupabaseClient, userId: string): Promise<boolean> {
  if (isWatermarkExempt(userId)) return false;
  return !(await hasPurchased(db, userId));
}
