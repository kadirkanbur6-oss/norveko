// lib/pipeline/fal-video.ts
// Image→video clips on fal.ai (default: ByteDance Seedance 1.5 Pro, silent
// 720p, 5 s — chosen in the 31 Oct model lab: it animates our own scene
// still, so clips match the stills, at ~$0.13 a clip). Queue API: submit →
// poll status → fetch result. Server-only; FAL_KEY is checked at call time.

import { CAMERA_RULE, sanitizeClipPrompt } from "./kling-prompt";

export const FAL_VIDEO_MODEL = process.env.FAL_VIDEO_MODEL || "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";

export interface FalVideoHandle {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
}

export interface FalVideoResult {
  status: "processing" | "succeed" | "failed";
  videoUrl?: string;
  durationSeconds?: number;
  statusMessage?: string;
}

function key(): string {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("FAL_KEY is not set.");
  return k;
}

export async function submitImageToVideo(params: {
  prompt: string;
  imageUrl: string;
  aspectRatio: "9:16" | "16:9";
  model?: string;
}): Promise<FalVideoHandle> {
  const model = params.model ?? FAL_VIDEO_MODEL;
  const prompt = [
    "Animate this exact frame with natural, believable motion that matches the scene.",
    sanitizeClipPrompt(params.prompt),
    CAMERA_RULE,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2000);
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${key()}` },
    body: JSON.stringify({
      prompt,
      image_url: params.imageUrl,
      aspect_ratio: params.aspectRatio,
      resolution: "720p",
      duration: "5",
      // Our voiceover is the soundtrack; generated audio doubles the price.
      generate_audio: false,
    }),
    cache: "no-store",
  });
  const raw = await res.text();
  let data: { request_id?: string; status_url?: string; response_url?: string; detail?: unknown } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* surfaced below */
  }
  if (!res.ok || !data.request_id || !data.status_url || !data.response_url) {
    throw new Error(`fal submit failed (HTTP ${res.status}): ${raw.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  return { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

/**
 * Text→video clips (clipMode "text") on fal.ai's Kling 3.0 Standard — same
 * model and price as Kling's own API ($0.084 / s with audio off), but billed
 * on the single fal balance, so no separate Kling account is needed.
 * `generate_audio` MUST stay false: audio on is $0.126 / s.
 *
 * The runner stores a task id string, so the fal queue handle is packed into
 * one ("fal:<base64url json>") and unpacked when polling.
 */
export const FAL_TEXT_VIDEO_MODEL = process.env.FAL_TEXT_VIDEO_MODEL || "fal-ai/kling-video/v3/standard/text-to-video";

const FAL_TASK_PREFIX = "fal:";

export function isFalTaskId(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith(FAL_TASK_PREFIX);
}

function packTaskId(handle: FalVideoHandle, seconds: number): string {
  const json = JSON.stringify({ r: handle.requestId, s: handle.statusUrl, u: handle.responseUrl, d: seconds });
  return FAL_TASK_PREFIX + Buffer.from(json).toString("base64url");
}

function unpackTaskId(id: string): { handle: FalVideoHandle; seconds: number } {
  const o = JSON.parse(Buffer.from(id.slice(FAL_TASK_PREFIX.length), "base64url").toString("utf8")) as {
    r: string;
    s: string;
    u: string;
    d: number;
  };
  return { handle: { requestId: o.r, statusUrl: o.s, responseUrl: o.u }, seconds: o.d };
}

export async function submitTextToVideoFal(params: {
  prompt: string;
  negativePrompt?: string;
  duration: "5" | "10";
  aspectRatio: "16:9" | "9:16" | "1:1";
}): Promise<string> {
  const prompt = [sanitizeClipPrompt(params.prompt), CAMERA_RULE, params.negativePrompt ? `Avoid: ${params.negativePrompt}` : ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 2500);
  const res = await fetch(`https://queue.fal.run/${FAL_TEXT_VIDEO_MODEL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${key()}` },
    body: JSON.stringify({
      prompt,
      duration: params.duration,
      aspect_ratio: params.aspectRatio,
      generate_audio: false,
    }),
    cache: "no-store",
  });
  const raw = await res.text();
  let data: { request_id?: string; status_url?: string; response_url?: string } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* surfaced below */
  }
  if (!res.ok || !data.request_id || !data.status_url || !data.response_url) {
    throw new Error(`fal text-to-video submit failed (HTTP ${res.status}): ${raw.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  return packTaskId(
    { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url },
    Number(params.duration),
  );
}

/** Poll a task id produced by submitTextToVideoFal (same result shape the runner expects from Kling). */
export async function getFalTextToVideoTask(taskId: string): Promise<{
  taskId: string;
  status: "processing" | "succeed" | "failed";
  videoUrl?: string;
  durationSeconds?: number;
  statusMessage?: string;
}> {
  const { handle, seconds } = unpackTaskId(taskId);
  const r = await getImageToVideo(handle);
  return {
    taskId,
    status: r.status,
    videoUrl: r.videoUrl,
    durationSeconds: r.status === "succeed" ? seconds : undefined,
    statusMessage: r.statusMessage,
  };
}

export async function getImageToVideo(handle: FalVideoHandle): Promise<FalVideoResult> {
  const auth = { Authorization: `Key ${key()}` };
  const st = await fetch(handle.statusUrl, { headers: auth, cache: "no-store" });
  if (!st.ok) throw new Error(`fal status HTTP ${st.status}`);
  const s = (await st.json()) as { status?: string; error?: string };
  if (s.status === "FAILED" || s.status === "ERROR") {
    return { status: "failed", statusMessage: String(s.error ?? s.status) };
  }
  if (s.status !== "COMPLETED") return { status: "processing" };
  const rr = await fetch(handle.responseUrl, { headers: auth, cache: "no-store" });
  const raw = await rr.text();
  if (!rr.ok) return { status: "failed", statusMessage: `fal result HTTP ${rr.status}: ${raw.slice(0, 200)}` };
  let r: { video?: { url?: string }; detail?: unknown } = {};
  try {
    r = JSON.parse(raw);
  } catch {
    return { status: "failed", statusMessage: "fal result was not JSON" };
  }
  if (!r.video?.url) return { status: "failed", statusMessage: `no video in result: ${raw.slice(0, 200)}` };
  return { status: "succeed", videoUrl: r.video.url, durationSeconds: 5 };
}

/**
 * Speaking shots made WITH their own voice (5 Nov 2026 lab, Kadir: Veo 3.1
 * Fast beat TTS + lip-sync and Kling 3): the model writes the line, the lip
 * movement and the room sound in one go. Clips are 4, 6 or 8 s; longer lines
 * use the lip-sync path. SKIT_TALK_MODEL=avatar switches it off.
 */
export const TALK_VIDEO_MODEL = process.env.SKIT_TALK_MODEL || "fal-ai/veo3.1/fast/image-to-video";
export const TALK_VIDEO_ENABLED = TALK_VIDEO_MODEL !== "avatar";
export const TALK_VIDEO_SECONDS = [4, 6, 8] as const;
/** Veo 3.1 Fast with audio on fal (5 Nov 2026). */
export const TALK_VIDEO_COST_PER_SECOND = 0.15;

/** Clip length for a line of about `speechSeconds`, or null when it doesn't fit in 8 s. */
export function talkClipSeconds(speechSeconds: number): (typeof TALK_VIDEO_SECONDS)[number] | null {
  const need = speechSeconds + 0.8; // a breath before and after
  return TALK_VIDEO_SECONDS.find((s) => s >= need) ?? null;
}

export async function submitTalkingVideo(params: {
  imageUrl: string;
  prompt: string;
  seconds: (typeof TALK_VIDEO_SECONDS)[number];
  aspectRatio: "9:16" | "16:9";
}): Promise<FalVideoHandle> {
  const res = await fetch(`https://queue.fal.run/${TALK_VIDEO_MODEL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${key()}` },
    body: JSON.stringify({
      prompt: params.prompt.slice(0, 2000),
      image_url: params.imageUrl,
      aspect_ratio: params.aspectRatio,
      duration: `${params.seconds}s`,
      resolution: "720p",
      generate_audio: true,
    }),
    cache: "no-store",
  });
  const raw = await res.text();
  let data: { request_id?: string; status_url?: string; response_url?: string } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* surfaced below */
  }
  if (!res.ok || !data.request_id || !data.status_url || !data.response_url) {
    throw new Error(`fal talking video submit failed (HTTP ${res.status}): ${raw.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  return { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

/**
 * Talking characters (presenter slots, Talk, skits): a portrait + audio →
 * lip-synced video. 3 Nov 2026 lab test: Kling AI Avatar v2 Standard
 * ($0.0562/s) moves a cartoon beak/mouth as well as VEED Fabric 1.0
 * ($0.15/s at 720p) for a third of the price, so it is the default; Fabric is
 * the fallback when Kling fails (it kept failing upstream on 2 Nov).
 */
export const FAL_AVATAR_MODEL = process.env.FAL_AVATAR_MODEL || "fal-ai/kling-video/ai-avatar/v2/standard";
export const FAL_AVATAR_FALLBACK_MODEL = process.env.FAL_AVATAR_FALLBACK_MODEL || "veed/fabric-1.0";

/** Was this lip-sync request already sent to the fallback model? */
export function isFallbackAvatar(handle: FalVideoHandle | null | undefined): boolean {
  return Boolean(handle?.statusUrl.includes(`/${FAL_AVATAR_FALLBACK_MODEL.split("/")[0]}/`));
}

export async function submitAvatar(params: { imageUrl: string; audioUrl: string; prompt?: string; model?: string }): Promise<FalVideoHandle> {
  const model = params.model ?? FAL_AVATAR_MODEL;
  try {
    return await submitAvatarTo(model, params);
  } catch (err) {
    if (model === FAL_AVATAR_FALLBACK_MODEL) throw err;
    console.warn(`[fal] ${model} submit failed, trying ${FAL_AVATAR_FALLBACK_MODEL}:`, err instanceof Error ? err.message : err);
    return submitAvatarTo(FAL_AVATAR_FALLBACK_MODEL, params);
  }
}

async function submitAvatarTo(model: string, params: { imageUrl: string; audioUrl: string; prompt?: string }): Promise<FalVideoHandle> {
  const prompt = (params.prompt ?? "The person speaks to the camera like a documentary presenter, natural head movement and expressions.").slice(0, 1000);
  const input = model.startsWith("veed/")
    ? { image_url: params.imageUrl, audio_url: params.audioUrl, resolution: "720p", prompt }
    : { image_url: params.imageUrl, audio_url: params.audioUrl, prompt };
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${key()}` },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const raw = await res.text();
  let data: { request_id?: string; status_url?: string; response_url?: string } = {};
  try {
    data = JSON.parse(raw);
  } catch {
    /* surfaced below */
  }
  if (!res.ok || !data.request_id || !data.status_url || !data.response_url) {
    throw new Error(`fal avatar submit failed (HTTP ${res.status}): ${raw.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  return { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}
