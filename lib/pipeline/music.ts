// lib/pipeline/music.ts
// Background music for full videos. Tracks are Kevin MacLeod's CC BY 4.0
// catalogue (incompetech.com): free for commercial use as long as the credit
// below is given, so `musicCredit()` is appended to the generated description.
// Durations were checked on 29 Oct 2026; every track is ≥ 60 s so a 60 s
// Short never runs out of music. Pure module (no env) — safe for tests.

import type { STYLES } from "./options";

export type MusicMood = "mystery" | "horror" | "documentary" | "educational" | "cinematic" | "upbeat";

export interface MusicTrack {
  id: string;
  title: string;
  mood: MusicMood;
  /** Source file (mirrored into our own bucket on first use). */
  sourceUrl: string;
  seconds: number;
}

const INCOMPETECH = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/";
const track = (id: string, title: string, mood: MusicMood, seconds: number): MusicTrack => ({
  id,
  title,
  mood,
  seconds,
  sourceUrl: `${INCOMPETECH}${encodeURIComponent(title)}.mp3`,
});

export const MUSIC_TRACKS: MusicTrack[] = [
  track("dark-fog", "Dark Fog", "mystery", 239),
  track("hidden-agenda", "Hidden Agenda", "mystery", 135),
  track("crypto", "Crypto", "mystery", 204),
  track("night-vigil", "Night Vigil", "mystery", 288),
  track("unseen-horrors", "Unseen Horrors", "horror", 251),
  track("ghost-story", "Ghost Story", "horror", 320),
  track("darkest-child", "Darkest Child", "horror", 239),
  track("lightless-dawn", "Lightless Dawn", "horror", 380),
  track("lost-frontier", "Lost Frontier", "documentary", 265),
  track("heart-of-nowhere", "Heart of Nowhere", "documentary", 172),
  track("the-descent", "The Descent", "documentary", 192),
  track("deep-haze", "Deep Haze", "documentary", 122),
  track("thinking-music", "Thinking Music", "educational", 196),
  track("floating-cities", "Floating Cities", "educational", 184),
  track("inspired", "Inspired", "upbeat", 286),
  track("impact-prelude", "Impact Prelude", "cinematic", 203),
  track("mesmerize", "Mesmerize", "cinematic", 424),
];

/** Map the form's style to a music mood. */
export function moodForStyle(style: string | null | undefined): MusicMood {
  switch ((style ?? "") as (typeof STYLES)[number] | "") {
    case "Mystery":
      return "mystery";
    case "Horror":
      return "horror";
    case "Documentary":
      return "documentary";
    case "Educational":
      return "educational";
    case "Ad / Promo":
      return "upbeat";
    case "Cinematic":
      return "cinematic";
    default:
      return "documentary";
  }
}

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Deterministic pick per job so retries render the same video. */
export function pickMusicTrack(style: string | null | undefined, seed: string): MusicTrack {
  const mood = moodForStyle(style);
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
