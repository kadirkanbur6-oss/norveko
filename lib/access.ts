// lib/access.ts
// Admin-granted access that used to live only in Vercel env allowlists
// (BETA_USER_IDS, FULL_VIDEO_BETA_USER_IDS). The owner grants it from /admin
// into the `user_access` table (SQL in supabase/README.md); the env lists keep
// working alongside.
//
// The gate functions in lib/pipeline/features.ts and watermark-policy.ts are
// synchronous and called from many routes, so the grants are read into a small
// per-instance cache (refreshed at most once a minute) by `loadAccess()`,
// which runs inside requireUser() — i.e. before any gate check in a request.
// Background work (series tick, heartbeat) calls loadAccess() itself.
//
// No "server-only" import here: watermark-policy.ts is covered by node tests.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UserAccess {
  user_id: string;
  beta: boolean;
  full_video: boolean;
  note: string | null;
  updated_at: string;
}

const TTL_MS = 60_000;

const cache = {
  loadedAt: 0,
  beta: new Set<string>(),
  fullVideo: new Set<string>(),
  pending: null as Promise<void> | null,
};

/** Refresh the grants cache when it is older than a minute. Never throws. */
export async function loadAccess(db: SupabaseClient, force = false): Promise<void> {
  if (!force && Date.now() - cache.loadedAt < TTL_MS) return;
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    try {
      const { data, error } = await db.from("user_access").select("user_id, beta, full_video");
      if (error) {
        // Table missing (not created yet) or a transient read error: keep what we have.
        if (!/does not exist|relation/i.test(error.message)) console.warn("[access] load failed:", error.message);
        return;
      }
      const beta = new Set<string>();
      const fullVideo = new Set<string>();
      for (const row of (data ?? []) as Array<{ user_id: string; beta: boolean; full_video: boolean }>) {
        if (row.beta) beta.add(row.user_id);
        if (row.full_video) fullVideo.add(row.user_id);
      }
      cache.beta = beta;
      cache.fullVideo = fullVideo;
      cache.loadedAt = Date.now();
    } finally {
      cache.pending = null;
    }
  })();
  return cache.pending;
}

/** Forget the cache (after an admin change) so the next loadAccess() re-reads. */
export function invalidateAccess(): void {
  cache.loadedAt = 0;
}

/** Granted "beta" from the admin panel (same rights as BETA_USER_IDS). */
export function hasBetaGrant(userId: string | null | undefined): boolean {
  return Boolean(userId) && cache.beta.has(userId as string);
}

/** Granted full-video access from the admin panel (same as FULL_VIDEO_BETA_USER_IDS). */
export function hasFullVideoGrant(userId: string | null | undefined): boolean {
  return Boolean(userId) && cache.fullVideo.has(userId as string);
}

/** Every grant row, for the admin panel. [] when the table does not exist yet. */
export async function listAccess(db: SupabaseClient): Promise<UserAccess[]> {
  const { data, error } = await db.from("user_access").select("user_id, beta, full_video, note, updated_at");
  if (error) return [];
  return (data ?? []) as UserAccess[];
}

/** Set a user's grants (admin panel). Creates the row when needed. */
export async function setAccess(
  db: SupabaseClient,
  userId: string,
  patch: { beta?: boolean; full_video?: boolean; note?: string | null },
  updatedBy: string
): Promise<UserAccess> {
  const { data: current } = await db.from("user_access").select("user_id, beta, full_video, note").eq("user_id", userId).maybeSingle();
  const row = {
    user_id: userId,
    beta: patch.beta ?? Boolean(current?.beta),
    full_video: patch.full_video ?? Boolean(current?.full_video),
    note: patch.note === undefined ? ((current?.note as string | null) ?? null) : patch.note,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db.from("user_access").upsert(row, { onConflict: "user_id" }).select("user_id, beta, full_video, note, updated_at").single();
  if (error) throw new Error(error.message);
  invalidateAccess();
  await loadAccess(db, true);
  return data as UserAccess;
}
