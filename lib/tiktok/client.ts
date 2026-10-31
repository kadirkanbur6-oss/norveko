// lib/tiktok/client.ts
// TikTok Login Kit + Content Posting API (Direct Post), 31 Oct 2026.
//
//   connect:  https://www.tiktok.com/v2/auth/authorize/ (scopes user.info.basic,video.publish)
//   tokens:   POST https://open.tiktokapis.com/v2/oauth/token/  (access 24 h, refresh 365 d —
//             TikTok may rotate the refresh token, so we store the one from every response)
//   publish:  creator_info/query → video/init (FILE_UPLOAD) → PUT bytes → status/fetch
//
// Unaudited apps: posts only to PRIVATE TikTok accounts, SELF_ONLY visibility,
// ≤ 5 users / 24 h. The audit reviews the posting UX (creator info shown,
// no default privacy, interaction toggles, music-usage consent).
//
// Env: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET (redirect URI <site>/api/tiktok/callback).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken, siteUrl } from "@/lib/youtube/oauth";

export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"];
export const TIKTOK_STATE_COOKIE = "nv_tt_state";
const API = "https://open.tiktokapis.com";

// Env values pasted into dashboards often carry a trailing newline/space.
const clientKey = () => (process.env.TIKTOK_CLIENT_KEY ?? "").trim();
const clientSecret = () => (process.env.TIKTOK_CLIENT_SECRET ?? "").trim();

export function tiktokConfigured(): boolean {
  return Boolean(clientKey() && clientSecret());
}

export function tiktokRedirectUri(): string {
  return `${siteUrl()}/api/tiktok/callback`;
}

export function tiktokAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_key: clientKey(),
    response_type: "code",
    scope: TIKTOK_SCOPES.join(","),
    redirect_uri: tiktokRedirectUri(),
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

interface TokenResponse {
  open_id: string;
  scope: string;
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${API}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: clientKey(),
      client_secret: clientSecret(),
      ...body,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error || !json.access_token) {
    const err = new Error(`TikTok token error: ${json.error ?? res.status} ${json.error_description ?? ""}`.trim());
    (err as Error & { code?: string }).code = json.error;
    throw err;
  }
  return json as TokenResponse;
}

export function exchangeTikTokCode(code: string): Promise<TokenResponse> {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: tiktokRedirectUri() });
}

