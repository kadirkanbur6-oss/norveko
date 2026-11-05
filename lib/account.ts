// lib/account.ts
// Permanent account deletion, shared by the user's own "Delete account"
// (app/api/account/route.ts) and the admin panel (app/api/admin/actions).
// Removes storage objects, rows in every user table, the Paddle subscription,
// the ElevenLabs voice clone, R2 videos and finally the auth user.

import "server-only";
import { createClient } from "@supabase/supabase-js";

const BUCKETS = ["thumbnails", "voiceovers", "videos"] as const;
// Deleted in this order so FK-style dependencies (if any) resolve.
const USER_TABLES = [
  "youtube_connections",
  "tiktok_connections",
  "instagram_connections",
  "api_keys",
  "swap_jobs",
  "skit_jobs",
  "team_members", // (an owned team goes with the auth user: teams.owner_id cascades)
  "series",
  "brand_kits",
  "voice_clones",
  "characters",
  "referral_codes",
  "subscription_grants",
  "subscriptions",
  "credit_transactions",
  "credit_purchases",
  "pipeline_jobs",
  "projects",
  "channel_videos_cache",
  "channel_stats_snapshots",
  "user_channels",
  "user_credits",
] as const;

export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

/** Remove every object under `<prefix>/` in a bucket (handles nested folders). */
async function emptyPrefix(
  client: ReturnType<typeof serviceClient>,
  bucket: string,
  prefix: string
): Promise<void> {
  const { data: entries } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!entries?.length) return;
  const files: string[] = [];
  for (const entry of entries) {
    // Folders come back without metadata/id.
    if (entry.id === null || (entry as { metadata?: unknown }).metadata == null) {
      await emptyPrefix(client, bucket, `${prefix}/${entry.name}`);
    } else {
      files.push(`${prefix}/${entry.name}`);
    }
  }
  if (files.length) await client.storage.from(bucket).remove(files);
}

export class AccountBusyError extends Error {}
export class SubscriptionCancelError extends Error {}

/**
 * Delete `userId` and everything it owns. Throws AccountBusyError while a
 * generation is running, SubscriptionCancelError when Paddle refuses, or a
 * plain Error for anything else (the caller decides the HTTP status).
 */
export async function deleteAccount(userId: string): Promise<void> {
  const client = serviceClient();
  const user = { id: userId };

  // Refuse while a generation is running so we don't orphan a worker.
  const { count: running } = await client
    .from("pipeline_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "running");
  if ((running ?? 0) > 0) {
    throw new AccountBusyError("A generation is still running. Please wait for it to finish, then try again.");
  }

  for (const bucket of BUCKETS) {
    try {
      await emptyPrefix(client, bucket, user.id);
    } catch (err) {
      console.error(`[account] storage cleanup ${bucket} failed:`, err);
    }
  }
  // Stop any paid plan at Paddle so the deleted account is never charged again.
  try {
    const { data: subs } = await client
      .from("subscriptions")
      .select("paddle_subscription_id, status")
      .eq("user_id", user.id);
    const live = (subs ?? []).filter((s: { status: string }) => ["active", "trialing", "past_due", "paused"].includes(s.status));
    if (live.length) {
      const { Paddle, Environment } = await import("@paddle/paddle-node-sdk");
      const { getPaddleEnvironment } = await import("@/lib/paddle-env");
      const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
        environment: getPaddleEnvironment() === "production" ? Environment.production : Environment.sandbox,
      });
      for (const s of live as Array<{ paddle_subscription_id: string }>) {
        await paddle.subscriptions.cancel(s.paddle_subscription_id, { effectiveFrom: "immediately" });
      }
    }
  } catch (err) {
    console.error("[account] subscription cancel failed:", err);
    throw new SubscriptionCancelError("We couldn't cancel your subscription. Cancel it from Billing → Manage plan, then try again.");
  }

  // The cloned voice lives in the shared ElevenLabs account: remove it there.
  try {
    const { data: clone } = await client.from("voice_clones").select("voice_id").eq("user_id", user.id).maybeSingle();
    if (clone?.voice_id) await (await import("@/lib/pipeline/elevenlabs")).deleteVoice(clone.voice_id);
  } catch (err) {
    console.error("[account] voice clone cleanup failed:", err);
  }
  // Character reference photos (private bucket) live under <user>/.
  try {
    await emptyPrefix(client, "characters", user.id);
  } catch (err) {
    console.error("[account] character photo cleanup failed:", err);
  }
  // Finished videos stored in Cloudflare R2 live under <user>/.
  try {
    await (await import("@/lib/storage/r2")).deleteR2Prefix(`${user.id}/`);
  } catch (err) {
    console.error("[account] R2 video cleanup failed:", err);
  }
  // Brand kit logos live under videos/brand/<user>/.
  try {
    await emptyPrefix(client, "videos", `brand/${user.id}`);
  } catch (err) {
    console.error("[account] brand logo cleanup failed:", err);
  }
  // Legacy thumbnails were stored at the bucket root as <jobId>.png; collect them by job id.
  const { data: jobs } = await client
    .from("pipeline_jobs")
    .select("id")
    .eq("user_id", user.id);
  const legacy = (jobs ?? []).flatMap((j) => [`${j.id}.png`, `${j.id}.jpg`]);
  if (legacy.length) {
    await client.storage.from("thumbnails").remove(legacy);
  }

  // Revoke the YouTube upload grant at Google before the row disappears.
  try {
    const { getConnection, decryptToken, revokeToken } = await import("@/lib/youtube/oauth");
    const yt = await getConnection(client, user.id);
    if (yt) await revokeToken(decryptToken(yt.refresh_token_enc));
  } catch {
    // table missing or already revoked
  }

  try {
    const { tiktokAccessToken, revokeTikTok } = await import("@/lib/tiktok/client");
    const tt = await tiktokAccessToken(client, user.id);
    if (tt) await revokeTikTok(tt.token);
  } catch {
    // table missing or already revoked
  }

  for (const table of USER_TABLES) {
    const { error } = await client.from(table).delete().eq("user_id", user.id);
    if (error && !/does not exist/i.test(error.message)) {
      throw new Error(`${table}: ${error.message}`);
    }
  }

  const { error: authError } = await client.auth.admin.deleteUser(user.id);
  if (authError) throw new Error(authError.message);

  console.log(`[account] deleted user ${user.id}`);
}
