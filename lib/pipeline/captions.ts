// lib/pipeline/captions.ts
// Turns ElevenLabs character-level alignment into subtitle cues, and renders
// cues as SRT / WebVTT. Pure functions, no I/O — safe to import anywhere.
//
// Flow: alignment (one entry per character, with start/end seconds)
//   → words (group characters between whitespace)
//   → cues (group words into readable, time-bounded lines)
//   → SRT / VTT text.

export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface TimedWord {
  text: string;
  start: number; // seconds
  end: number;
}

export interface CaptionCue {
  /** Seconds from the start of the audio. */
  start: number;
  end: number;
  /** Up to two lines, joined with "\n". */
  text: string;
}

/** Caption layout rules (industry defaults for short-form video). */
export const CAPTION_RULES = {
  maxCharsPerLine: 38,
  maxLines: 2,
  /** A cue never stays on screen longer than this. */
  maxDurationSec: 5,
  /** A cue never flashes shorter than this (extended when the gap allows). */
  minDurationSec: 0.8,
  /** A pause between words longer than this ends the current cue. */
  pauseBreakSec: 0.6,
} as const;

/** Group characters into words using whitespace as the separator. */
export function alignmentToWords(alignment: CharacterAlignment): TimedWord[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } =
    alignment;
  const words: TimedWord[] = [];
  let buf = "";
  let start = 0;
  let end = 0;

  const flush = () => {
    if (buf.trim()) words.push({ text: buf.trim(), start, end });
    buf = "";
  };

  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i] ?? "";
    const s = starts[i];
    const e = ends[i];
    if (/\s/.test(ch)) {
      flush();
      continue;
    }
    if (!buf) start = typeof s === "number" ? s : end;
    buf += ch;
    if (typeof e === "number") end = e;
  }
  flush();
  return words;
}

const SENTENCE_END = /[.!?…]["'”’)]?$/;
const CLAUSE_END = /[,;:—–-]["'”’)]?$/;

/**
 * Pack words into cues. A cue closes when adding the next word would exceed
 * the line budget or the max duration, when there is a long pause, or right
 * after a sentence end once the cue is reasonably full.
 */
export function wordsToCues(
  words: TimedWord[],
  rules: typeof CAPTION_RULES = CAPTION_RULES
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let current: TimedWord[] = [];

  const textOf = (ws: TimedWord[]) => ws.map((w) => w.text).join(" ");

  const close = () => {
    if (!current.length) return;
    cues.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: wrapLines(textOf(current), rules.maxCharsPerLine, rules.maxLines),
    });
    current = [];
  };

  for (const word of words) {
    if (current.length) {
      const last = current[current.length - 1];
      const candidate = textOf([...current, word]);
      const tooLong = !fitsLines(candidate, rules.maxCharsPerLine, rules.maxLines);
      const tooSlow = word.end - current[0].start > rules.maxDurationSec;
      const pause = word.start - last.end > rules.pauseBreakSec;
      const sentenceDone =
        SENTENCE_END.test(last.text) && textOf(current).length >= rules.maxCharsPerLine * 0.6;
      const clauseDone =
        CLAUSE_END.test(last.text) && textOf(current).length >= rules.maxCharsPerLine * 1.4;
      if (tooLong || tooSlow || pause || sentenceDone || clauseDone) close();
    }
    current.push(word);
  }
  close();

  // Enforce the minimum display time without overlapping the next cue.
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const next = cues[i + 1];
    const minEnd = cue.start + rules.minDurationSec;
    if (cue.end < minEnd) cue.end = next ? Math.min(minEnd, next.start) : minEnd;
    cue.start = round3(cue.start);
    cue.end = round3(Math.max(cue.end, cue.start + 0.2));
  }
  return cues;
}

/** Greedy wrap: as many words per line as fit. Never drops words. */
export function greedyLines(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const next = line ? `${line} ${w}` : w;
    if (line && next.length > maxCharsPerLine) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** True when the text fits the line budget without dropping anything. */
export function fitsLines(text: string, maxCharsPerLine: number, maxLines: number): boolean {
  return greedyLines(text, maxCharsPerLine).length <= maxLines;
}

/**
 * Balanced wrap: break near the middle at a word boundary so the two lines
 * have similar length. Falls back to greedy if balancing would need an extra
 * line. Callers guarantee the text fits (see fitsLines).
 */
export function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string {
  if (text.length <= maxCharsPerLine || maxLines < 2) return text;
  const greedy = greedyLines(text, maxCharsPerLine);
  if (greedy.length < 2) return text;
  const lineCount = Math.min(maxLines, greedy.length);
  const target = Math.ceil(text.length / lineCount);
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    const next = line ? `${line} ${w}` : w;
    const wantBreak = next.length > maxCharsPerLine || (next.length > target && lines.length < lineCount - 1);
    if (line && wantBreak) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return (lines.length <= maxLines ? lines : greedy).join("\n");
}

/** One-shot helper used by the pipeline worker. */
export function alignmentToCues(alignment: CharacterAlignment): CaptionCue[] {
  return wordsToCues(alignmentToWords(alignment));
}

/* ------------------------------ Renderers ------------------------------ */

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

function timestamp(sec: number, msSeparator: "," | "."): string {
  const total = Math.max(0, sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}${msSeparator}${pad(ms, 3)}`;
}

/** Locale-aware uppercase (Turkish i → İ, ı → I; Shotstack's own transform gets this wrong). */
export function upper(text: string, locale?: string): string {
  try {
    return locale ? text.toLocaleUpperCase(locale) : text.toUpperCase();
  } catch {
    return text.toUpperCase();
  }
}

export function cuesToSrt(cues: CaptionCue[], options: { uppercase?: string | false } = {}): string {
  const tx = (t: string) => (options.uppercase ? upper(t, options.uppercase) : t);
  return cues
    .map((c, i) => `${i + 1}\n${timestamp(c.start, ",")} --> ${timestamp(c.end, ",")}\n${tx(c.text)}\n`)
    .join("\n");
}

export function cuesToVtt(cues: CaptionCue[]): string {
  const body = cues
    .map((c) => `${timestamp(c.start, ".")} --> ${timestamp(c.end, ".")}\n${c.text}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
