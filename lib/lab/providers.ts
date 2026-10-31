// lib/lab/providers.ts
// Model comparison lab (private beta, /lab). Thin raw-fetch adapters for
// candidate image / TTS / video providers so the same prompt or narration
// can be generated side by side before switching the production pipeline.
// No import-time env checks: a missing key surfaces as that cell's error.

import "server-only";

export interface Media {
  buffer: Buffer;
  contentType: string;
  ext: string;
  note?: string;
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in Vercel.`);
  return v;
}

async function failText(res: Response, label: string): Promise<never> {
  const body = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
  throw new Error(`${label} HTTP ${res.status}: ${body}`);
}

async function download(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) await failText(res, "download");
  return Buffer.from(await res.arrayBuffer());
}

function extFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("mpeg")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mp4")) return "mp4";
  return "bin";
}

/* ---------------- Images ---------------- */

export type ImageProvider = "gemini" | "imagen" | "openai" | "fal";

export async function labImage(provider: ImageProvider, model: string, prompt: string): Promise<Media> {
  if (provider === "gemini") {
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": need("GEMINI_API_KEY") },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { imageConfig: { aspectRatio: "9:16" } },
      }),
    });
    if (!res.ok) await failText(res, model);
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data)?.inlineData;
    if (!img) throw new Error(`${model}: no image in response`);
    const mime = img.mimeType ?? "image/png";
    return { buffer: Buffer.from(img.data, "base64"), contentType: mime, ext: extFor(mime) };
  }
  if (provider === "imagen") {
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": need("GEMINI_API_KEY") },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1, aspectRatio: "9:16" } }),
    });
    if (!res.ok) await failText(res, model);
    const data = await res.json();
    const p = data?.predictions?.[0];
    if (!p?.bytesBase64Encoded) throw new Error(`${model}: no image in response`);
    const mime = p.mimeType ?? "image/png";
    return { buffer: Buffer.from(p.bytesBase64Encoded, "base64"), contentType: mime, ext: extFor(mime) };
  }
  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${need("OPENAI_API_KEY")}` },
      body: JSON.stringify({ model, prompt, size: "1024x1536", quality: "medium", n: 1 }),
    });
    if (!res.ok) await failText(res, model);
    const data = await res.json();
    const item = data?.data?.[0];
    if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, "base64"), contentType: "image/png", ext: "png" };
    if (item?.url) return { buffer: await download(item.url), contentType: "image/png", ext: "png" };
    throw new Error(`${model}: no image in response`);
  }
  // fal.ai synchronous endpoint
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${need("FAL_KEY")}` },
    body: JSON.stringify({ prompt, image_size: { width: 1080, height: 1920 }, num_images: 1 }),
  });
  if (!res.ok) await failText(res, model);
  const data = await res.json();
  const url = data?.images?.[0]?.url;
  if (!url) throw new Error(`${model}: no image in response`);
  const mime = data.images[0].content_type ?? "image/jpeg";
  return { buffer: await download(url), contentType: mime, ext: extFor(mime) };
}

/* ---------------- Text to speech ---------------- */

export type TtsProvider = "elevenlabs" | "gemini";

function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function labSpeech(provider: TtsProvider, model: string, text: string, voice: string): Promise<Media> {
  if (provider === "elevenlabs") {
    const { generateSpeech } = await import("@/lib/pipeline/elevenlabs");
    const out = await generateSpeech(text, voice, { modelId: model });
    return {
      buffer: out.audio,
      contentType: "audio/mpeg",
      ext: "mp3",
      note: out.alignment ? "word timings ✓" : "no word timings",
    };
  }
  const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": need("GEMINI_API_KEY") },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Read this as a calm, gripping documentary narrator: ${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || "Charon" } } },
      },
    }),
  });
  if (!res.ok) await failText(res, model);
  const data = await res.json();
  const part = (data?.candidates?.[0]?.content?.parts ?? []).find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data);
  if (!part) throw new Error(`${model}: no audio in response`);
  const mime: string = part.inlineData.mimeType ?? "audio/L16;rate=24000";
  const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
  return { buffer: pcmToWav(Buffer.from(part.inlineData.data, "base64"), rate), contentType: "audio/wav", ext: "wav", note: "no word timings (needs alignment step)" };
}

/* ---------------- Video (async: submit → poll) ---------------- */

export type VideoProvider = "kling" | "veo" | "fal" | "omni";

export interface VideoHandle {
  provider: VideoProvider;
  id: string;
  /** fal: status + result URLs */
  statusUrl?: string;
  responseUrl?: string;
}

export async function labVideoSubmit(
  provider: VideoProvider,
  model: string,
  prompt: string,
  imageUrl?: string
): Promise<VideoHandle> {
  if (provider === "kling") {
    const { submitTextToVideo } = await import("@/lib/pipeline/kling");
    const id = await submitTextToVideo({ prompt, duration: "5", aspectRatio: "9:16", model });
    return { provider, id };
  }
  if (provider === "omni") {
    // Gemini Omni (Interactions API) — runs in the background, polled below.
    const input: unknown[] = [];
    if (imageUrl) {
      const img = await fetch(imageUrl);
      const mime = img.headers.get("content-type") ?? "image/png";
      input.push({ type: "image", data: Buffer.from(await img.arrayBuffer()).toString("base64"), mime_type: mime });
    }
    input.push({ type: "text", text: `${prompt} No dialogue, no music.` });
    const res = await fetch(`${GEMINI}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": need("GEMINI_API_KEY") },
      body: JSON.stringify({
        model,
        input,
        background: true,
        ...(imageUrl ? { generation_config: { video_config: { task: "image_to_video" } } } : {}),
        response_format: { type: "video", aspect_ratio: "9:16", resolution: "720p" },
      }),
    });
    if (!res.ok) await failText(res, model);
    const data = await res.json();
    if (!data?.id) throw new Error(`${model}: no interaction id (${JSON.stringify(data).slice(0, 200)})`);
    return { provider, id: data.id };
  }
  if (provider === "veo") {
    const instance: Record<string, unknown> = { prompt };
    if (imageUrl) {
      const res = await fetch(imageUrl);
      const mime = res.headers.get("content-type") ?? "image/png";
      instance.image = { bytesBase64Encoded: Buffer.from(await res.arrayBuffer()).toString("base64"), mimeType: mime };
    }
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": need("GEMINI_API_KEY") },
      body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: "9:16" } }),
    });
    if (!res.ok) await failText(res, model);
    const data = await res.json();
    if (!data?.name) throw new Error(`${model}: no operation name`);
    return { provider, id: data.name };
  }
  // MiniMax H3 on fal: canvas follows the first-frame image, duration is a
  // number and prompt_expansion_mode is required. Other fal video models take
  // the common aspect_ratio / string duration shape.
  const body = model.startsWith("minimax/")
    ? { prompt, ...(imageUrl ? { image_url: imageUrl } : {}), duration: 5, resolution: "768P", prompt_expansion_mode: process.env.FAL_MINIMAX_EXPANSION || "balanced" }
    : /bytedance|seedance/.test(model)
      ? // Seedance: silent 720p (our voiceover is the soundtrack; audio doubles the price).
        { prompt, ...(imageUrl ? { image_url: imageUrl } : {}), aspect_ratio: "9:16", resolution: "720p", duration: "5", generate_audio: false }
      : { prompt, ...(imageUrl ? { image_url: imageUrl } : {}), aspect_ratio: "9:16", duration: "5" };
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${need("FAL_KEY")}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) await failText(res, model);
  const data = await res.json();
  if (!data?.request_id) throw new Error(`${model}: no request id`);
  return { provider, id: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

export async function labVideoPoll(h: VideoHandle): Promise<{ done: boolean; media?: Media; error?: string }> {
  if (h.provider === "kling") {
    const { getTextToVideoTask } = await import("@/lib/pipeline/kling");
    const t = await getTextToVideoTask(h.id);
    if (t.status === "failed") return { done: true, error: t.statusMessage ?? "failed" };
    if (t.status !== "succeed" || !t.videoUrl) return { done: false };
    return { done: true, media: { buffer: await download(t.videoUrl), contentType: "video/mp4", ext: "mp4" } };
  }
  if (h.provider === "omni") {
    const key = need("GEMINI_API_KEY");
    const res = await fetch(`${GEMINI}/interactions/${encodeURIComponent(h.id)}`, { headers: { "x-goog-api-key": key }, cache: "no-store" });
    if (!res.ok) await failText(res, "omni poll");
    const data = await res.json();
    if (data?.status === "failed" || data?.status === "cancelled") return { done: true, error: JSON.stringify(data?.error ?? data?.status).slice(0, 300) };
    if (data?.status !== "completed") return { done: false };
    for (const step of Array.isArray(data?.steps) ? data.steps : []) {
      for (const c of Array.isArray(step?.content) ? step.content : []) {
        if (c?.type === "video" && c?.data) return { done: true, media: { buffer: Buffer.from(c.data, "base64"), contentType: "video/mp4", ext: "mp4" } };
        if (c?.type === "video" && c?.uri) return { done: true, media: { buffer: await download(c.uri, { "x-goog-api-key": key }), contentType: "video/mp4", ext: "mp4" } };
      }
    }
    return { done: true, error: `no video in interaction: ${JSON.stringify(data).slice(0, 200)}` };
  }
  if (h.provider === "veo") {
    const key = need("GEMINI_API_KEY");
    const res = await fetch(`${GEMINI}/${h.id}`, { headers: { "x-goog-api-key": key }, cache: "no-store" });
    if (!res.ok) await failText(res, "veo poll");
    const data = await res.json();
    if (!data?.done) return { done: false };
    if (data.error) return { done: true, error: JSON.stringify(data.error).slice(0, 300) };
    const uri = data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) return { done: true, error: "no video uri" };
    return { done: true, media: { buffer: await download(uri, { "x-goog-api-key": key }), contentType: "video/mp4", ext: "mp4" } };
  }
  const key = need("FAL_KEY");
  const st = await fetch(h.statusUrl!, { headers: { Authorization: `Key ${key}` }, cache: "no-store" });
  if (!st.ok) await failText(st, "fal status");
  const s = await st.json();
  if (s?.status === "FAILED" || s?.status === "ERROR") return { done: true, error: JSON.stringify(s).slice(0, 300) };
  if (s?.status !== "COMPLETED") return { done: false };
  const rr = await fetch(h.responseUrl!, { headers: { Authorization: `Key ${key}` }, cache: "no-store" });
  if (!rr.ok) await failText(rr, "fal result");
  const r = await rr.json();
  const url = r?.video?.url ?? r?.videos?.[0]?.url;
  if (!url) return { done: true, error: `no video url: ${JSON.stringify(r).slice(0, 200)}` };
  return { done: true, media: { buffer: await download(url), contentType: "video/mp4", ext: "mp4" } };
}


/* ---------------- Discovery ---------------- */

/** Google models available to this key that look relevant (image / video / TTS). */
export async function listGoogleModels(
  filter: RegExp = /image|imagen|veo|omni|tts|banana|video/i
): Promise<Array<{ name: string; methods: string[] }>> {
  const key = need("GEMINI_API_KEY");
  const out: Array<{ name: string; methods: string[] }> = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${GEMINI}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: { "x-goog-api-key": key }, cache: "no-store" });
    if (!res.ok) await failText(res, "list models");
    const data = await res.json();
    for (const m of data?.models ?? []) {
      const name = String(m.name ?? "").replace(/^models\//, "");
      if (filter.test(name)) out.push({ name, methods: m.supportedGenerationMethods ?? [] });
    }
    pageToken = data?.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}
