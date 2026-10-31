// lib/pipeline/tts-estimate.ts
// Pure fallback timing estimate for narration without forced alignment.

import type { CharacterAlignment } from "./captions";

/**
 * Approximate per-character timings over `seconds` of audio: every character
 * gets one unit, spaces a little less, and punctuation adds a pause, so cue
 * breaks land near the spoken ones. Used only when forced alignment fails.
 */
export function estimateAlignment(text: string, seconds: number): CharacterAlignment {
  const chars = Array.from(text);
  const weight = (c: string) => (/[.!?…]/.test(c) ? 6 : /[,;:—–-]/.test(c) ? 3 : /\s/.test(c) ? 0.6 : 1);
  const weights = chars.map(weight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const lead = Math.min(0.15, seconds * 0.01);
  const span = Math.max(0.1, seconds - lead * 2);
  const starts: number[] = [];
  const ends: number[] = [];
  let t = lead;
  for (const w of weights) {
    const d = (w / total) * span;
    starts.push(Math.round(t * 1000) / 1000);
    t += d;
    ends.push(Math.round(t * 1000) / 1000);
  }
  return { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends };
}
