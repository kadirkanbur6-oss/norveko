// lib/animate/animate.ts
// Image to video (10 Nov 2026, Yağmur): the creator uploads a picture and says what
// should happen; the picture is the first frame and the reference, Seedance 1.5 Pro
// (fal) animates it. Silent, 720p, 5 or 10 s. Stored in swap_jobs with kind = "animate"
// (source_path = the uploaded picture), advanced by the same heartbeat and polling as
// swaps and talks (lib/swap/swap.ts).

import "server-only";
import { geminiJson } from "@/lib/characters/characters";

export const ANIMATE_SECONDS = [5, 10] as const;
export const ANIMATE_MAX_BYTES = 8 * 1024 * 1024;
export const ANIMATE_MAX_CHARS = 500;

export const IMAGE_TYPES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const IMAGE_CONTENT_TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

export { animateCreditsFor as animateCredits, animateSpeechCreditsFor as animateSpeechCredits } from "@/lib/skit/pricing";

/** A voice track for the picture (typed line or recording) can be this long. */
export const ANIMATE_SPEECH_MAX_SECONDS = 30;

export function isAnimateSeconds(n: unknown): n is (typeof ANIMATE_SECONDS)[number] {
  return ANIMATE_SECONDS.includes(n as 5 | 10);
}

/** Vision check before anything is charged: no children, nothing explicit or graphic. */
export async function checkAnimateImage(bytes: Buffer, mimeType: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await geminiJson([
    { text: 'Look at this picture. Answer as JSON: {"child": boolean (does any visible person look under 18?), "explicit": boolean (nudity or sexual content), "graphicViolence": boolean}' },
    { inlineData: { mimeType, data: bytes.toString("base64") } },
  ]).catch(() => null);
  if (!r) return { ok: false, reason: "We couldn't check this picture right now. Please try again." };
  if (r.child === true) return { ok: false, reason: "Pictures with children can't be turned into videos." };
  if (r.explicit === true || r.graphicViolence === true) return { ok: false, reason: "This picture can't be used." };
  return { ok: true };
}

export function animatePrompt(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t || "Bring this picture to life with subtle, natural motion and a gentle camera move.";
}

/** Lip-sync prompt: the user's motion note first, then the speaking behaviour. */
export function animateSpeechPrompt(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const base = "The person in the picture speaks to the camera with natural lip movement, lively expressions and small head and hand movements that match the voice. Keep the person's look exactly the same.";
  return t ? `${t}. ${base}` : base;
}
