// lib/pipeline/music.ts
// Background music for full videos. Tracks are Kevin MacLeod's CC BY 4.0
// catalogue (incompetech.com): free for commercial use as long as the credit
// below is given, so `musicCredit()` is appended to the generated description.
// Durations were checked on 29 Oct 2026; every track is ≥ 60 s so a 60 s
// Short never runs out of music. Pure module (no env) — safe for tests.

import type { STYLES } from "./options";

export const MUSIC_MOODS = ["tragic", "eerie", "tense", "mysterious", "epic", "wonder", "upbeat"] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

export interface MusicTrack {
  id: string;
  title: string;
  mood: MusicMood;
  /** Source file (mirrored into our own bucket on first use). */
  sourceUrl: string;
  seconds: number;
}

const INCOMPETECH = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/";
const track = (title: string, mood: MusicMood, length: string): MusicTrack => {
  const [m, sec] = length.split(":").map(Number);
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    title,
    mood,
    seconds: m * 60 + sec,
    sourceUrl: `${INCOMPETECH}${encodeURIComponent(title)}.mp3`,
  };
};

/**
 * Curated 31 Oct 2026 from Kevin MacLeod's OWN catalogue metadata
 * (incompetech pieces.json "feel" tags — checked via /lab "music-catalog"),
 * not from titles: the old list had "Hidden Agenda" (Humorous) under mystery,
 * "Thinking Music" (Humorous) under educational and "Ghost Story" (Calming)
 * under horror. Never add a piece tagged Humorous/Bouncy/Grooving to a
 * serious mood.
 */
export const MUSIC_TRACKS: MusicTrack[] = [
  // tragic — Somber (+Dark/Calming): deaths, disasters, loss
  track("Lost Time", "tragic", "3:47"),
  track("Dark Times", "tragic", "3:04"),
  track("Sad Trio", "tragic", "4:12"),
  track("Night Vigil", "tragic", "4:48"),
  track("Lamentation", "tragic", "3:18"),
  track("Disquiet", "tragic", "3:05"),
  track("Despair and Triumph", "tragic", "4:46"),
  track("Anguish", "tragic", "3:59"),
  // eerie — Dark, Eerie, Unnerving: horror, paranormal, hauntings
  track("Unseen Horrors", "eerie", "4:11"),
  track("Darkest Child", "eerie", "3:59"),
  track("Penumbra", "eerie", "4:56"),
  track("Vanishing", "eerie", "3:55"),
  track("Gathering Darkness", "eerie", "4:25"),
  track("Distant Tension", "eerie", "3:48"),
  track("Cryptic Sorrow", "eerie", "8:00"),
  // tense — Suspenseful/Unnerving: crimes, investigations, unexplained danger
  track("Crypto", "tense", "3:24"),
  track("Lost Frontier", "tense", "4:25"),
  track("Echoes of Time v2", "tense", "4:45"),
  track("Interloper", "tense", "4:23"),
  // mysterious — Mysterious/Mystical, not scary: puzzles, ancient secrets
  track("Aftermath", "mysterious", "3:13"),
  track("Lightless Dawn", "mysterious", "6:20"),
  track("Long Note Four", "mysterious", "10:00"),
  track("Heart of Nowhere", "mysterious", "2:52"),
  track("Impact Lento", "mysterious", "3:31"),
  track("Myst on the Moor", "mysterious", "3:49"),
  // epic — Epic: battles, empires, great achievements
  track("Long Road Ahead", "epic", "2:26"),
  track("Majestic Hills", "epic", "3:19"),
  track("Hero Down", "epic", "3:34"),
  track("Danse Macabre", "epic", "6:46"),
  track("Americana", "epic", "3:22"),
  // wonder — Calming + Bright/Uplifting: science, nature, how things work
  track("Airship Serenity", "wonder", "4:00"),
  track("Infinite Perspective", "wonder", "5:45"),
  track("Aretes", "wonder", "4:36"),
  track("Living Voyage", "wonder", "3:29"),
  track("Brittle Rille", "wonder", "3:49"),
  // upbeat — Bright/Uplifting + Driving: ads, positive news
  track("Inspired", "upbeat", "4:46"),
  track("Nonstop", "upbeat", "3:11"),
  track("Realizer", "upbeat", "5:10"),
  track("Dance Monster", "upbeat", "3:20"),
];

export function isMusicMood(v: unknown): v is MusicMood {
  return typeof v === "string" && (MUSIC_MOODS as readonly string[]).includes(v);
}

/** Fallback when the script writer gave no mood: map the form's style. */
export function moodForStyle(style: string | null | undefined): MusicMood {
  switch ((style ?? "") as (typeof STYLES)[number] | "") {
    case "Mystery":
      return "mysterious";
    case "Horror":
      return "eerie";
    case "Documentary":
      return "mysterious";
    case "Educational":
      return "wonder";
    case "Ad / Promo":
      return "upbeat";
    case "Cinematic":
      return "epic";
    default:
      return "mysterious";
  }
}

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Deterministic pick per job so retries render the same video. The script
 * writer's `musicMood` (chosen from the story's tone) wins over the style;
 * `trackId` forces a specific piece (re-render with different music).
 */
export function pickMusicTrack(
  style: string | null | undefined,
  seed: string,
  opts: { mood?: unknown; trackId?: unknown } = {}
): MusicTrack {
  if (typeof opts.trackId === "string") {
    const forced = MUSIC_TRACKS.find((t) => t.id === opts.trackId);
    if (forced) return forced;
  }
  const mood = isMusicMood(opts.mood) ? opts.mood : moodForStyle(style);
  const pool = MUSIC_TRACKS.filter((t) => t.mood === mood);
  const list = pool.length ? pool : MUSIC_TRACKS;
  return list[hash(seed) % list.length];
}

/** Attribution line required by CC BY 4.0 — appended to the video description. */
export function musicCredit(t: Pick<MusicTrack, "title">): string {
  return `Music: "${t.title}" by Kevin MacLeod (incompetech.com), licensed under Creative Commons: By Attribution 4.0 — creativecommons.org/licenses/by/4.0/`;
}

/** Background level under narration (≈ -18 dB). */
export const MUSIC_VOLUME = 0.13;
