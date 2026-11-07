// lib/pipeline/timeline.ts
// Full-video timeline: pure helpers with no I/O.
//
//   planSlots()  — split the narration into ~5 s slots, assign each slot a
//                  scene (its prompt) and a visual kind (kling clip / AI still).
//   buildEdit()  — turn settled slots + voiceover + subtitles into a Shotstack
//                  edit JSON (vertical or horizontal, 1080p, 30 fps).
//
// Why slots instead of "one clip per scene": scene durations are uneven and
// unknown up front, while pricing has to be fixed when credits are charged.
// Fixed-length slots make the plan (and the bill) predictable; a Kling clip
// is slowed/trimmed to its slot, stills get a Ken Burns move.

import { captionStyle } from "./visual-styles";
import { contrastText, OUTRO_SECONDS, type BrandSnapshot } from "@/lib/brand/kit";
import { upper, type CaptionCue } from "./captions";
import type { MapSpec } from "./maps-spec";
import { SLOT_SECONDS } from "./steps";
import { MUSIC_VOLUME } from "./music";

/**
 * kling = AI clip (text→video or image→video), still = AI image, stock = licensed
 * stock video, archive = real photo from Wikimedia Commons (a stock slot that found one).
 */
export type SlotKind = "kling" | "still" | "stock" | "archive" | "avatar";
export type SlotStatus = "pending" | "processing" | "succeed" | "failed";

export interface TimelineSlot {
  index: number;
  sceneNumber: number;
  kind: SlotKind;
  /** Seconds on the final timeline. */
  start: number;
  length: number;
  prompt: string;
  status: SlotStatus;
  /** Kling task id while processing. */
  taskId?: string;
  /** Public URL of the clip (kling) or image (still) once ready. */
  url?: string;
  storage_path?: string;
  /** Source clip seconds (kling) — used to compute playback speed. */
  sourceSeconds?: number;
  error?: string;
  /** Image→video clips: the scene still that gets animated (also the fallback visual). */
  imageUrl?: string;
  /** Image→video clips: fal queue handle while processing. */
  fal?: { requestId: string; statusUrl: string; responseUrl: string };
  /** When this clip was submitted (per-clip timeout). */
  submittedAt?: string;
  /**
   * Set by "edit video" (POST /api/projects/[id]/edit): a regenerated still
   * that replaces whatever this slot showed. Kept separate from url/kind so
   * the original purchase accounting (consumedCredits) is untouched.
   */
  editedStillUrl?: string;
  /**
   * Set by the timeline editor: a video (the creator's upload or a stock clip
   * they picked) that replaces whatever this slot showed. Mutually exclusive
   * with editedStillUrl.
   */
  editedClip?: { url: string; seconds?: number; poster?: string; source: "upload" | "stock"; credit?: string };
  /** Earlier pictures of this slot (newest first), for "go back" in the editor. */
  editHistory?: Array<{ url: string; prompt?: string; at: string; clip?: { seconds?: number; poster?: string; source: "upload" | "stock"; credit?: string } }>;
  /** Clip credits already given back for this slot. */
  refunded?: boolean;
  /** Stock slots: preview frame and attribution of the chosen clip. */
  posterUrl?: string;
  stock?: { provider: string; id: number; pageUrl: string; author: string };
  /** Stock slots: what to search for (from the scene's stockQuery). */
  stockQuery?: string;
  /** Stock slots: real subject to look up genuine archive photos for. */
  archiveQuery?: string;
  /** Cast members in this slot's scene (stills drawn from their references). */
  characters?: string[];
  /** Archive photo attribution (credited in the description). */
  archive?: { title: string; author: string; license: string; pageUrl: string };
  /** A stock slot that found nothing and was filled with an AI still instead. */
  stockFallback?: boolean;
  /** A presenter slot whose lip-sync failed and became an AI still (refunded as presenter). */
  avatarFallback?: boolean;
  /** Presenter: what was sent to the lip-sync model (to retry on the fallback model once). */
  avatarInput?: { imageUrl: string; audioUrl: string; prompt: string };
  /** Presenter slots: the cast member who talks to camera. */
  presenter?: string;
  /** Animated map: drawn frames + where each place label goes (fractions of the frame). */
  map?: { spec: MapSpec; frames?: string[]; labels?: Array<{ name: string; x: number; y: number }> };
}

