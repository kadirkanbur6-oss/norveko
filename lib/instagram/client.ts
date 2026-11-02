// lib/instagram/client.ts
// Instagram Reels publishing with "Instagram API with Instagram Login" (2 Nov 2026).
//
//   connect:  https://www.instagram.com/oauth/authorize (instagram_business_basic,
//             instagram_business_content_publish) — professional (Business/Creator) accounts only
//   tokens:   POST https://api.instagram.com/oauth/access_token (short-lived, 1 h)
//             → GET graph.instagram.com/access_token?grant_type=ig_exchange_token (long-lived, 60 days)
//             → GET graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token (another 60 days)
//   publish:  POST /{ig-user-id}/media {media_type: REELS, video_url, caption, share_to_feed}
//             → poll GET /{container}?fields=status_code until FINISHED
//             → POST /{ig-user-id}/media_publish {creation_id}
//
// Instagram downloads the video from our public URL (norveko.app/media/videos/…).
// Until Meta's App Review approves the publish permission, only accounts added
// as testers of the Meta app can connect.
//
// Env: INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET (redirect URI <site>/api/instagram/callback).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken, siteUrl } from "@/lib/youtube/oauth";

export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
export const INSTAGRAM_STATE_COOKIE = "nv_ig_state";
const GRAPH = "https://graph.instagram.com/v23.0";

const appId = () => (process.env.INSTAGRAM_APP_ID ?? "").trim();
const appSecret = () => (process.env.INSTAGRAM_APP_SECRET ?? "").trim();

export function instagramConfigured(): boolean {
  return Boolean(appId() && appSecret());
}

export function instagramRedirectUri(): string {
  return `${siteUrl()}/api/instagram/callback`;
}

export function instagramAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: appId(),
    redirect_uri: instagramRedirectUri(),
    response_type: "code",
    scope: INSTAGRAM_SCOPES.join(","),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

async function igJson(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.error || json.error_type) {
    const e = (json.error ?? {}) as { message?: string; code?: number; error_subcode?: number; type?: string };
    const err = new Error(`Instagram API error: ${e.message ?? json.error_message ?? res.status}`);
    (err as Error & { code?: string }).code = String(e.code ?? json.error_type ?? res.status);
    throw err;
  }
  return json;
}

/** Code → long-lived (60-day) user token. */
export async function exchangeInstagramCode(code: string): Promise<{ userId: string; token: string; expiresIn: number; permissions: string[] }> {
  const short = await igJson(
    await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: appId(),
        client_secret: appSecret(),
        grant_type: "authorization_code",
        redirect_uri: instagramRedirectUri(),
        code,
      }),
      signal: AbortSignal.timeout(20_000),
    })
  );
  // The response is either flat or wrapped in data[0] depending on the API version.
  const first = (Array.isArray(short.data) ? short.data[0] : short) as Record<string, unknown>;
  const shortToken = String(first.access_token ?? "");
  const permissions = String(first.permissions ?? "").split(",").filter(Boolean);
  const long = await igJson(
    await fetch(
      `https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: appSecret(), access_token: shortToken })}`,
      { signal: AbortSignal.timeout(20_000) }
    )
  );
  return { userId: String(first.user_id ?? ""), token: String(long.access_token), expiresIn: Number(long.expires_in) || 60 * 86400, permissions };
}

export async function fetchInstagramProfile(token: string): Promise<{ id: string; username: string | null; avatarUrl: string | null; accountType: string | null }> {
  const json = await igJson(
    await fetch(`${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username,profile_picture_url,account_type", access_token: token })}`, {
      signal: AbortSignal.timeout(15_000),
    })
  );
  return {
    id: String(json.user_id ?? json.id ?? ""),
    username: (json.username as string) ?? null,
    avatarUrl: (json.profile_picture_url as string) ?? null,
    accountType: (json.account_type as string) ?? null,
  };
}

export interface InstagramConnection {
  user_id: string;
  ig_user_id: string;
  username: string | null;
  avatar_url: string | null;
  token_enc: string;
  expires_at: string;
  created_at?: string;
}

