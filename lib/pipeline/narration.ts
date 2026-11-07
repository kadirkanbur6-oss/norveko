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

/**
 * Narration plays this much faster than the measured rates above: Gemini audio
 * is time-stretched (lib/pipeline/tempo.ts) and ElevenLabs gets speed 1.2.
 * 7 Nov 2026, Yağmur: "1.25'e alınca ideal oluyor". Scripts get longer to match.
 */
export const NARRATION_TEMPO = 1.25;

/** Words per second of the finished narration (measured rate × NARRATION_TEMPO). */
export function narrationWordsPerSecond(languageCode?: string | null): number {
  return Math.round(wordsPerSecond(languageCode) * NARRATION_TEMPO * 100) / 100;
}

export function wordRange(
  duration: string | null | undefined,
  languageCode?: string | null
): { min: number; target: number; max: number; seconds: number } {
  const d = (duration ?? "60 seconds").toLowerCase();
  const n = Number(d.match(/\d+/)?.[0] ?? 60);
  const seconds = d.includes("minute") ? n * 60 : n;
  // Long-form: the Norveko narrators read ~6 % faster than our per-language
  // rates (10-min Turkish test: 962 words → 8:11), and long drafts tend to
  // come in short, so aim a little higher.
  const target = Math.round(seconds * narrationWordsPerSecond(languageCode) * (seconds > 60 ? 1.06 : 1));
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

/** Splice `text` in after each exact `after` sentence (first match; unknown anchors are skipped). */
export function insertAdditions(script: string, additions: Array<{ after?: unknown; text?: unknown }>): string {
  let out = script;
  for (const a of additions) {
    const after = typeof a.after === "string" ? a.after.trim() : "";
    const text = typeof a.text === "string" ? a.text.replace(/\s+/g, " ").trim() : "";
    if (!after || !text || after.length < 12) continue;
    const at = out.indexOf(after);
    if (at < 0) continue;
    const end = at + after.length;
    out = `${out.slice(0, end)} ${text}${out.slice(end)}`;
  }
  return out;
}
