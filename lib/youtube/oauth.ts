// lib/youtube/oauth.ts
// "Connect YouTube" for direct uploads (31 Oct 2026). This is a separate
// Google OAuth grant from Supabase's "Sign in with Google": it asks only for
// the youtube.upload + youtube.readonly scopes and keeps a refresh token,
// encrypted (AES-256-GCM), in public.youtube_connections (service role only).
//
// Env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (a Web OAuth client
// with redirect URI <site>/api/youtube/callback), optional YOUTUBE_TOKEN_KEY
// (falls back to PIPELINE_WORKER_SECRET for the encryption key).

import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export const STATE_COOKIE = "nv_yt_state";

export interface YouTubeConnection {
  user_id: string;
  channel_id: string;
  channel_title: string | null;
  channel_thumbnail: string | null;
  refresh_token_enc: string;
  scope: string | null;
  created_at?: string;
}

export function youtubeUploadConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://norveko.app").replace(/\/$/, "");
}

export function redirectUri(): string {
  return `${siteUrl()}/api/youtube/callback`;
}

/** Only same-site relative paths ("/projects/…"), never "//evil.com". */
export function safeReturnTo(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value.slice(0, 200) : "/settings";
}

export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// ---------- token encryption ----------

function key(): Buffer {
  const secret = process.env.YOUTUBE_TOKEN_KEY || process.env.PIPELINE_WORKER_SECRET;
  if (!secret) throw new Error("YOUTUBE_TOKEN_KEY (or PIPELINE_WORKER_SECRET) is not set.");
  return createHash("sha256").update(`youtube-token:${secret}`).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptToken(enc: string): string {
  const [v, iv, tag, data] = enc.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unknown token format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

// ---------- OAuth ----------

export function authorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: YOUTUBE_SCOPES.join(" "),
    access_type: "offline",
    // "consent" guarantees a refresh token even when the user connected before.
    prompt: "consent select_account",
    include_granted_scopes: "false",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: (process.env.GOOGLE_OAUTH_CLIENT_ID ?? "").trim(),
      client_secret: (process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "").trim(),
      ...body,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Google token error (${res.status}): ${json.error ?? ""} ${json.error_description ?? ""}`.trim());
    (err as Error & { code?: string }).code = json.error;
    throw err;
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/** The channel behind an access token (channels.list mine=true). */
export async function fetchOwnChannel(accessToken: string): Promise<{ id: string; title: string; thumbnail: string | null } | null> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`YouTube channel lookup failed (${res.status}).`);
  const json = await res.json();
  const ch = json?.items?.[0];
  if (!ch?.id) return null;
  return {
    id: String(ch.id),
    title: String(ch.snippet?.title ?? ""),
    thumbnail: ch.snippet?.thumbnails?.default?.url ?? null,
  };
}

// ---------- storage ----------

export async function getConnection(db: SupabaseClient, userId: string): Promise<YouTubeConnection | null> {
  const { data, error } = await db.from("youtube_connections").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as YouTubeConnection | null) ?? null;
}

/** A fresh access token for the user's connected channel, or null when not connected. */
export async function accessTokenFor(
  db: SupabaseClient,
  userId: string
): Promise<{ token: string; connection: YouTubeConnection } | null> {
  const connection = await getConnection(db, userId);
  if (!connection) return null;
  try {
    const t = await refreshAccessToken(decryptToken(connection.refresh_token_enc));
    return { token: t.access_token, connection };
  } catch (err) {
    // Revoked in the Google account or the grant expired: drop the dead row.
    if ((err as { code?: string }).code === "invalid_grant") {
      await db.from("youtube_connections").delete().eq("user_id", userId);
      return null;
    }
    throw err;
  }
}
