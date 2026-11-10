// lib/skit/pricing.ts
// Credit prices of skits, talking characters and character swaps (pure, client-safe:
// the billing page and landing use them too). The makers in lib/skit, lib/talk and
// lib/swap charge with exactly these functions.

import { AVATAR_COST_PER_SECOND, RENDER_CREDITS_PER_30S, creditsForCost } from "@/lib/pipeline/steps";

export const SKIT_IMAGE_COST = 0.04;
export const SKIT_CLIP_COST = 0.13;
export const SKIT_SFX_COST = 0.03;
export const SKIT_PLAN_COST = 0.03;
/** A crowd shout: the words in a few voices at once. */
export const SKIT_CROWD_COST = 0.02;

/**
 * Skits sell at a 35 % gross margin instead of the usual 40 %. They started at 30 %
 * (5 Nov 2026, Kadir: talking shots moved to Veo 3.1 Fast, which doubled their cost,
 * and a skit should still fit in a Starter pack); raised to 35 % on 7 Nov 2026
 * (Yağmur: margins were too thin to cover the fixed costs). Talk and swap keep 40 %.
 */
export const SKIT_MARGIN = 0.35;

/** Speaking shots made with Veo 3.1 Fast (video + voice together), per second of clip. */
export const SKIT_TALK_VIDEO_COST_PER_SECOND = 0.15;

export function skitCreditsFor(p: {
  characters: number;
  shots: number;
  /** Speaking seconds that go through TTS + lip-sync (lines too long for a talking clip). */
  speakingSeconds: number;
  /** Seconds of talking clips (4 / 6 / 8 s each) made with their own voice. */
  talkClipSeconds?: number;
  silentShots: number;
  sfx: number;
  crowd: number;
  totalSeconds: number;
}): number {
  const usd =
    SKIT_PLAN_COST +
    SKIT_IMAGE_COST * (p.characters + p.shots) +
    Math.ceil(p.speakingSeconds * 1.15) * AVATAR_COST_PER_SECOND + // 15 % headroom: voices run a bit long
    (p.talkClipSeconds ?? 0) * SKIT_TALK_VIDEO_COST_PER_SECOND +
    p.silentShots * SKIT_CLIP_COST +
    p.sfx * SKIT_SFX_COST +
    p.crowd * SKIT_CROWD_COST;
  return creditsForCost(usd, SKIT_MARGIN) + RENDER_CREDITS_PER_30S * Math.max(1, Math.ceil(p.totalSeconds / 30));
}

/**
 * Talking character: the scene picture + either a Veo clip that speaks the typed line
 * itself (`clipSeconds`: 4 / 6 / 8, since 5 Nov 2026) or lip-sync seconds on a recording.
 */
export function talkCreditsFor(seconds: number, clipSeconds?: number | null): number {
  if (clipSeconds) return creditsForCost(clipSeconds * SKIT_TALK_VIDEO_COST_PER_SECOND + SKIT_IMAGE_COST);
  return creditsForCost(Math.ceil(seconds) * AVATAR_COST_PER_SECOND + SKIT_IMAGE_COST);
}

/** Image to video: Seedance 1.5 Pro, silent 720p, about $0.026 per second ($0.13 for 5 s). */
export const ANIMATE_COST_PER_SECOND = 0.026;
export function animateCreditsFor(seconds: number): number {
  return creditsForCost(seconds * ANIMATE_COST_PER_SECOND);
}

/**
 * Ambient music video (10 Nov 2026, Yağmur): hours of calm AI music over one still picture.
 * Music = Google Lyria 3 Pro (flat $0.08 per ~3 min song); the picture = one Nano Banana
 * image; the MP4 is assembled with ffmpeg on our own server (no Shotstack, ~$0.03 of
 * compute per hour of video). Long videos play a few songs (at most AMBIENT_MAX_TRACKS)
 * in a shuffled loop, which is how channels in this genre do it. No re-render exists.
 * Sold at a 65 % gross margin; 25 % headroom on songs covers regenerations.
 */
export const AMBIENT_MARGIN = 0.65;
export const AMBIENT_SONG_COST = 0.08;
export const AMBIENT_SONG_SECONDS = 180;
export const AMBIENT_MAX_TRACKS = 12;
export const AMBIENT_MINUTES = [10, 30, 60, 120] as const;
export const AMBIENT_CHUNK_MINUTES = 60;

/** Different songs made for a video of this length. */
export function ambientTracksFor(minutes: number): number {
  return Math.min(AMBIENT_MAX_TRACKS, Math.max(2, Math.ceil((minutes * 60) / AMBIENT_SONG_SECONDS)));
}

export function ambientCreditsFor(minutes: number): number {
  const chunks = Math.ceil(minutes / AMBIENT_CHUNK_MINUTES);
  const usd = ambientTracksFor(minutes) * AMBIENT_SONG_COST * 1.25 + SKIT_IMAGE_COST + 0.03 * (chunks + 1);
  return creditsForCost(usd, AMBIENT_MARGIN);
}

/** Character swap: fal Wan 2.2 Animate Replace bills $0.08 per 16 frames (720p), plus the render. */
export const SWAP_COST_PER_16_FRAMES = 0.08;
export function swapCreditsFor(frames: number, seconds: number): number {
  return creditsForCost((frames / 16) * SWAP_COST_PER_16_FRAMES) + RENDER_CREDITS_PER_30S * Math.max(1, Math.ceil(seconds / 30));
}

/** Typical examples for the price list (computed from the real prices above). */
export const CREATIVE_COSTS = {
  /** A ~24 s skit: 3 characters, 6 shots (4 speaking = 4 + 6 + 4 + 6 s clips with their own voice, 2 silent), 2 sound effects, 1 crowd shout. */
  skit20: skitCreditsFor({ characters: 3, shots: 6, speakingSeconds: 0, talkClipSeconds: 20, silentShots: 2, sfx: 2, crowd: 1, totalSeconds: 24 }),
  /** A 10 s talking character. */
  talk10: talkCreditsFor(10),
  /** A one-hour ambient music video. */
  ambient60: ambientCreditsFor(60),
  /** A 5 s clip made from an uploaded picture. */
  animate5: animateCreditsFor(5),
  /** A 10 s character swap at 30 fps. */
  swap10: swapCreditsFor(300, 10),
};