export async function saveInstagramConnection(
  db: SupabaseClient,
  userId: string,
  tokens: { token: string; expiresIn: number },
  profile: { id: string; username: string | null; avatarUrl: string | null }
) {
  const { error } = await db.from("instagram_connections").upsert({
    user_id: userId,
    ig_user_id: profile.id,
    username: profile.username,
    avatar_url: profile.avatarUrl,
    token_enc: encryptToken(tokens.token),
    expires_at: new Date(Date.now() + tokens.expiresIn * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function getInstagramConnection(db: SupabaseClient, userId: string): Promise<InstagramConnection | null> {
  const { data } = await db.from("instagram_connections").select("*").eq("user_id", userId).maybeSingle();
  return (data as InstagramConnection | null) ?? null;
}

/** A usable token; refreshed when it has less than 10 days left (tokens last 60). */
export async function instagramAccessToken(db: SupabaseClient, userId: string): Promise<{ token: string; connection: InstagramConnection } | null> {
  const c = await getInstagramConnection(db, userId);
  if (!c) return null;
  let token = decryptToken(c.token_enc);
  const left = Date.parse(c.expires_at) - Date.now();
  if (left <= 0) return null;
  if (left < 10 * 86400 * 1000) {
    try {
      const json = await igJson(
        await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`, {
          signal: AbortSignal.timeout(15_000),
        })
      );
      token = String(json.access_token);
      await db
        .from("instagram_connections")
        .update({ token_enc: encryptToken(token), expires_at: new Date(Date.now() + (Number(json.expires_in) || 60 * 86400) * 1000).toISOString() })
        .eq("user_id", userId);
    } catch (err) {
      console.warn("[instagram] token refresh failed, using the current one:", err);
    }
  }
  return { token, connection: c };
}

export interface ReelInput {
  caption: string;
  shareToFeed: boolean;
  coverUrl?: string;
}

/** Create the Reel container, wait for Instagram to process the video, publish it. */
export async function publishReel(token: string, igUserId: string, videoUrl: string, input: ReelInput): Promise<{ mediaId: string; permalink?: string }> {
  const container = await igJson(
    await fetch(`${GRAPH}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        media_type: "REELS",
        video_url: videoUrl,
        caption: input.caption.slice(0, 2200),
        share_to_feed: input.shareToFeed,
        ...(input.coverUrl ? { cover_url: input.coverUrl } : {}),
      }),
      signal: AbortSignal.timeout(30_000),
    })
  );
  const creationId = String(container.id);

  // Instagram fetches and transcodes the video: usually under a minute for a Short.
  let status = "IN_PROGRESS";
  for (let i = 0; i < 20 && status !== "FINISHED"; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await igJson(
      await fetch(`${GRAPH}/${creationId}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`, { signal: AbortSignal.timeout(15_000) })
    ).catch(() => null);
    if (!s) continue;
    status = String(s.status_code ?? status);
    if (status === "ERROR" || status === "EXPIRED") {
      throw Object.assign(new Error(`Instagram couldn't process the video: ${String(s.status ?? status)}`), { code: "processing_failed" });
    }
  }
  if (status !== "FINISHED") throw Object.assign(new Error("Instagram is still processing the video."), { code: "still_processing" });

  const published = await igJson(
    await fetch(`${GRAPH}/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ creation_id: creationId }),
      signal: AbortSignal.timeout(30_000),
    })
  );
  const mediaId = String(published.id);
  const info = await igJson(
    await fetch(`${GRAPH}/${mediaId}?${new URLSearchParams({ fields: "permalink", access_token: token })}`, { signal: AbortSignal.timeout(15_000) })
  ).catch(() => null);
  return { mediaId, permalink: (info?.permalink as string | undefined) ?? undefined };
}

export function friendlyInstagramError(err: unknown): string {
  const code = String((err as { code?: string })?.code ?? "");
  if (code === "still_processing") return "Instagram is still processing the video. Check your account in a few minutes.";
  if (code === "processing_failed") return "Instagram couldn't process this video. Reels must be vertical and 3 seconds to 15 minutes long.";
  if (code === "190") return "Your Instagram connection expired. Connect it again in Settings.";
  if (code === "9" || code === "4") return "Instagram's posting limit was reached (25 posts a day). Try again tomorrow.";
  return "Couldn't post to Instagram. Please try again.";
}
