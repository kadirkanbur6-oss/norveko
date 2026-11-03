// lib/pipeline/gemini-image.ts
// Gemini (Nano Banana 2) ile thumbnail üretimi + Supabase Storage'a yükleme.
// Server-side only — service role key kullanır.

import { createClient } from "@supabase/supabase-js";
import { stillPrompt, visualStyle } from "./visual-styles";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set.");
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase URL or SERVICE_ROLE_KEY is not set.");
}

// Storage'a yazmak için admin client (RLS'i aşar — sadece server-side!)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";
/**
 * Scene stills for full videos. Nano Banana 2.1 won the 31 Oct model-lab
 * comparison: same quality as 3.1 Flash Image at half the price ($0.034).
 * Thumbnails (readable overlay text) stay on GEMINI_IMAGE_MODEL for now.
 */
export const GEMINI_SCENE_IMAGE_MODEL = process.env.GEMINI_SCENE_IMAGE_MODEL || "gemini-nano-banana-2.1";

/** Recurring characters to keep consistent: name + reference images (base64). */
export interface CharacterRef {
  name: string;
  description?: string;
  images: Array<{ mimeType: string; data: string }>;
}

/** Leading parts that show the model who each character is. */
function referenceParts(refs: CharacterRef[] | undefined): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const ref of (refs ?? []).slice(0, 3)) {
    if (!ref.images.length) continue;
    parts.push({
      text: `Reference images of the character "${ref.name}"${ref.description ? ` (${ref.description})` : ""}. Wherever ${ref.name} appears in the image you create, keep exactly this person's face, age, skin tone, hair and build — the same identity, newly posed for the scene.`,
    });
    for (const img of ref.images.slice(0, 3)) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }
  return parts;
}

function firstImage(data: unknown): { base64: string; mimeType: string } | null {
  type InlinePart = { data?: string; mimeType?: string; mime_type?: string };
  const parts: Array<{ inlineData?: InlinePart; inline_data?: InlinePart }> =
    (data as { candidates?: Array<{ content?: { parts?: unknown[] } }> })?.candidates?.[0]?.content?.parts as never ?? [];
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) return { base64: inline.data, mimeType: inline.mimeType ?? inline.mime_type ?? "image/png" };
  }
  return null;
}

/**
 * A neutral reference portrait for an invented character, or a photoreal
 * rendering of a historical figure from a portrait painting. Returns bytes.
 */