export interface SceneInput {
  sceneNumber: number;
  videoPrompt: string;
  description?: string;
  /** 2–4 plain English words to search stock footage for this scene. */
  stockQuery?: string;
  /** Real subject (place/person/event) to find archive photos of. */
  archiveQuery?: string;
  /** Cast members on screen (their reference images keep faces consistent). */
  characters?: string[];
  /** Animated map for this scene (lib/pipeline/maps.ts). */
  map?: MapSpec;
}

/**
 * Turn a cinematic scene prompt into a short stock-search query:
 * keep the first clause, drop camera/lighting jargon.
 */
export function stockQueryFromPrompt(prompt: string): string {
  // Scene prompts open with the shot type ("extreme close-up, 85mm, …"):
  // skip clauses that are only camera talk.
  const clauses = prompt.split(/[.;:,\n]/).map((c) => c.trim()).filter(Boolean);
  const camera = /^(extreme |medium |wide |tight |slow |low |high |over|aerial|establishing|close|shot|lens|\d+ ?mm|macro|tracking|static|handheld|dolly|crane|top[- ]down|bird)/i;
  const first = clauses.find((c) => !camera.test(c) && !/\b(shot|lens|\d+ ?mm)\b/i.test(c)) ?? clauses[0] ?? prompt;
  return first
    .replace(/\b(cinematic|slow[- ]?motion|close[- ]?up|wide shot|drone|aerial|4k|8k|hyper[- ]?realistic|dramatic lighting|golden hour|volumetric|bokeh|depth of field|dolly|pan|tilt|tracking shot|film grain|photorealistic|ultra[- ]?detailed)\b/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ") || "abstract background";
}


/** Narration length from the last caption cue (plus a short tail). */
export function narrationSeconds(cues: CaptionCue[] | undefined, fallback: number): number {
  const last = cues?.length ? cues[cues.length - 1].end : 0;
  return last > 1 ? Math.round((last + 0.6) * 100) / 100 : fallback;
}

/**
 * The part of a finished timeline between `from` and `to` seconds, shifted to
 * start at 0 (Shorts cut from a long video). Slots cut by the window are
 * shortened; a stock clip that now starts later skips ahead to match.
 */
export function cutSlots(slots: TimelineSlot[], from: number, to: number): TimelineSlot[] {
  const round = (n: number) => Math.round(n * 100) / 100;
  return slots
    .filter((s) => s.start + s.length > from + 0.05 && s.start < to - 0.05)
    .map((s, i) => {
      const start = Math.max(s.start, from);
      const end = Math.min(s.start + s.length, to);
      return { ...s, index: i, start: round(start - from), length: round(end - start) };
    });
}

/** Caption cues between `from` and `to`, shifted to start at 0. */
export function cutCues(cues: CaptionCue[], from: number, to: number): CaptionCue[] {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return cues
    .filter((c) => c.end > from && c.start < to)
    .map((c) => ({ ...c, start: round(Math.max(0, c.start - from)), end: round(Math.min(to, c.end) - from) }));
}

/**
 * Stretch a finished timeline to a new narration length (translations reuse
 * the original visuals; another language is rarely exactly as long).
 */
export function rescaleSlots(slots: TimelineSlot[], fromSeconds: number, toSeconds: number): TimelineSlot[] {
  if (!(fromSeconds > 0) || !(toSeconds > 0)) return slots;
  const k = toSeconds / fromSeconds;
  const round = (n: number) => Math.round(n * 100) / 100;
  return slots.map((slot, i) => {
    const start = round(slot.start * k);
    // The last slot runs to the very end so rounding never leaves a gap.
    const end = i === slots.length - 1 ? round(toSeconds) : round((slot.start + slot.length) * k);
    return { ...slot, start, length: round(end - start) };
  });
}

/**
 * Lay out `slotCount` slots over `totalSeconds`, map each to a scene in order,
 * and mark `klingSlots` of them (evenly spread, starting with the first) as
 * Kling clips. Scenes repeat across adjacent slots when there are fewer
 * scenes than slots; consecutive still slots of one scene reuse its image.
 */
export function planSlots(
  scenes: SceneInput[],
  totalSeconds: number,
  slotCount: number,
  klingSlots: number,
  stockSlots = 0
): TimelineSlot[] {
  const usable = scenes.filter((s) => s.videoPrompt?.trim());
  if (!usable.length || slotCount <= 0) return [];
  const length = Math.round((totalSeconds / slotCount) * 100) / 100;

  // Evenly spaced Kling positions: 0, step, 2·step … (step = slots / kling).
  const klingIdx = new Set<number>();
  if (klingSlots > 0) {
    const step = slotCount / Math.min(klingSlots, slotCount);
    for (let k = 0; k < Math.min(klingSlots, slotCount); k++) klingIdx.add(Math.round(k * step));
  }

  // Stock footage: of the slots left, an evenly spread set (starting with the
  // opening) stays an AI still — those carry the story's key moments — and
  // the rest are stock clips.
  const stockIdx = new Set<number>();
  const free = [...Array(slotCount).keys()].filter((i) => !klingIdx.has(i));
  const stockCount = Math.min(Math.max(0, stockSlots), free.length);
  if (stockCount > 0) {
    const stillCount = free.length - stockCount;
    const stillPos = new Set<number>();
    if (stillCount > 0) {
      const step = free.length / stillCount;
      for (let k = 0; k < stillCount; k++) stillPos.add(free[Math.min(free.length - 1, Math.round(k * step))]);
    }
    for (const i of free) if (!stillPos.has(i) && stockIdx.size < stockCount) stockIdx.add(i);
  }

  const slots: TimelineSlot[] = [];
  for (let i = 0; i < slotCount; i++) {
    const scene = usable[Math.min(usable.length - 1, Math.floor((i * usable.length) / slotCount))];
    slots.push({
      index: i,
      sceneNumber: scene.sceneNumber,
      kind: klingIdx.has(i) ? "kling" : stockIdx.has(i) ? "stock" : "still",
      start: Math.round(i * length * 100) / 100,
      length: i === slotCount - 1 ? Math.round((totalSeconds - i * length) * 100) / 100 : length,
      prompt: scene.videoPrompt.trim(),
      ...(stockIdx.has(i) && scene.stockQuery?.trim() ? { stockQuery: scene.stockQuery.trim() } : {}),
      ...(stockIdx.has(i) && scene.archiveQuery?.trim() ? { archiveQuery: scene.archiveQuery.trim() } : {}),
      ...(scene.characters?.length ? { characters: scene.characters } : {}),
      status: "pending",
    });
  }
  // Map scenes: their first slot that isn't an AI clip shows the animated map.
  for (const scene of usable) {
    if (!scene.map) continue;
    // Not under the opening hook card when the scene has a later slot.
    const candidates = slots.filter((x) => x.sceneNumber === scene.sceneNumber && x.kind !== "kling");
    const slot = candidates.find((x) => x.start >= HOOK_CARD_SECONDS) ?? candidates[0];
    if (slot) slot.map = { spec: scene.map };
  }
  return slots;
}

/** Distinct scenes that need an AI still (one image serves adjacent slots). */
export function stillScenes(slots: TimelineSlot[]): number[] {
  return [...new Set(slots.filter((s) => s.kind === "still").map((s) => s.sceneNumber))];
}

const KEN_BURNS = ["zoomIn", "zoomOut", "slideLeft", "slideRight", "zoomIn", "slideUp"] as const;

export interface EditInput {
  slots: TimelineSlot[];
  voiceoverUrl: string;
  /** Public URL of an .srt file; omit to render without subtitles. */
  subtitlesUrl?: string;
  orientation: "vertical" | "horizontal";
  totalSeconds: number;
  /** Optional thumbnail/poster shown when a slot has no visual at all. */
  fallbackImageUrl?: string;
  /** Short on-screen hook shown over the first seconds (viral-shorts style). */
  hookText?: string;
  /** ISO code of the narration language — drives locale-aware uppercase. */
  languageCode?: string;
  /** Background music; mixed well under the voice. */
  musicUrl?: string;
  /** Length of the music track; shorter than the video → it repeats. */
  musicSeconds?: number;
  /** Free-trial "Made with Norveko" badge (PNG URL), top-right for the whole video. */
  watermarkUrl?: string;
  /** Caption look preset id (lib/pipeline/visual-styles.ts); default "bold". */
  captionStyle?: string;
  /** Creator's brand kit (lib/brand/kit.ts): logo corner, brand colour, end card. */
  brand?: BrandSnapshot | null;
  /** Short cut from a long video: play the narration from this second on. */
  voiceoverTrim?: number;
}

/** Seconds the hook title stays on screen. */
export const HOOK_CARD_SECONDS = 3;
/** Max words on the hook card — it has to be read in one glance. */
export const HOOK_MAX_WORDS = 7;

/** Keep the on-screen hook short enough to read in a glance. */
export function hookTitle(hook: string | undefined | null, locale?: string): string | null {
  const text = (hook ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  // First sentence only, then cap the word count.
  const first = text.split(/(?<=[.!?…])\s+/)[0] ?? text;
  const words = first.split(" ");
  const short = words.length > HOOK_MAX_WORDS ? `${words.slice(0, HOOK_MAX_WORDS).join(" ")}…` : first;
  return upper(short.replace(/[.]+$/, ""), locale);
}

/** Build the Shotstack edit. Failed slots fall back to a neighbour's visual. */
export function buildEdit(input: EditInput): Record<string, unknown> {
  const { slots, orientation, totalSeconds } = input;
  const size = orientation === "vertical" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

  // Visual to show for each slot: its own if ready, else the nearest ready one.
  const ready = slots.filter((s) => s.status === "succeed" && s.url);
  const visualFor = (slot: TimelineSlot): TimelineSlot | null => {
    if (slot.editedClip) return { ...slot, kind: "stock", status: "succeed", url: slot.editedClip.url, sourceSeconds: slot.editedClip.seconds };
    if (slot.editedStillUrl) return { ...slot, kind: "still", status: "succeed", url: slot.editedStillUrl };
    if (slot.status === "succeed" && slot.url) return slot;
    // A failed image→video clip still has its own scene still: use it.
    if (slot.imageUrl) return { ...slot, kind: "still", status: "succeed", url: slot.imageUrl };
    let best: TimelineSlot | null = null;
    for (const r of ready) {
      if (!best || Math.abs(r.index - slot.index) < Math.abs(best.index - slot.index)) best = r;
    }
    return best;
  };

  const clips: Array<Record<string, unknown>> = [];
  const mapOverlay: Array<Record<string, unknown>> = [];
  slots.forEach((slot, i) => {
    if (!slot.editedClip && !slot.editedStillUrl && slot.map?.frames?.length) {
      mapClips(slot, orientation).forEach((c) => clips.push(c));
      mapLabels(slot, orientation, input.languageCode).forEach((c) => mapOverlay.push(c));
      return;
    }
    const v = visualFor(slot);
    const base: Record<string, unknown> = {
      start: slot.start,
      length: slot.length,
      fit: "cover",
      transition: { in: i === 0 ? "fade" : "fade", out: "fade" },
    };
    if (!v) {
      if (input.fallbackImageUrl) {
        clips.push({ ...base, asset: { type: "image", src: input.fallbackImageUrl }, effect: KEN_BURNS[i % KEN_BURNS.length] });
      }
      return;
    }
    if (v.kind === "stock") {
      // Stock clips are usually longer than the slot: play at normal speed, trimmed;
      // skip the first second (fade-ins/titles in many stock clips).
      const src = v.sourceSeconds && v.sourceSeconds > 0 ? v.sourceSeconds : slot.length;
      const trim = src - 1 >= slot.length ? 1 : 0;
      const speed = Math.max(0.5, Math.min(1, Math.round(((src - trim) / slot.length) * 100) / 100));
      clips.push({ ...base, asset: { type: "video", src: v.url, volume: 0, speed, trim, transcode: true } });
    } else if (v.kind === "avatar") {
      // The presenter's lips follow the narration already playing on the soundtrack.
      clips.push({ ...base, asset: { type: "video", src: v.url, volume: 0, trim: 0, transcode: true } });
    } else if (v.kind === "kling") {
      // Slow a short clip down to fill its slot (never below 0.5×), trim a long one.
      const src = v.sourceSeconds && v.sourceSeconds > 0 ? v.sourceSeconds : SLOT_SECONDS;
      const speed = Math.max(0.5, Math.min(1, Math.round((src / slot.length) * 100) / 100));
      // transcode: Kling stores portrait clips with a rotation tag that the
      // renderer otherwise ignores (clips came out sideways); pre-processing
      // bakes the rotation in.
      clips.push({ ...base, asset: { type: "video", src: v.url, volume: 0, speed, transcode: true } });
    } else {
      clips.push({ ...base, asset: { type: "image", src: v.url }, effect: KEN_BURNS[i % KEN_BURNS.length] });
    }
  });

  const tracks: Array<Record<string, unknown>> = [];

  // Hook title card: big uppercase line over the opening seconds so the
  // viewer gets the promise of the video before scrolling on.
  const hook = hookTitle(input.hookText, input.languageCode);
  const brandColor = input.brand?.color;
  const onBrand = brandColor ? contrastText(brandColor) : "#FFFFFF";
  if (hook) {
    tracks.push({
      clips: [
        {
          asset: {
            type: "rich-text",
            text: hook,
            font: {
              family: "Montserrat ExtraBold",
              size: orientation === "vertical" ? 92 : 68,
              color: onBrand,
              weight: 800,
            },
            style: { lineHeight: 1.05 },
            ...(onBrand === "#FFFFFF" ? { stroke: { color: "#000000", width: 6, opacity: 1 } } : {}),
            shadow: { offsetX: 0, offsetY: 6, blur: 18, color: "#000000", opacity: 0.6 },
            background: brandColor
              ? { color: brandColor, opacity: 0.9, borderRadius: 24, wrap: true }
              : { color: "#000000", opacity: 0.45, borderRadius: 24, wrap: true },
            padding: 28,
            align: { horizontal: "center", vertical: "middle" },
            // Snappy: the whole line lands in a third of a second.
            animation: { preset: "slideIn", style: "word", direction: "up", duration: 0.35 },
          },
          start: 0,
          length: Math.min(HOOK_CARD_SECONDS, Math.max(1, totalSeconds)),
          width: Math.round(size.width * 0.86),
          height: Math.round(size.height * (orientation === "vertical" ? 0.28 : 0.4)),
          // offset.y > 0 moves UP: upper-middle of the frame, clear of the captions band.
          position: "center",
          offset: { x: 0, y: orientation === "vertical" ? 0.16 : 0.08 },
          transition: { in: "fade", out: "fade" },
        },
      ],
    });
  }

  if (input.subtitlesUrl) {
    // Captions keep their preset colours (yellow spoken word reads best on
    // any picture — Kadir, 31 Oct); the brand colour is for the hook and end cards.
    const cap = captionStyle(input.captionStyle);
    tracks.push({
      clips: [
        {
          asset: {
            type: "rich-caption",
            src: input.subtitlesUrl,
            font: {
              family: cap.font,
              size: orientation === "vertical" ? cap.size : Math.round(cap.size * 0.76),
              color: cap.color,
              weight: cap.font.includes("ExtraBold") ? 800 : 600,
            },
            ...(cap.stroke ? { stroke: { width: cap.stroke.width, color: cap.stroke.color, opacity: 1 } } : {}),
            animation: { style: cap.animation },
            ...(cap.active || cap.activeBackground
              ? {
                  active: {
                    font: {
                      ...(cap.active ? { color: cap.active } : {}),
                      ...(cap.activeBackground ? { background: cap.activeBackground } : {}),
                    },
                  },
                }
              : {}),
            align: { vertical: "middle" },
            // Uppercase (when the style wants it) is applied in the SRT itself (locale-aware).
          },
          start: 0,
          length: "end",
          // A short band pinned to the lower part of the frame (clear of the
          // platform UI at the very bottom, well below the hook card).
          width: Math.round(size.width * 0.86),
          height: Math.round(size.height * (orientation === "vertical" ? 0.16 : 0.2)),
          // offset.y > 0 moves UP: band sits 14 % above the bottom edge.
          position: "bottom",
          offset: { x: 0, y: orientation === "vertical" ? 0.14 : 0.07 },
        },
      ],
    });
  }
  if (mapOverlay.length) tracks.push({ clips: mapOverlay });
  tracks.push({ clips });

  // Background music as its own audio track (the soundtrack slot is the
  // voice): quiet, fades in/out, trimmed to the narration.
  if (input.musicUrl) {
    // Long-form: a track shorter than the video is repeated back to back
    // (each pass fades in/out) instead of going silent after its end.
    const piece = input.musicSeconds && input.musicSeconds > 20 ? input.musicSeconds : totalSeconds;
    const musicClips: Array<Record<string, unknown>> = [];
    for (let start = 0; start < totalSeconds - 0.5; start += piece) {
      musicClips.push({
        asset: { type: "audio", src: input.musicUrl, volume: MUSIC_VOLUME, effect: "fadeInFadeOut" },
        start: Math.round(start * 100) / 100,
        length: Math.round(Math.min(piece, totalSeconds - start) * 100) / 100,
      });
    }
    tracks.push({ clips: musicClips });
  }

  // End card: the creator's call to action over the last seconds.
  const outro = input.brand?.outroText;
  if (outro && totalSeconds > HOOK_CARD_SECONDS + OUTRO_SECONDS + 1) {
    const start = Math.round((totalSeconds - OUTRO_SECONDS) * 100) / 100;
    tracks.unshift({
      clips: [
        {
          asset: {
            type: "rich-text",
            text: outro,
            font: { family: "Montserrat ExtraBold", size: orientation === "vertical" ? 72 : 56, color: onBrand, weight: 800 },
            style: { lineHeight: 1.1 },
            background: { color: brandColor ?? "#000000", opacity: brandColor ? 0.92 : 0.6, borderRadius: 24, wrap: true },
            padding: 28,
            align: { horizontal: "center", vertical: "middle" },
            animation: { preset: "fadeIn", duration: 0.3 },
          },
          start,
          length: Math.round((totalSeconds - start) * 100) / 100,
          width: Math.round(size.width * 0.82),
          height: Math.round(size.height * (orientation === "vertical" ? 0.22 : 0.32)),
          position: "center",
          offset: { x: 0, y: orientation === "vertical" ? 0.08 : 0.04 },
          transition: { in: "fade" },
        },
      ],
    });
  }

  // Creator's logo, top-left corner for the whole video (the trial badge sits top-right).
  if (input.brand?.logoUrl && input.brand.videoLogo) {
    tracks.unshift({
      clips: [
        {
          asset: { type: "image", src: input.brand.logoUrl },
          start: 0,
          length: totalSeconds,
          fit: "contain",
          scale: orientation === "vertical" ? 0.17 : 0.12,
          position: "topLeft",
          offset: { x: 0.04, y: orientation === "vertical" ? -0.05 : -0.04 },
          opacity: 0.92,
        },
      ],
    });
    // Brand name in small spaced capitals, centred under the logo (7 Nov 2026, Yağmur).
    // Logo box: vertical 184 px at (43, 96), horizontal 130 px at (77, 43).
    const name = input.brand.name?.trim();
    if (name) {
      const vertical = orientation === "vertical";
      const logoPx = vertical ? 0.17 * size.width : 0.12 * size.height;
      const logoLeft = 0.04 * size.width;
      const logoBottom = (vertical ? 0.05 : 0.04) * size.height + logoPx;
      const boxWidth = Math.round(logoPx + (vertical ? 140 : 120));
      const boxHeight = vertical ? 54 : 42;
      const left = logoLeft + logoPx / 2 - boxWidth / 2;
      tracks.unshift({
        clips: [
          {
            asset: {
              type: "rich-text",
              text: name.toUpperCase(),
              font: { family: "Montserrat SemiBold", size: vertical ? 30 : 22, color: "#FFFFFF", weight: 600 },
              style: { letterSpacing: vertical ? 7 : 5, lineHeight: 1 },
              shadow: { offsetX: 0, offsetY: 2, blur: 8, color: "#000000", opacity: 0.75 },
              align: { horizontal: "center", vertical: "top" },
            },
            start: 0,
            length: totalSeconds,
            width: boxWidth,
            height: boxHeight,
            position: "topLeft",
            offset: { x: left / size.width, y: -(logoBottom + (vertical ? 10 : 8)) / size.height },
            opacity: 0.92,
          },
        ],
      });
    }
  }

  // Topmost layer (Shotstack draws track 0 on top), inside the safe area:
  // above the hook card and clear of the captions band.
  if (input.watermarkUrl) {
    tracks.unshift({
      clips: [
        {
          asset: { type: "image", src: input.watermarkUrl },
          start: 0,
          length: totalSeconds,
          // Native size (353×108 px) instead of the default crop-to-fill.
          fit: "none",
          position: "topRight",
          offset: { x: -0.04, y: orientation === "vertical" ? -0.06 : -0.04 },
          scale: orientation === "vertical" ? 0.8 : 0.9,
          opacity: 0.85,
        },
      ],
    });
  }

  // A Short cut from a long video plays a window of the long narration:
  // the soundtrack slot can't be trimmed, so the voice becomes an audio clip.
  const trim = input.voiceoverTrim && input.voiceoverTrim > 0 ? Math.round(input.voiceoverTrim * 100) / 100 : 0;
  if (trim) {
    tracks.push({
      clips: [
        {
          asset: { type: "audio", src: input.voiceoverUrl, trim, volume: 1, effect: "fadeOut" },
          start: 0,
          length: Math.round(totalSeconds * 100) / 100,
        },
      ],
    });
  }

  return {
    timeline: {
      background: "#000000",
      ...(trim ? {} : { soundtrack: { src: input.voiceoverUrl, effect: "fadeOut", volume: 1 } }),
      tracks,
    },
    output: {
      format: "mp4",
      fps: 30,
      size,
      // "medium" keeps a 60 s 1080×1920 file well under Supabase's 50 MB
      // per-object limit (free plan); "high" produced >50 MB for 70 s.
      // Long-form: "medium" came out at ~9 Mbit/s (193 MB for 3 min); "low" roughly
      // halves the file at little visible cost, which matters for 10-minute videos.
      quality: totalSeconds > 60 ? "low" : "medium",
      // Trim the output to the narration even if the last clip runs long.
      range: { start: 0, length: Math.round(totalSeconds * 100) / 100 },
    },
  };
}

/* ---------------- Animated map scenes ---------------- */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The map's frames back to back: the route draws in, the last frame holds. */
function mapClips(slot: TimelineSlot, orientation: "vertical" | "horizontal"): Array<Record<string, unknown>> {
  void orientation;
  const frames = slot.map!.frames!;
  const n = frames.length;
  const build = n > 1 ? slot.length * 0.6 : 0;
  const step = n > 1 ? build / (n - 1) : 0;
  return frames.map((src, f) => {
    const start = slot.start + f * step;
    const length = f === n - 1 ? slot.length - build : step;
    return {
      asset: { type: "image", src },
      start: r2(start),
      length: r2(Math.max(0.2, length)),
      fit: "cover",
      ...(f === 0 ? { transition: { in: "fade" } } : {}),
      ...(f === n - 1 ? { transition: { out: "fade" }, effect: "zoomInSlow" } : {}),
    };
  });
}

/** When place i is on the map (same pacing as renderMapFrames). */
function placeAppears(slot: TimelineSlot, i: number): number {
  const n = slot.map!.frames!.length;
  const places = slot.map!.spec.places.length;
  if (n <= 1) return slot.start;
  const build = slot.length * 0.6;
  const progress = slot.map!.spec.route ? i / Math.max(1, places - 1) : (i + 1) / places;
  const frame = Math.min(n - 1, Math.max(0, Math.ceil(progress * (n - 1) - 1e-6)));
  return slot.start + (frame * build) / (n - 1);
}

/** Place names (and the map title) laid over the frames as text. */
function mapLabels(slot: TimelineSlot, orientation: "vertical" | "horizontal", languageCode?: string): Array<Record<string, unknown>> {
  const labels = slot.map!.labels ?? [];
  const end = slot.start + slot.length;
  const out: Array<Record<string, unknown>> = [];
  const placed: Array<{ x: number; y: number }> = [];
  labels.forEach((l, i) => {
    // Above the dot; below it when another name already sits there.
    let dy = -0.035;
    if (placed.some((p) => Math.abs(p.x - l.x) < 0.18 && Math.abs(p.y - (l.y + dy)) < 0.04)) dy = 0.04;
    placed.push({ x: l.x, y: l.y + dy });
    const start = placeAppears(slot, i);
    out.push({
      asset: {
        type: "rich-text",
        text: l.name,
        font: { family: "Montserrat ExtraBold", size: orientation === "vertical" ? 58 : 46, color: "#FFFFFF", weight: 800 },
        stroke: { color: "#000000", width: 5, opacity: 1 },
        align: { horizontal: "center", vertical: "middle" },
        animation: { preset: "fadeIn", duration: 0.3 },
      },
      start: r2(start),
      length: r2(Math.max(0.3, end - start)),
      width: orientation === "vertical" ? 600 : 560,
      height: 110,
      position: "center",
      offset: { x: Math.round(Math.min(0.42, Math.max(-0.42, l.x - 0.5)) * 1000) / 1000, y: Math.round((0.5 - (l.y + dy)) * 1000) / 1000 },
    });
  });
  const title = slot.map!.spec.title;
  // The title would sit under the hook card in the first seconds.
  if (title && slot.start >= HOOK_CARD_SECONDS) {
    out.push({
      asset: {
        type: "rich-text",
        text: upper(title, languageCode),
        font: { family: "Montserrat ExtraBold", size: orientation === "vertical" ? 64 : 52, color: "#F2C14E", weight: 800 },
        stroke: { color: "#000000", width: 5, opacity: 1 },
        align: { horizontal: "center", vertical: "middle" },
        animation: { preset: "fadeIn", duration: 0.4 },
      },
      start: r2(slot.start),
      length: r2(slot.length),
      width: orientation === "vertical" ? 960 : 1400,
      height: 140,
      position: "top",
      offset: { x: 0, y: orientation === "vertical" ? -0.16 : -0.08 },
    });
  }
  return out;
}

/**
 * Presenter slots: the second slot (clear of the opening hook card) and the
 * last one for Shorts; second, middle and last for long-form. Only AI-still
 * slots are used; the nearest still is taken when the ideal one isn't.
 */
export function pickPresenterSlots(slots: TimelineSlot[], count: number): number[] {
  if (count <= 0) return [];
  const stills = slots.filter((s) => s.kind === "still" && !s.map).map((s) => s.index);
  if (!stills.length) return [];
  const n = slots.length;
  const ideal = count >= 3 ? [1, Math.floor(n / 2), n - 1] : [Math.min(1, n - 1), n - 1];
  const chosen: number[] = [];
  for (const want of ideal.slice(0, count)) {
    const free = stills.filter((i) => !chosen.includes(i));
    if (!free.length) break;
    chosen.push(free.reduce((best, i) => (Math.abs(i - want) < Math.abs(best - want) ? i : best), free[0]));
  }
  return chosen;
}