export async function revokeTikTok(accessToken: string): Promise<void> {
  await fetch(`${API}/v2/oauth/revoke/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey(),
      client_secret: clientSecret(),
      token: accessToken,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

async function api<T>(path: string, token: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  const code: string = json?.error?.code ?? (res.ok ? "ok" : String(res.status));
  if (code !== "ok") {
    const err = new Error(`TikTok ${path} failed: ${code} ${json?.error?.message ?? ""}`.trim());
    (err as Error & { code?: string }).code = code;
    throw err;
  }
  return json.data as T;
}

export async function fetchTikTokUser(token: string): Promise<{ openId: string; displayName: string; avatarUrl: string | null }> {
  const data = await api<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(
    "/v2/user/info/?fields=open_id,display_name,avatar_url",
    token,
    undefined,
    "GET"
  );
  return { openId: data.user.open_id, displayName: data.user.display_name ?? "", avatarUrl: data.user.avatar_url ?? null };
}

export interface CreatorInfo {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

export function creatorInfo(token: string): Promise<CreatorInfo> {
  return api<CreatorInfo>("/v2/post/publish/creator_info/query/", token, {});
}

/* ---------------- stored connection ---------------- */

export interface TikTokConnection {
  user_id: string;
  open_id: string;
  display_name: string | null;
  avatar_url: string | null;
  refresh_token_enc: string;
  scope: string | null;
  created_at?: string;
}

export async function getTikTokConnection(db: SupabaseClient, userId: string): Promise<TikTokConnection | null> {
  const { data, error } = await db.from("tiktok_connections").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as TikTokConnection | null) ?? null;
}

export async function saveTikTokConnection(
  db: SupabaseClient,
  userId: string,
  tokens: TokenResponse,
  user: { displayName: string; avatarUrl: string | null }
): Promise<void> {
  const { error } = await db.from("tiktok_connections").upsert({
    user_id: userId,
    open_id: tokens.open_id,
    display_name: user.displayName,
    avatar_url: user.avatarUrl,
    refresh_token_enc: encryptToken(tokens.refresh_token),
    scope: tokens.scope,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Fresh access token (refresh token rotated and stored), or null when not connected. */
export async function tiktokAccessToken(
  db: SupabaseClient,
  userId: string
): Promise<{ token: string; connection: TikTokConnection } | null> {
  const connection = await getTikTokConnection(db, userId);
  if (!connection) return null;
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptToken(connection.refresh_token_enc) });
    if (t.refresh_token) {
      await db.from("tiktok_connections").update({ refresh_token_enc: encryptToken(t.refresh_token) }).eq("user_id", userId);
    }
    return { token: t.access_token, connection };
  } catch (err) {
    if ((err as { code?: string }).code === "invalid_grant") {
      await db.from("tiktok_connections").delete().eq("user_id", userId);
      return null;
    }
    throw err;
  }
}

/* ---------------- publishing ---------------- */

export const TIKTOK_PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];

export interface TikTokPostInput {
  caption: string;
  privacy: TikTokPrivacy;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
}

/** Caption ≤ 2200 UTF-16 units. */
export function tiktokCaption(text: string): string {
  const t = text.replace(/\s+\n/g, "\n").trim();
  return t.length <= 2200 ? t : `${t.slice(0, 2199)}…`;
}

/** Direct-post an MP4 (single chunk; Norveko videos are well under 64 MB). Returns publish_id. */
export async function postVideo(token: string, video: Buffer, input: TikTokPostInput): Promise<string> {
  if (video.length > 64 * 1024 * 1024) throw new Error("The video is too large for TikTok (max 64 MB here).");
  const init = await api<{ publish_id: string; upload_url: string }>("/v2/post/publish/video/init/", token, {
    post_info: {
      title: tiktokCaption(input.caption),
      privacy_level: input.privacy,
      disable_comment: !input.allowComment,
      disable_duet: !input.allowDuet,
      disable_stitch: !input.allowStitch,
      brand_content_toggle: false,
      brand_organic_toggle: false,
      // Norveko videos are AI-generated: TikTok shows its "AI-generated" label.
      is_aigc: true,
    },
    source_info: { source: "FILE_UPLOAD", video_size: video.length, chunk_size: video.length, total_chunk_count: 1 },
  });
  const put = await fetch(init.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(video.length),
      "Content-Range": `bytes 0-${video.length - 1}/${video.length}`,
    },
    body: new Uint8Array(video),
    signal: AbortSignal.timeout(180_000),
  });
  if (!put.ok) throw new Error(`TikTok upload failed (${put.status}).`);
  return init.publish_id;
}

export interface PostStatus {
  status: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED" | string;
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
}

export function postStatus(token: string, publishId: string): Promise<PostStatus> {
  return api<PostStatus>("/v2/post/publish/status/fetch/", token, { publish_id: publishId });
}

export function friendlyTikTokError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  if (code === "unaudited_client_can_only_post_to_private_accounts")
    return "While Norveko's TikTok app is in review, it can only post to private TikTok accounts. Make your account private in TikTok, or download the MP4 and post it yourself.";
  if (code === "spam_risk_too_many_posts" || code === "spam_risk_user_banned_from_posting")
    return "TikTok is limiting posts from this account right now. Please try again later.";
  if (code === "privacy_level_option_mismatch") return "That visibility isn't available for this TikTok account. Pick another one.";
  if (code === "access_token_invalid" || code === "scope_not_authorized") return "Your TikTok connection expired. Please reconnect TikTok.";
  if (code === "rate_limit_exceeded") return "Too many TikTok requests — wait a minute and try again.";
  return "Posting to TikTok failed. Please try again in a minute.";
}
