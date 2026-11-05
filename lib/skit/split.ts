// lib/skit/split.ts
// Skit lines too long for one talking clip (Veo: 8 s) are split into consecutive
// shots of the same speaker, every word kept (5 Nov 2026). Pure, so it is tested.

import { wordsPerSecond } from "@/lib/pipeline/narration";
import type { SkitShot } from "./skit";

/** Longest line (seconds of speech) that fits one talking clip: 8 s minus a breath each side. */
const MAX_CLIP_SPEECH = 7.2;
export function speechSeconds(text: string, language: string): number {
  return text.split(/\s+/).filter(Boolean).length / wordsPerSecond(language) + 0.4;
}

/** Break `text` into pieces that each fit one clip: at sentence ends first, then at commas. */
export function chunkLine(text: string, language: string): string[] {
  const fits = (t: string) => speechSeconds(t, language) <= MAX_CLIP_SPEECH;
  if (fits(text)) return [text];
  const pieces = (re: RegExp) => text.match(re)?.map((p) => p.trim()).filter(Boolean) ?? [text];
  for (const parts of [pieces(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g), pieces(/[^,;:]+[,;:]?|[^,;:]+$/g)]) {
    if (parts.length < 2) continue;
    const out: string[] = [];
    let cur = "";
    for (const p of parts) {
      const next = cur ? `${cur} ${p}` : p;
      if (cur && !fits(next)) {
        out.push(cur);
        cur = p;
      } else cur = next;
    }
    if (cur) out.push(cur);
    if (out.length > 1 && out.every(fits)) return out;
  }
  return [text]; // one sentence too long to break: it keeps TTS + lip-sync
}

/**
 * Lines too long for one talking clip become consecutive shots of the same speaker
 * (every word kept), alternating medium / close-up so the cut reads as a reaction cut.
 */
export function splitLongLines(shots: SkitShot[], language: string, maxShots: number): SkitShot[] {
  const out: SkitShot[] = [];
  shots.forEach((s, i) => {
    const room = maxShots - out.length - (shots.length - i - 1);
    const parts = s.line && room > 1 ? chunkLine(s.line, language).slice(0, room) : [s.line];
    if (parts.length < 2) return void out.push(s);
    // If the cap cut pieces off, the last kept piece carries the rest of the line.
    const all = chunkLine(s.line, language);
    if (all.length > parts.length) parts[parts.length - 1] = all.slice(parts.length - 1).join(" ");
    parts.forEach((line, k) =>
      out.push({
        ...s,
        id: k === 0 ? s.id : `${s.id}-${k + 1}`,
        line,
        camera: k === 0 ? s.camera : k % 2 ? "close-up" : "medium",
        sfx: k === 0 ? s.sfx : "",
        crowd: k === 0 ? s.crowd : "",
      })
    );
  });
  return out;
}

