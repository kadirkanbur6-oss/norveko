// lib/pipeline/tts-chunks.ts
// Pure helpers for long narrations (1 Nov 2026, long-form full videos): TTS
// providers cap one request (Gemini ≈ 8 min of audio, ElevenLabs 10k chars),
// so a long script is spoken in sentence-aligned chunks and stitched.

import type { CharacterAlignment } from "./captions";

/** Narrations longer than this are spoken in chunks. */
export const TTS_CHUNK_CHARS = 1600;

/** Split text into ≤ `max`-character chunks at sentence (then word) boundaries. */
export function splitForTts(text: string, max = TTS_CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["'”»)]*\s*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  const chunks: string[] = [];
  let cur = "";
  const push = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > max) {
      push();
      // A run-on sentence: cut at word boundaries.
      let part = "";
      for (const word of sentence.split(" ")) {
        if ((part + " " + word).trim().length > max) {
          chunks.push(part.trim());
          part = word;
        } else part = `${part} ${word}`;
      }
      cur = part.trim();
      continue;
    }
    if ((cur + " " + sentence).trim().length > max) push();
    cur = `${cur} ${sentence}`.trim();
  }
  push();
  return chunks;
}

/** Join per-chunk alignments into one timeline (chunk i starts at offsets[i]; a space joins chunks). */
export function mergeAlignments(parts: CharacterAlignment[], offsets: number[]): CharacterAlignment {
  const out: CharacterAlignment = { characters: [], character_start_times_seconds: [], character_end_times_seconds: [] };
  parts.forEach((a, i) => {
    const off = offsets[i] ?? 0;
    if (i > 0) {
      const t = Math.round(off * 1000) / 1000;
      out.characters.push(" ");
      out.character_start_times_seconds.push(t);
      out.character_end_times_seconds.push(t);
    }
    a.characters.forEach((c, j) => {
      out.characters.push(c);
      out.character_start_times_seconds.push(Math.round((a.character_start_times_seconds[j] + off) * 1000) / 1000);
      out.character_end_times_seconds.push(Math.round((a.character_end_times_seconds[j] + off) * 1000) / 1000);
    });
  });
  return out;
}

/** Seconds of a CBR MP3 from its byte length (ElevenLabs mp3_44100_128). */
export function mp3Seconds(bytes: number, kbps = 128): number {
  return (bytes * 8) / (kbps * 1000);
}

/** Run `fn` over items with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
