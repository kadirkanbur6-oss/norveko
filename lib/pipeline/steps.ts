// lib/pipeline/steps.ts
// Pipeline step definitions and credit costs — the single source of truth.

export type PipelineStepId = "research" | "script" | "voiceover" | "thumbnail" | "video" | "render";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface StepState {
  status: StepStatus;
  provider: string;
  error: string | null;
  // Step-specific outputs (script texts, thumbnail image_url, voiceover audio_url, video clips)
  [key: string]: unknown;
}

export interface StepDefinition {
  id: PipelineStepId;
  label: string; // shown in the UI
  credits: number; // credit cost of this step (charged up front)
  provider: string; // default provider (room for fallbacks later)
  /**
   * Async steps submit work to a provider and are completed by later polls
   * instead of inside one worker invocation (e.g. video generation).
   */
  async?: boolean;
}

/** How the visuals of a full video are sourced. */
export type FootageMode = "hybrid" | "cinematic" | "stills";
export const FOOTAGE_MODES: FootageMode[] = ["hybrid", "cinematic", "stills"];

/** Options that decide which optional steps a job includes. */
export interface PipelineOptions {
  /** Web research before the script (current events, real people, numbers). */
  research?: boolean;
  voiceover?: boolean;
  /** Word-timed subtitles (SRT/VTT). Add-on to the voiceover step; ignored without it. */
  subtitles?: boolean;
  /** Legacy: standalone Kling clips (one per scene, no final render). */
  video?: boolean;
  /**
   * One sentence → finished MP4: voiceover + subtitles are implied, visuals
   * are Kling clips and/or AI stills laid out on a timeline, then rendered.
   */
  fullVideo?: boolean;
  footage?: FootageMode;
  /** Duration label from lib/pipeline/options.ts (needed to size the plan). */
  duration?: string;
}

/* ---------------- Subtitles (voiceover add-on) pricing ---------------- */

/** Credits charged for word-timed subtitles on top of the voiceover. */
export const SUBTITLES_CREDITS = 10;

/* ---------------- Video pricing (≥70% margin target) ----------------
 * Revenue per credit after Paddle fees is ≈ $0.011 (Business pack, worst
 * case). Margin ≥ 70% ⇒ price ≥ provider cost × 3.33. Provider costs
 * (Oct 2026): Kling 3.0 720p 5 s ≈ $0.42 (0.6 units/s × $0.14), Gemini image ≈ $0.04, Shotstack
 * render ≈ $0.20/min. See docs in CLAUDE.md §"Fiyatlandırma".
 */

/** Credits per 5-second Kling 3.0 clip, 720p, no audio (3 units ≈ $0.42 list → ≈$1.43 revenue, 70% margin). */
export const VIDEO_CLIP_CREDITS = 130;
/** Legacy clips-only option: clips generated per job (one per scene, capped). */
export const VIDEO_MAX_CLIPS = 5;
/** Seconds per Kling clip requested from the provider. */
export const VIDEO_CLIP_SECONDS = 5;
/** Credits per AI still scene (Gemini image + Ken Burns in the render). */
export const STILL_SCENE_CREDITS = 12;
/** Credits per started 30 s of rendered output (Shotstack ≈ $0.10/30 s). */
export const RENDER_CREDITS_PER_30S = 30;
/** Timeline slot length a full video is planned in (one visual per slot). */
export const SLOT_SECONDS = 5;

/** Full videos are limited to these durations (label → seconds) for now. */
export const FULL_VIDEO_DURATIONS: Record<string, number> = {
  "30 seconds": 30,
  "60 seconds": 60,
};

export interface FullVideoPlan {
  seconds: number;
  /** Number of ~5 s visual slots on the timeline. */
  slots: number;
  /** Slots filled with a Kling clip; the rest get AI stills. */
  klingSlots: number;
  stillSlots: number;
  renderBlocks: number;
  credits: { kling: number; stills: number; render: number; total: number };
}

