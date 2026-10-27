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

import type { CaptionCue } from "./captions";
import { SLOT_SECONDS } from "./steps";

export type SlotKind = "kling" | "still";
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
}

export interface SceneInput {
  sceneNumber: number;
  videoPrompt: string;
  description?: string;
}

/** Narration length from the last caption cue (plus a short tail). */
export function narrationSeconds(cues: CaptionCue[] | undefined, fallback: number): number {
  const last = cues?.length ? cues[cues.length - 1].end : 0;
  return last > 1 ? Math.round((last + 0.6) * 100) / 100 : fallback;
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
  klingSlots: number
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

  const slots: TimelineSlot[] = [];
  for (let i = 0; i < slotCount; i++) {
    const scene = usable[Math.min(usable.length - 1, Math.floor((i * usable.length) / slotCount))];
    slots.push({
      index: i,
      sceneNumber: scene.sceneNumber,
      kind: klingIdx.has(i) ? "kling" : "still",
      start: Math.round(i * length * 100) / 100,
      length: i === slotCount - 1 ? Math.round((totalSeconds - i * length) * 100) / 100 : length,
      prompt: scene.videoPrompt.trim(),
      status: "pending",
    });
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
}

/** Build the Shotstack edit. Failed slots fall back to a neighbour's visual. */
export function buildEdit(input: EditInput): Record<string, unknown> {
  const { slots, orientation, totalSeconds } = input;
  const size = orientation === "vertical" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

  // Visual to show for each slot: its own if ready, else the nearest ready one.
  const ready = slots.filter((s) => s.status === "succeed" && s.url);
  const visualFor = (slot: TimelineSlot): TimelineSlot | null => {
    if (slot.status === "succeed" && slot.url) return slot;
    let best: TimelineSlot | null = null;
    for (const r of ready) {
      if (!best || Math.abs(r.index - slot.index) < Math.abs(best.index - slot.index)) best = r;
    }
    return best;
  };

  const clips: Array<Record<string, unknown>> = [];
  slots.forEach((slot, i) => {
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
    if (v.kind === "kling") {
      // Slow a short clip down to fill its slot (never below 0.5×), trim a long one.
      const src = v.sourceSeconds && v.sourceSeconds > 0 ? v.sourceSeconds : SLOT_SECONDS;
      const speed = Math.max(0.5, Math.min(1, Math.round((src / slot.length) * 100) / 100));
      clips.push({ ...base, asset: { type: "video", src: v.url, volume: 0, speed } });
    } else {
      clips.push({ ...base, asset: { type: "image", src: v.url }, effect: KEN_BURNS[i % KEN_BURNS.length] });
    }
  });

  const tracks: Array<Record<string, unknown>> = [];
  if (input.subtitlesUrl) {
    tracks.push({
      clips: [
        {
          asset: {
            type: "rich-caption",
            src: input.subtitlesUrl,
            font: {
              family: "Montserrat ExtraBold",
              size: orientation === "vertical" ? 58 : 44,
              color: "#ffffff",
              weight: 800,
            },
            stroke: { width: 5, color: "#000000", opacity: 1 },
            // Viral-shorts style: the spoken word lights up yellow.
            animation: { style: "karaoke" },
            active: { font: { color: "#FFD60A" } },
            align: { vertical: "bottom" },
            style: { textTransform: "uppercase" },
          },
          start: 0,
          length: "end",
          width: Math.round(size.width * 0.86),
          height: Math.round(size.height * 0.3),
          offset: { x: 0, y: orientation === "vertical" ? -0.12 : -0.05 },
        },
      ],
    });
  }
  tracks.push({ clips });

  return {
    timeline: {
      background: "#000000",
      soundtrack: { src: input.voiceoverUrl, effect: "fadeOut", volume: 1 },
      tracks,
    },
    output: {
      format: "mp4",
      fps: 30,
      size,
      // "medium" keeps a 60 s 1080×1920 file well under Supabase's 50 MB
      // per-object limit (free plan); "high" produced >50 MB for 70 s.
      quality: "medium",
      // Trim the output to the narration even if the last clip runs long.
      range: { start: 0, length: Math.round(totalSeconds * 100) / 100 },
    },
  };
}
