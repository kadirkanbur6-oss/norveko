// lib/pipeline/kling.ts
// Kling AI (official API) text-to-video client. Server-only.
//
// Auth: short-lived HS256 JWT signed with the secret key, `iss` = access key.
// Flow: POST /v1/videos/text2video -> task_id, then GET the task until
// task_status is "succeed" or "failed". Result URLs expire, so the caller
// copies the MP4 into Supabase Storage.
//
// Env: KLING_API_KEY (new single key) — or legacy KLING_ACCESS_KEY +
// KLING_SECRET_KEY — and optional KLING_API_BASE
// (default https://api-singapore.klingai.com).

import "server-only";
import { createHmac } from "node:crypto";

const DEFAULT_BASE = "https://api-singapore.klingai.com";

export type KlingTaskStatus = "submitted" | "processing" | "succeed" | "failed";

export interface KlingSubmitParams {
  prompt: string;
  negativePrompt?: string;
  /** "5" or "10" seconds */
  duration: "5" | "10";
  aspectRatio: "16:9" | "9:16" | "1:1";
  /** "std" is cheaper, "pro" is higher quality */
  mode?: "std" | "pro";
  model?: string;
}

export interface KlingTaskResult {
  taskId: string;
  status: KlingTaskStatus;
  statusMessage?: string;
  videoUrl?: string;
  durationSeconds?: number;
}

function getCredentials() {
  const accessKey = process.env.KLING_ACCESS_KEY;
  const secretKey = process.env.KLING_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error("KLING_API_KEY (or KLING_ACCESS_KEY / KLING_SECRET_KEY) is not set.");
  }
  return { accessKey, secretKey };
}

/**
 * Bearer token for the request. Kling's new console (Oct 2026) issues a single
 * API key ("api-key-kling-…") used directly as the bearer token; the older
 * Access Key + Secret Key pair is signed into a short-lived JWT.
 */
export function authToken(now: number = Date.now()): string {
  const apiKey = process.env.KLING_API_KEY?.trim();
  if (apiKey) return apiKey;
  return buildKlingToken(now);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Build the API token Kling expects (valid ~30 minutes). */
export function buildKlingToken(now: number = Date.now()): string {
  const { accessKey, secretKey } = getCredentials();
  const seconds = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: accessKey, exp: seconds + 1800, nbf: seconds - 5 })
  );
  const signature = base64url(
    createHmac("sha256", secretKey).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

function baseUrl(): string {
  return (process.env.KLING_API_BASE ?? DEFAULT_BASE).replace(/\/$/, "");
}

async function klingFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authToken()}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  let body: { code?: number; message?: string; data?: unknown } = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON error body
  }

  if (!res.ok || (typeof body.code === "number" && body.code !== 0)) {
    const detail = body.message ?? `HTTP ${res.status}`;
    throw new Error(`Kling API error: ${detail}`);
  }
  return body.data as T;
}

/** Submit a text-to-video task. Returns the provider task id. */
export async function submitTextToVideo(params: KlingSubmitParams): Promise<string> {
  const data = await klingFetch<{ task_id: string; task_status: KlingTaskStatus }>(
    "/v1/videos/text2video",
    {
      method: "POST",
      body: JSON.stringify({
        model_name: params.model ?? "kling-v2-1",
        prompt: params.prompt.slice(0, 2500),
        negative_prompt: params.negativePrompt,
        cfg_scale: 0.5,
        mode: params.mode ?? "std",
        aspect_ratio: params.aspectRatio,
        duration: params.duration,
      }),
    }
  );
  if (!data?.task_id) {
    throw new Error("Kling API error: no task_id in response.");
  }
  return data.task_id;
}

/** Fetch the current state of a text-to-video task. */
export async function getTextToVideoTask(taskId: string): Promise<KlingTaskResult> {
  const data = await klingFetch<{
    task_id: string;
    task_status: KlingTaskStatus;
    task_status_msg?: string;
    task_result?: { videos?: Array<{ url?: string; duration?: string | number }> };
  }>(`/v1/videos/text2video/${encodeURIComponent(taskId)}`, { method: "GET" });

  const video = data?.task_result?.videos?.[0];
  return {
    taskId: data?.task_id ?? taskId,
    status: data?.task_status ?? "processing",
    statusMessage: data?.task_status_msg,
    videoUrl: video?.url,
    durationSeconds: video?.duration != null ? Number(video.duration) : undefined,
  };
}

/** Download a finished clip so it can be stored in our own bucket. */
export async function downloadVideo(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not download video (HTTP ${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Map our platform labels to the clip aspect ratio. */
export function aspectRatioForPlatform(platform: string | null | undefined): "16:9" | "9:16" {
  const p = (platform ?? "").toLowerCase();
  if (p.includes("short") || p.includes("tiktok") || p.includes("reel")) return "9:16";
  return "16:9";
}