/**
 * Size the visuals + render for a full video. Hybrid uses a Kling clip in
 * every 4th slot (3 of 12 for 60 s), cinematic in all, stills in none.
 */
export function fullVideoPlan(duration: string | undefined, footage: FootageMode = "hybrid"): FullVideoPlan | null {
  const seconds = FULL_VIDEO_DURATIONS[duration ?? ""];
  if (!seconds) return null;
  const slots = Math.ceil(seconds / SLOT_SECONDS);
  const klingSlots = footage === "cinematic" ? slots : footage === "stills" ? 0 : Math.ceil(slots / 4);
  const stillSlots = slots - klingSlots;
  const renderBlocks = Math.ceil(seconds / 30);
  const kling = klingSlots * VIDEO_CLIP_CREDITS;
  const stills = stillSlots * STILL_SCENE_CREDITS;
  const render = renderBlocks * RENDER_CREDITS_PER_30S;
  return {
    seconds,
    slots,
    klingSlots,
    stillSlots,
    renderBlocks,
    credits: { kling, stills, render, total: kling + stills + render },
  };
}

/** Credits for the research step (one OpenAI web-search call ≈ $0.015). */
export const RESEARCH_CREDITS = 5;

export const PIPELINE_STEP_ORDER: StepDefinition[] = [
  {
    id: "research",
    label: "Research",
    credits: RESEARCH_CREDITS,
    provider: "openai:gpt-5-mini",
  },
  {
    id: "script",
    label: "Content Package",
    credits: 5,
    provider: "openai:gpt-5-mini",
  },
  {
    id: "voiceover",
    label: "Voiceover",
    credits: 15,
    provider: "elevenlabs:eleven_multilingual_v2",
  },
  {
    id: "thumbnail",
    label: "Thumbnail",
    credits: 10,
    provider: "gemini-3.1-flash-image",
  },
  {
    id: "video",
    label: "Visuals",
    // Legacy clips-only price; full videos are priced by fullVideoPlan().
    credits: VIDEO_CLIP_CREDITS * VIDEO_MAX_CLIPS,
    provider: "kling:kling-3.0",
    async: true,
  },
  {
    id: "render",
    label: "Final video",
    credits: 0, // priced by fullVideoPlan()
    provider: "shotstack",
    async: true,
  },
];

/** Accept the legacy boolean (voiceover only) or the options object. */
type Normalized = {
  research: boolean;
  voiceover: boolean;
  subtitles: boolean;
  video: boolean;
  fullVideo: boolean;
  footage: FootageMode;
  duration: string | undefined;
};

function normalize(opts: boolean | PipelineOptions | undefined): Normalized {
  if (typeof opts === "boolean") {
    return { research: false, voiceover: opts, subtitles: false, video: false, fullVideo: false, footage: "hybrid", duration: undefined };
  }
  const fullVideo = Boolean(opts?.fullVideo) && Boolean(fullVideoPlan(opts?.duration, opts?.footage));
  // A full video always narrates and burns in subtitles.
  const voiceover = fullVideo || Boolean(opts?.voiceover);
  return {
    research: Boolean(opts?.research),
    voiceover,
    subtitles: voiceover && (fullVideo || Boolean(opts?.subtitles)),
    video: fullVideo || Boolean(opts?.video),
    fullVideo,
    footage: FOOTAGE_MODES.includes(opts?.footage as FootageMode) ? (opts!.footage as FootageMode) : "hybrid",
    duration: opts?.duration,
  };
}

/** Exported for the UI / API so everyone resolves options the same way. */
export function resolvePipelineOptions(opts: boolean | PipelineOptions | undefined) {
  return normalize(opts);
}

/** Add-ons that ride on a step instead of being steps themselves. */
export function addonCredits(opts: boolean | PipelineOptions = false): number {
  return normalize(opts).subtitles ? SUBTITLES_CREDITS : 0;
}

