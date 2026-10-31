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