export async function generateReferencePortrait(args: {
  name: string;
  description: string;
  fromImage?: { mimeType: string; data: string } | null;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const parts: Array<Record<string, unknown>> = [];
  if (args.fromImage) {
    parts.push({ text: `This is a historical portrait of ${args.name}.` });
    parts.push({ inlineData: args.fromImage });
  }
  parts.push({
    text: `Character reference sheet photo of ${args.name}${args.description ? `: ${args.description}` : ""}. ${
      args.fromImage ? "Photorealistic, the same face and features as the portrait, period-accurate clothing and headwear." : "Keep the look the description asks for (for example a cartoon, 3D animated or anime character, or an animal); if it names no look, photorealistic."
    } Head and shoulders, facing the camera, neutral expression, plain mid-grey background, soft even studio light, sharp focus, no text, no logos.`,
  });
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SCENE_IMAGE_MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { imageConfig: { aspectRatio: "3:4" } } }),
  });
  if (!res.ok) throw new Error(`Gemini image API error (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const img = firstImage(await res.json());
  if (!img) throw new Error("Gemini response contained no image.");
  return { bytes: Buffer.from(img.base64, "base64"), mimeType: img.mimeType };
}

interface ThumbnailResult {
  imageUrl: string; // public URL — usable directly as <img src>
  storagePath: string;
}

export async function generateThumbnail(
  prompt: string,
  jobId: string,
  orientation: "vertical" | "horizontal" = "horizontal",
  styleId?: string | null,
  refs?: CharacterRef[]
): Promise<ThumbnailResult> {
  const aspectRatio = orientation === "vertical" ? "9:16" : "16:9";
  // 1) Gemini'den görseli iste
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              ...referenceParts(refs),
              {
                text: `${orientation === "vertical" ? "Vertical short-form cover" : "YouTube thumbnail"}, ${aspectRatio} aspect ratio, high contrast, bold and readable overlay text, ${styleId ? visualStyle(styleId).thumbnail : "cinematic lighting."} ${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          imageConfig: { aspectRatio },
        },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini image API error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();

  // 2) Yanıttaki base64 görseli bul.
  // Görsel, parts dizisinde inlineData (bazı sürümlerde inline_data) olarak gelir.
  type InlinePart = { data?: string; mimeType?: string; mime_type?: string };
  const parts: Array<{ inlineData?: InlinePart; inline_data?: InlinePart }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  let base64: string | null = null;
  let mimeType = "image/png";

  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      base64 = inline.data;
      mimeType = inline.mimeType ?? inline.mime_type ?? "image/png";
      break;
    }
  }

  if (!base64) {
    throw new Error("Gemini response contained no image.");
  }

  // 3) Supabase Storage'a yükle
  const extension = mimeType.includes("jpeg") ? "jpg" : "png";
  const storagePath = `${jobId}.${extension}`;
  const buffer = Buffer.from(base64, "base64");

  const { error: uploadError } = await supabaseAdmin.storage
    .from("thumbnails")
    .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

  if (uploadError) {
    throw new Error(`Thumbnail upload to Storage failed: ${uploadError.message}`);
  }

  // 4) Public URL üret
  const { data: urlData } = supabaseAdmin.storage
    .from("thumbnails")
    .getPublicUrl(storagePath);

  return { imageUrl: urlData.publicUrl, storagePath };
}
/* ---------------- Scene stills for full videos ---------------- */

export interface SceneImageResult {
  imageUrl: string;
  storagePath: string;
}

/**
 * One cinematic still for a scene of a full video (Ken Burns is applied at
 * render time). No overlay text — unlike thumbnails, these are B-roll.
 * Stored in the `videos` bucket next to the job's clips.
 */
export async function generateSceneImage(
  prompt: string,
  jobId: string,
  userId: string,
  sceneNumber: number,
  orientation: "vertical" | "horizontal" = "vertical",
  styleId?: string | null,
  refs?: CharacterRef[]
): Promise<SceneImageResult> {
  const aspectRatio = orientation === "vertical" ? "9:16" : "16:9";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_SCENE_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              ...referenceParts(refs),
              {
                text: stillPrompt(prompt, styleId, aspectRatio),
              },
            ],
          },
        ],
        generationConfig: { imageConfig: { aspectRatio } },
      }),
    }
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini image API error (${res.status}): ${errBody.slice(0, 300)}`);
  }
  const data = await res.json();
  type InlinePart = { data?: string; mimeType?: string; mime_type?: string };
  const parts: Array<{ inlineData?: InlinePart; inline_data?: InlinePart }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  let base64: string | null = null;
  let mimeType = "image/png";
  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      base64 = inline.data;
      mimeType = inline.mimeType ?? inline.mime_type ?? "image/png";
      break;
    }
  }
  if (!base64) throw new Error("Gemini response contained no image.");

  const extension = mimeType.includes("jpeg") ? "jpg" : "png";
  const storagePath = `${userId}/${jobId}/still-${sceneNumber}.${extension}`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from("videos")
    .upload(storagePath, Buffer.from(base64, "base64"), { contentType: mimeType, upsert: true });
  if (uploadError) throw new Error(`Scene image upload failed: ${uploadError.message}`);
  const { data: urlData } = supabaseAdmin.storage.from("videos").getPublicUrl(storagePath);
  return { imageUrl: urlData.publicUrl, storagePath };
}
