// lib/api-keys.ts
// Norveko API keys (2 Nov 2026): `Authorization: Bearer nv_live_…` on /api/v1/*.
// Only a SHA-256 hash of each key is stored; the key is shown once at creation.
// Requests made with a key run as that user: `withApiUser()` sets the user for
// the duration of the call and `requireUser()` (lib/supabase-server.ts) uses it.

import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export const API_KEY_PREFIX = "nv_live_";
export const MAX_API_KEYS = 5;

const store = new AsyncLocalStorage<User>();

/** The user an API-key request runs as (null for normal cookie sessions). */
export function apiUser(): User | null {
  return store.getStore() ?? null;
}

export function withApiUser<T>(user: User, fn: () => Promise<T>): Promise<T> {
  return store.run(user, fn);
}

export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function newApiKey(): { key: string; prefix: string; hash: string } {
  const key = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), hash: hashKey(key) };
}

/** Resolve `Authorization: Bearer nv_live_…` to its user (null if missing/unknown/revoked). */
export async function userFromApiKey(req: Request): Promise<User | null> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.match(/^Bearer\s+(nv_live_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!key) return null;
  const db = adminDb();
  const { data } = await db.from("api_keys").select("id, user_id, revoked_at").eq("key_hash", hashKey(key)).maybeSingle();
  if (!data || data.revoked_at) return null;
  const { data: auth } = await db.auth.admin.getUserById(data.user_id as string);
  if (!auth?.user) return null;
  // Best effort, never blocks the request.
  void db.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return auth.user;
}

/** API access: accounts that bought a pack/plan (or beta testers). */
export async function apiAllowed(db: SupabaseClient, userId: string): Promise<boolean> {
  const beta = (process.env.BETA_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { hasBetaGrant, loadAccess } = await import("@/lib/access");
  await loadAccess(db);
  if (beta.includes(userId) || hasBetaGrant(userId)) return true;
  const { isFreeAccount } = await import("@/lib/pipeline/trial");
  return !(await isFreeAccount(db, userId));
}