/** Itemised credits for the billing UI and the charge reason. */
export function creditBreakdown(opts: boolean | PipelineOptions = false): Array<{ id: string; label: string; credits: number }> {
  const n = normalize(opts);
  const plan = n.fullVideo ? fullVideoPlan(n.duration, n.footage) : null;
  const items: Array<{ id: string; label: string; credits: number }> = [];
  for (const step of buildPipelineSteps(opts)) {
    if (step.id === "video" && plan) {
      if (plan.klingSlots) items.push({ id: "kling", label: `AI video clips × ${plan.klingSlots}`, credits: plan.credits.kling });
      if (plan.stillSlots) items.push({ id: "stills", label: `AI scenes × ${plan.stillSlots}`, credits: plan.credits.stills });
      continue;
    }
    if (step.id === "render" && plan) {
      items.push({ id: "render", label: `Final video render (${plan.seconds} s)`, credits: plan.credits.render });
      continue;
    }
    items.push({ id: step.id, label: step.label, credits: step.credits });
    if (step.id === "voiceover" && n.subtitles) items.push({ id: "subtitles", label: "Auto subtitles", credits: SUBTITLES_CREDITS });
  }
  return items;
}

export function buildPipelineSteps(
  opts: boolean | PipelineOptions = false
): StepDefinition[] {
  const { research, voiceover, video, fullVideo } = normalize(opts);
  return PIPELINE_STEP_ORDER.filter((step) => {
    if (step.id === "research") return research;
    if (step.id === "voiceover") return voiceover;
    if (step.id === "video") return video;
    if (step.id === "render") return fullVideo;
    return true;
  });
}

export function getPipelineStepDefinition(stepId: PipelineStepId): StepDefinition {
  const step = PIPELINE_STEP_ORDER.find((definition) => definition.id === stepId);
  if (!step) {
    throw new Error(`Unknown pipeline step: ${stepId}`);
  }
  return step;
}

/** Total credit cost of a job with the given options. */
export function totalPipelineCredits(opts: boolean | PipelineOptions = false): number {
  return creditBreakdown(opts).reduce((sum, item) => sum + item.credits, 0);
}

/** The step after `current`, or null when the pipeline is finished. */
export function nextStep(
  current: PipelineStepId,
  opts: boolean | PipelineOptions = false
): StepDefinition | null {
  const steps = buildPipelineSteps(opts);
  const idx = steps.findIndex((step) => step.id === current);
  if (idx === -1 || idx === steps.length - 1) return null;
  return steps[idx + 1];
}

/** Initial steps JSON when a job is created. */
export function initialStepsState(
  opts: boolean | PipelineOptions = false
): Record<string, StepState> {
  const state: Record<string, StepState> = {};
  for (const step of buildPipelineSteps(opts)) {
    state[step.id] = { status: "pending", provider: step.provider, error: null };
  }
  // Add-ons and the full-video plan are recorded on their steps so the worker
  // and optionsFromSteps() can see them.
  const n = normalize(opts);
  if (n.subtitles && state.voiceover) state.voiceover.subtitles = true;
  if (n.fullVideo) {
    const plan = fullVideoPlan(n.duration, n.footage)!;
    state.video.plan = { ...plan, footage: n.footage, duration: n.duration };
    state.render.plan = { seconds: plan.seconds, renderBlocks: plan.renderBlocks };
  }
  return state;
}

/** Derive the options a stored job was created with from its steps JSON. */
export function optionsFromSteps(steps: Record<string, unknown> | null | undefined): PipelineOptions {
  const voiceover = steps?.voiceover as Record<string, unknown> | undefined;
  const video = steps?.video as Record<string, unknown> | undefined;
  const plan = (video?.plan ?? null) as (FullVideoPlan & { footage?: FootageMode; duration?: string }) | null;
  return {
    research: Boolean(steps?.research),
    voiceover: Boolean(voiceover),
    subtitles: Boolean(voiceover?.subtitles),
    video: Boolean(video),
    fullVideo: Boolean(steps?.render) && Boolean(plan),
    footage: plan?.footage,
    duration: plan?.duration,
  };
}
