// lib/pipeline/kling.ts
// Kling AI (official API, "new platform" Oct 2026) text-to-video client.
// Server-only.
//
// Auth: `Authorization: Bearer <KLING_API_KEY>` (console key), or the legacy
// HS256 JWT signed from KLING_ACCESS_KEY/KLING_SECRET_KEY.
// Flow: POST /text-to-video/<model> -> data.id, then GET /tasks?task_ids=<id>
// until status is "succeeded" or "failed". Result URLs expire after 30 days
// (and are hotlink-protected), so the caller copies the MP4 into Supabase.
// Docs: kling.ai/document-api/api/video/3-0-omni/text-to-video
//
// Env: KLING_API_KEY (new single key) — or legacy KLING_ACCESS_KEY +
// KLING_SECRET_KEY — and optional KLING_API_BASE
// (default https://api-singapore.klingai.com).

import { CAMERA_RULE, sanitizeClipPrompt } from "./kling-prompt";

import "server-only";
import { createHmac } from "node:crypto";

const DEFAULT_BASE = "https://api-singapore.klingai.com";
/** Default model. Kling 3.0, no native audio: 0.6 units/s at 720p (≈$0.42 per 5 s). */
export const KLING_DEFAULT_MODEL = "kling-3.0";
export type KlingResolution = "720p" | "1080p";

export type KlingTaskStatus = "submitted" | "processing" | "succeed" | "failed";

export interface KlingSubmitParams {
  prompt: string;
  negativePrompt?: string;
  /** "5" or "10" seconds */
  duration: "5" | "10";
  aspectRatio: "16:9" | "9:16" | "1:1";
  /** Legacy (ignored by the 3.0 API, kept for callers). */
  mode?: "std" | "pro";
  model?: string;
  /** 720p is the priced default; 1080p costs ~33% more. */
  resolution?: KlingResolution;
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
  const model = params.model ?? KLING_DEFAULT_MODEL;
  const prompt = [sanitizeClipPrompt(params.prompt), CAMERA_RULE, params.negativePrompt ? `Avoid: ${params.negativePrompt}` : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2500);
  const data = await klingFetch<{ id?: string; status?: string }>(
    `/text-to-video/${encodeURIComponent(model)}`,
    {
      method: "POST",
      body: JSON.stringify({
        prompt,
        settings: {
          resolution: params.resolution ?? "720p",
          aspect_ratio: params.aspectRatio,
          duration: Number(params.duration),
          audio: "off",
        },
        options: { watermark_info: { enabled: false } },
      }),
    }
  );
  if (!data?.id) {
    throw new Error("Kling API error: no task id in response.");
  }
  return data.id;
}

/** Fetch the current state of a text-to-video task. */
export async function getTextToVideoTask(taskId: string): Promise<KlingTaskResult> {
  const list = await klingFetch<
    Array<{
      id?: string;
      status?: "submitted" | "processing" | "succeeded" | "failed";
      message?: string;
      outputs?: Array<{ type?: string; url?: string; duration?: string | number }>;
    }>
  >(`/tasks?task_ids=${encodeURIComponent(taskId)}`, { method: "GET" });

  const task = Array.isArray(list) ? list[0] : undefined;
  const video = task?.outputs?.find((o) => o.type === "video" && o.url);
  const raw = task?.status ?? "processing";
  const status: KlingTaskStatus =
    raw === "succeeded" ? "succeed" : raw === "failed" ? "failed" : raw === "submitted" ? "submitted" : "processing";
  return {
    taskId: task?.id ?? taskId,
    status,
    statusMessage: task?.message,
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
