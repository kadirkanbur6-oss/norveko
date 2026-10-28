// lib/pipeline/narration.ts
// Narration length maths shared by the script prompt and tests. Pure.

/**
 * Spoken-word range for a duration label. Measured narration rate with
 * ElevenLabs Multilingual v2 (Turkish, Liam): 2.0–2.6 words/s. We aim for the
 * target duration ±~8% so a "30 seconds" video really is ~30 s.
 */
export const WORDS_PER_SECOND = 2.3;
export function wordRange(duration: string | null | undefined): { min: number; target: number; max: number; seconds: number } {
  const d = (duration ?? "60 seconds").toLowerCase();
  const n = Number(d.match(/\d+/)?.[0] ?? 60);
  const seconds = d.includes("minute") ? n * 60 : n;
  const target = Math.round(seconds * WORDS_PER_SECOND);
  return { min: Math.round(target * 0.92), target, max: Math.round(target * 1.08), seconds };
}

/** Words in the spoken narration (hook + script). */
export function narrationWordCount(hook: string, script: string): number {
  return `${hook} ${script}`.split(/\s+/).filter(Boolean).length;
}

