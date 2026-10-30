// lib/pipeline/narration.ts
// Narration length maths shared by the script prompt and tests. Pure.

/**
 * Spoken-word range for a duration label. Measured narration rate with
 * ElevenLabs Multilingual v2 (Turkish, Liam): 2.0–2.6 words/s. We aim for the
 * target duration ±~8% so a "30 seconds" video really is ~30 s.
 */
export const WORDS_PER_SECOND = 2.3;

/**
 * Measured narration rate (ElevenLabs Multilingual v2) by language, in
 * words/second. Agglutinative languages pack more syllables per word, so a
 * 60 s Turkish script is ~110 words, not ~140 (29–30 Oct: 142–144 Turkish
 * words came out at 71–81 s).
 */
const WORDS_PER_SECOND_BY_LANGUAGE: Record<string, number> = {
  en: 2.4,
  es: 2.4,
  fr: 2.3,
  it: 2.3,
  pt: 2.3,
  nl: 2.1,
  de: 1.9,
  tr: 1.85,
  pl: 1.9,
  ru: 1.9,
  uk: 1.9,
  cs: 1.9,
  sk: 1.9,
  hr: 1.9,
  ro: 2.1,
  bg: 1.9,
  el: 2.0,
  fi: 1.7,
  sv: 2.1,
  da: 2.1,
  ar: 2.0,
  hi: 2.1,
  ta: 1.8,
  id: 2.1,
  ms: 2.1,
  fil: 2.1,
};

export function wordsPerSecond(languageCode?: string | null): number {
  return WORDS_PER_SECOND_BY_LANGUAGE[(languageCode ?? "").toLowerCase()] ?? WORDS_PER_SECOND;
}

export function wordRange(
  duration: string | null | undefined,
  languageCode?: string | null
): { min: number; target: number; max: number; seconds: number } {
  const d = (duration ?? "60 seconds").toLowerCase();
  const n = Number(d.match(/\d+/)?.[0] ?? 60);
  const seconds = d.includes("minute") ? n * 60 : n;
  const target = Math.round(seconds * wordsPerSecond(languageCode));
  return { min: Math.round(target * 0.92), target, max: Math.round(target * 1.08), seconds };
}

/** Word range that would make `count` words (measured at `ratio` = spoken/target) fit the target. */
export function rangeForMeasuredRatio(count: number, ratio: number, seconds: number) {
  const target = Math.max(10, Math.round(count / ratio));
  return { min: Math.round(target * 0.94), target, max: Math.round(target * 1.06), seconds };
}

/** Words in the spoken narration (hook + script). */
export function narrationWordCount(hook: string, script: string): number {
  return `${hook} ${script}`.split(/\s+/).filter(Boolean).length;
}

