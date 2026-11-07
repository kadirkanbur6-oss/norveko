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
export type FootageMode = "hybrid" | "cinematic" | "stills" | "stock";
export const FOOTAGE_MODES: FootageMode[] = ["hybrid", "cinematic", "stills", "stock"];

/**
 * How AI clips are made (31 Oct 2026, chosen in the model lab):
 *   "image" — the slot's scene still (Nano Banana 2.1) is animated by
 *             Seedance 1.5 Pro on fal: clips match the stills, ~$0.16 a clip.
 *   "text"  — Kling 3.0 text-to-video: free composition, ~$0.42 a clip.
 */
export type ClipMode = "image" | "text";
export const CLIP_MODES: ClipMode[] = ["image", "text"];
/**
 * Clip types new videos may pick. "text" (Kling) is hidden: its trial pack ends in late Nov 2026
 * and we chose not to buy one (7 Nov 2026, Yağmur). Old jobs keep their recorded mode.
 */
export const OFFERED_CLIP_MODES: ClipMode[] = ["image"];

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
  /** Image→video (Seedance) or text→video (Kling) for the AI clips. */
  clipMode?: ClipMode;
  /** Duration label from lib/pipeline/options.ts (needed to size the plan). */
  duration?: string;
  /** Which TTS engine reads the narration — priced differently (Gemini ≪ ElevenLabs). */
  voiceEngine?: VoiceEngine;
  /** The free-trial video (one per account): every item costs 0 credits. */
  trialVideo?: boolean;
  /** A cast member presents on camera, lip-synced to the narration (talking avatar). */
  presenter?: boolean;
}

/**
 * Free trial (31 Oct 2026, Kadir: "deneme de bir video üretebilsin"): one
 * 30-second video per account, hybrid footage with image→video clips and the
 * Norveko watermark. Provider cost ≈ $0.80; credits are not involved.
 */
export const TRIAL_VIDEO = { duration: "30 seconds", footage: "hybrid", clipMode: "image" } as const;

/** Does this request match the free-trial video format? */
export function isTrialVideoShape(opts: PipelineOptions): boolean {
  return (
    Boolean(opts.fullVideo) &&
    opts.duration === TRIAL_VIDEO.duration &&
    (opts.footage ?? "hybrid") === TRIAL_VIDEO.footage &&
    (opts.clipMode ?? "image") === TRIAL_VIDEO.clipMode
  );
}

export type VoiceEngine = "gemini" | "elevenlabs";

/* ---------------- Pricing (31 Oct 2026: 40% gross margin — Kadir: more videos per pack) ----------------
 * Revenue per credit after Paddle (5% + $0.50) is lowest on the Business
 * pack: ($59 × 0.95 − 0.50) / 5000 ≈ $0.0111. A 40% margin means
 *     credits ≥ provider cost / (0.60 × $0.0111) = provider cost × 150.
 * (Was 60% / × 225 until the evening of 31 Oct.)
 * Costs below are the REAL averages from provider_usage (lab "usage-report",
 * 31 Oct runs) plus the provider price lists; see CLAUDE.md §Fiyatlandırma.
 */
export const TARGET_MARGIN = 0.4;
/** Worst-case net revenue per credit (Business pack after Paddle fees). */
export const REVENUE_PER_CREDIT_USD = (59 * 0.95 - 0.5) / 5000;
/** Credits needed to sell `usd` of provider cost at the target margin. */
export function creditsForCost(usd: number, margin: number = TARGET_MARGIN): number {
  return Math.ceil(usd / ((1 - margin) * REVENUE_PER_CREDIT_USD));
}

/** Seconds of narration a duration label stands for. */
export function durationSeconds(label: string | undefined): number {
  const d = (label ?? "60 seconds").toLowerCase();
  const n = Number(d.match(/\d+/)?.[0] ?? 60);
  return d.includes("minute") ? n * 60 : n;
}
/** Narration is billed per started 30 s, so a 30 s video costs less than a 60 s one. */
function startedHalfMinutes(label: string | undefined): number {
  return Math.max(1, Math.ceil(durationSeconds(label) / 30));
}

/**
 * Script (plan → draft → editor → fact check on gpt-6.1-terra): measured
 * $0.028–0.035 for a 60 s Short; longer scripts write proportionally more.
 */
export function scriptCredits(duration: string | undefined): number {
  const s = durationSeconds(duration);
  if (s <= 30) return creditsForCost(0.03); // 5
  if (s <= 60) return creditsForCost(0.04); // 7
  if (s <= 180) return creditsForCost(0.07); // 11
  return creditsForCost(0.12); // 19
}

/**
 * Narration per started minute. Gemini Pro TTS ≈ $0.03/min (+ an occasional
 * length retake + forced alignment) ≈ $0.05/min. ElevenLabs ≈ 900 characters
 * a minute × $0.18/1K + retake ≈ $0.20/min.
 */
export const VOICE_CREDITS_PER_30S: Record<VoiceEngine, number> = {
  gemini: creditsForCost(0.025), // 4
  elevenlabs: creditsForCost(0.1), // 16
};
/** Per-minute figures for display (2 × the 30 s price). */
export const VOICE_CREDITS_PER_MIN: Record<VoiceEngine, number> = {
  gemini: VOICE_CREDITS_PER_30S.gemini * 2, // 8
  elevenlabs: VOICE_CREDITS_PER_30S.elevenlabs * 2, // 32
};
export function voiceoverCredits(engine: VoiceEngine | undefined, duration: string | undefined): number {
  return VOICE_CREDITS_PER_30S[engine === "elevenlabs" ? "elevenlabs" : "gemini"] * startedHalfMinutes(duration);
}

/** Word-timed subtitles per started 30 s (alignment ≈ $0.005/min + compute). */
export const SUBTITLES_CREDITS_PER_30S = 2;
export const SUBTITLES_CREDITS_PER_MIN = SUBTITLES_CREDITS_PER_30S * 2; // 4
export function subtitlesCredits(duration: string | undefined): number {
  return SUBTITLES_CREDITS_PER_30S * startedHalfMinutes(duration);
}

/* ---------------- Video pricing (≥70% margin target) ----------------
 * Revenue per credit after Paddle fees is ≈ $0.011 (Business pack, worst
 * case). Margin ≥ 70% ⇒ price ≥ provider cost × 3.33. Provider costs
 * (Oct 2026): Kling 3.0 720p 5 s ≈ $0.42 (0.6 units/s × $0.14), Gemini image ≈ $0.04, Shotstack
 * render ≈ $0.20/min. See docs in CLAUDE.md §"Fiyatlandırma".
 */

/** Credits per 5-second Kling 3.0 clip, 720p, no audio (3 units ≈ $0.42). */
export const VIDEO_CLIP_CREDITS = creditsForCost(0.42); // 64
/**
 * Credits per 5-second image→video clip: Nano Banana 2.1 still ($0.034, ~1.17
 * calls per still incl. retries) + Seedance 1.5 Pro silent 720p (~$0.13).
 */
export const IMAGE_CLIP_CREDITS = creditsForCost(0.17); // 26

export function clipCredits(mode: ClipMode | undefined): number {
  return mode === "text" ? VIDEO_CLIP_CREDITS : IMAGE_CLIP_CREDITS;
}
/** Legacy clips-only option: clips generated per job (one per scene, capped). */
export const VIDEO_MAX_CLIPS = 5;
/** Seconds per Kling clip requested from the provider. */
export const VIDEO_CLIP_SECONDS = 5;
/** Credits per AI still scene (Nano Banana 2.1 $0.034 × ~1.17 calls incl. retries). */
export const STILL_SCENE_CREDITS = creditsForCost(0.04); // 7
/** Credits per started 30 s of rendered output (Shotstack $0.20/min, billed per second). */
export const RENDER_CREDITS_PER_30S = creditsForCost(0.1); // 16
/** Thumbnail: Gemini 3.1 Flash Image ≈ $0.067. */
export const THUMBNAIL_CREDITS = creditsForCost(0.067); // 11
/** Timeline slot length a short full video is planned in (one visual per slot). */
export const SLOT_SECONDS = 5;
/**
 * Long-form (> 60 s, 1 Nov 2026): one visual every 10 s, like the long-form
 * tools (LongStories, Fliki): calm pacing, and half the images of 5 s slots.
 */
export const LONG_SLOT_SECONDS = 10;
export function slotSecondsFor(seconds: number): number {
  return seconds > 60 ? LONG_SLOT_SECONDS : SLOT_SECONDS;
}

/** Full-video durations (label → seconds). Long ones are horizontal YouTube long-form only. */
export const FULL_VIDEO_DURATIONS: Record<string, number> = {
  "30 seconds": 30,
  "60 seconds": 60,
  "3 minutes": 180,
  "10 minutes": 600,
};
/** Durations above this are long-form: 16:9 only, no "all clips" (cinematic) footage. */
export const SHORT_FORM_MAX_SECONDS = 60;

/** Footage modes offered for a duration (cinematic = every slot a clip, short videos only). */
export function footageModesFor(duration: string | undefined): FootageMode[] {
  const seconds = FULL_VIDEO_DURATIONS[duration ?? ""] ?? 0;
  return seconds > SHORT_FORM_MAX_SECONDS ? ["stock", "hybrid", "stills"] : FOOTAGE_MODES;
}

/**
 * Stock footage slot (Pixabay/Pexels, free licence): search + a vision fit check
 * (≈ $0.004 at Gemini 3.8 Flash's 2027 price). If nothing fits, the slot gets an AI
 * still ($0.04) at our cost, so the price covers one fallback in five (6 Nov 2026;
 * was 1 credit, which a long video with many fallbacks sold at a loss).
 */
export const STOCK_FALLBACK_SHARE = 0.2;
export const STOCK_SLOT_CREDITS = creditsForCost(0.004 + STOCK_FALLBACK_SHARE * 0.04); // 2

export interface FullVideoPlan {
  seconds: number;
  /** Number of ~5 s visual slots on the timeline. */
  slots: number;
  /** Seconds per slot (5 for Shorts, 10 for long-form). */
  slotSeconds: number;
  /** Slots filled with an AI clip; the rest get AI stills or stock footage. */
  klingSlots: number;
  stillSlots: number;
  /** Slots filled with stock footage ("stock" footage mode). */
  stockSlots: number;
  renderBlocks: number;
  clipMode: ClipMode;
  /** Credits per AI clip for this plan (refunds use the same number). */
  clipCredits: number;
  /** Credits per AI still for this plan (refunds use the same number). */
  stillCredits: number;
  /** Credits per stock slot for this plan. */
  stockCredits: number;
  /** Slots where the presenter talks to camera (lip-synced avatar), and their price each. */
  avatarSlots?: number;
  avatarCredits?: number;
  credits: { kling: number; stills: number; stock: number; render: number; avatar?: number; total: number };
}

/**
 * Lip-sync (presenter slots, Talk, skits). 3 Nov 2026: Kling AI Avatar v2
 * Standard on fal, $0.0562/s, with VEED Fabric ($0.15/s) as the fallback when
 * Kling fails — priced at $0.075/s to cover the occasional fallback.
 * Shorts get 2 presenter slots (5 s), long-form 3 (10 s).
 */
export const AVATAR_COST_PER_SECOND = 0.075;
export function avatarSlotCredits(slotSeconds: number): number {
  return creditsForCost(AVATAR_COST_PER_SECOND * slotSeconds);
}

/**
 * Size the visuals + render for a full video. Hybrid uses a Kling clip in
 * every 4th slot (3 of 12 for 60 s), cinematic in all, stills in none.
 */
export function fullVideoPlan(
  duration: string | undefined,
  footage: FootageMode = "hybrid",
  clipMode: ClipMode = "image",
  presenter = false
): FullVideoPlan | null {
  const seconds = FULL_VIDEO_DURATIONS[duration ?? ""];
  if (!seconds) return null;
  const long = seconds > SHORT_FORM_MAX_SECONDS;
  if (long && footage === "cinematic") return null; // 60–120 clips: not offered
  const slotSeconds = slotSecondsFor(seconds);
  const slots = Math.ceil(seconds / slotSeconds);
  // Hybrid: a clip every 4th slot in Shorts, every 6th in long-form.
  // Stock: two of three slots stock footage, every third an AI still (incl. the opening).
  const klingSlots =
    footage === "cinematic" ? slots : footage === "hybrid" ? Math.ceil(slots / (long ? 6 : 4)) : 0;
  const stockSlots = footage === "stock" ? slots - Math.ceil(slots / 3) : 0;
  // Presenter slots replace AI stills (never clips or stock).
  const avatarSlots = presenter ? Math.min(long ? 3 : 2, slots - klingSlots - stockSlots) : 0;
  const stillSlots = slots - klingSlots - stockSlots - avatarSlots;
  const renderBlocks = Math.ceil(seconds / 30);
  const perClip = clipCredits(clipMode);
  const kling = klingSlots * perClip;
  const stills = stillSlots * STILL_SCENE_CREDITS;
  const stock = stockSlots * STOCK_SLOT_CREDITS;
  const perAvatar = avatarSlotCredits(slotSeconds);
  const avatar = avatarSlots * perAvatar;
  const render = renderBlocks * RENDER_CREDITS_PER_30S;
  return {
    seconds,
    slots,
    slotSeconds,
    klingSlots,
    stillSlots,
    stockSlots,
    renderBlocks,
    clipMode,
    clipCredits: perClip,
    stillCredits: STILL_SCENE_CREDITS,
    stockCredits: STOCK_SLOT_CREDITS,
    ...(avatarSlots ? { avatarSlots, avatarCredits: perAvatar } : {}),
    credits: { kling, stills, stock, render, ...(avatarSlots ? { avatar } : {}), total: kling + stills + stock + avatar + render },
  };
}

/** Research: gpt-6.1-terra tokens (~$0.016) + 2–3 web-search calls at $10/1K ≈ $0.045. */
export const RESEARCH_CREDITS = creditsForCost(0.045); // 7

export const PIPELINE_STEP_ORDER: StepDefinition[] = [
  {
    id: "research",
    label: "Research",
    credits: RESEARCH_CREDITS,
    provider: "openai:gpt-6.1-terra",
  },
  {
    id: "script",
    label: "Content Package",
    credits: scriptCredits("60 seconds"), // per duration: scriptCredits()
    provider: "openai:gpt-6.1-terra",
  },
  {
    id: "voiceover",
    label: "Voiceover",
    credits: VOICE_CREDITS_PER_MIN.gemini, // per minute and engine: voiceoverCredits()
    provider: "elevenlabs:eleven_multilingual_v2",
  },
  {
    id: "thumbnail",
    label: "Thumbnail",
    credits: THUMBNAIL_CREDITS,
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
  clipMode: ClipMode;
  duration: string | undefined;
  voiceEngine: VoiceEngine;
  trialVideo: boolean;
  presenter: boolean;
};

function normalize(opts: boolean | PipelineOptions | undefined): Normalized {
  if (typeof opts === "boolean") {
    return { research: false, voiceover: opts, subtitles: false, video: false, fullVideo: false, footage: "hybrid", clipMode: "image", duration: undefined, voiceEngine: "gemini", trialVideo: false, presenter: false };
  }
  const fullVideo = Boolean(opts?.fullVideo) && Boolean(fullVideoPlan(opts?.duration, opts?.footage));
  // A full video always narrates; burned-in subtitles are an option (4 Nov 2026, Kadir).
  const voiceover = fullVideo || Boolean(opts?.voiceover);
  return {
    research: Boolean(opts?.research),
    voiceover,
    subtitles: voiceover && Boolean(opts?.subtitles),
    video: fullVideo || Boolean(opts?.video),
    fullVideo,
    footage: FOOTAGE_MODES.includes(opts?.footage as FootageMode) ? (opts!.footage as FootageMode) : "hybrid",
    clipMode: CLIP_MODES.includes(opts?.clipMode as ClipMode) ? (opts!.clipMode as ClipMode) : "image",
    duration: opts?.duration,
    voiceEngine: opts?.voiceEngine === "elevenlabs" ? "elevenlabs" : "gemini",
    trialVideo: fullVideo && Boolean(opts?.trialVideo),
    presenter: fullVideo && !opts?.trialVideo && Boolean(opts?.presenter),
  };
}

/** Exported for the UI / API so everyone resolves options the same way. */
export function resolvePipelineOptions(opts: boolean | PipelineOptions | undefined) {
  return normalize(opts);
}

/** Add-ons that ride on a step instead of being steps themselves. */
export function addonCredits(opts: boolean | PipelineOptions = false): number {
  const n = normalize(opts);
  return n.subtitles ? subtitlesCredits(n.duration) : 0;
}

/** Itemised credits for the billing UI and the charge reason. */
export function creditBreakdown(opts: boolean | PipelineOptions = false): Array<{ id: string; label: string; credits: number }> {
  const n = normalize(opts);
  const plan = n.fullVideo ? fullVideoPlan(n.duration, n.footage, n.clipMode, n.presenter) : null;
  const items: Array<{ id: string; label: string; credits: number }> = [];
  for (const step of buildPipelineSteps(opts)) {
    if (step.id === "video" && plan) {
      if (plan.klingSlots)
        items.push({
          id: "kling",
          label: `AI video clips × ${plan.klingSlots} (${plan.clipMode === "text" ? "text → video" : "image → video"})`,
          credits: plan.credits.kling,
        });
      if (plan.stillSlots) items.push({ id: "stills", label: `AI scenes × ${plan.stillSlots}`, credits: plan.credits.stills });
      if (plan.stockSlots) items.push({ id: "stock", label: `Stock footage × ${plan.stockSlots}`, credits: plan.credits.stock });
      if (plan.avatarSlots) items.push({ id: "avatar", label: `Presenter on camera × ${plan.avatarSlots} (lip-synced)`, credits: plan.credits.avatar ?? 0 });
      continue;
    }
    if (step.id === "render" && plan) {
      items.push({ id: "render", label: `Final video render (${plan.seconds} s)`, credits: plan.credits.render });
      continue;
    }
    if (step.id === "script") {
      items.push({ id: "script", label: step.label, credits: scriptCredits(n.duration) });
      continue;
    }
    if (step.id === "voiceover") {
      const secs = durationSeconds(n.duration);
      items.push({
        id: "voiceover",
        label: `Voiceover (${n.voiceEngine === "elevenlabs" ? "ElevenLabs voice" : "Norveko narrator"}, ${secs < 60 ? `${secs} s` : `${Math.round(secs / 60)} min`})`,
        credits: voiceoverCredits(n.voiceEngine, n.duration),
      });
      if (n.subtitles) items.push({ id: "subtitles", label: "Auto subtitles", credits: subtitlesCredits(n.duration) });
      continue;
    }
    items.push({ id: step.id, label: step.label, credits: step.credits });
  }
  // Free-trial video: same work, nothing charged (and so nothing to refund).
  if (n.trialVideo) return items.map((item) => ({ ...item, credits: 0 }));
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
  // Record what each step was charged so refunds use the price at purchase
  // time even after prices change.
  for (const item of creditBreakdown(opts)) {
    if (item.id === "subtitles" && state.voiceover) state.voiceover.subtitles_credits = item.credits;
    else if (state[item.id]) state[item.id].credits = item.credits;
  }
  if (state.script) state.script.duration = n.duration ?? null;
  if (state.voiceover) state.voiceover.engine = n.voiceEngine;
  if (n.fullVideo) {
    const full = fullVideoPlan(n.duration, n.footage, n.clipMode, n.presenter)!;
    const plan = n.trialVideo
      ? { ...full, clipCredits: 0, stillCredits: 0, stockCredits: 0, credits: { kling: 0, stills: 0, stock: 0, render: 0, total: 0 } }
      : full;
    state.video.plan = { ...plan, footage: n.footage, duration: n.duration, ...(n.trialVideo ? { trial: true } : {}) };
    state.render.plan = { seconds: plan.seconds, renderBlocks: plan.renderBlocks };
  }
  return state;
}

/** Derive the options a stored job was created with from its steps JSON. */
export function optionsFromSteps(steps: Record<string, unknown> | null | undefined): PipelineOptions {
  const voiceover = steps?.voiceover as Record<string, unknown> | undefined;
  const video = steps?.video as Record<string, unknown> | undefined;
  const plan = (video?.plan ?? null) as (Partial<FullVideoPlan> & { footage?: FootageMode; duration?: string }) | null;
  return {
    research: Boolean(steps?.research),
    voiceover: Boolean(voiceover),
    subtitles: Boolean(voiceover?.subtitles),
    video: Boolean(video),
    fullVideo: Boolean(steps?.render) && Boolean(plan),
    footage: plan?.footage,
    // Plans created before clip modes existed were Kling text→video.
    clipMode: plan ? (plan.clipMode ?? "text") : undefined,
    duration: plan?.duration ?? ((steps?.script as Record<string, unknown> | undefined)?.duration as string | undefined) ?? undefined,
    trialVideo: Boolean((plan as { trial?: boolean } | null)?.trial),
    presenter: Number((plan as { avatarSlots?: number } | null)?.avatarSlots) > 0,
    voiceEngine:
      voiceover?.engine === "elevenlabs" ||
      (voiceover?.engine === undefined && typeof voiceover?.voice_id === "string" && !String(voiceover.voice_id).startsWith("gemini:"))
        ? "elevenlabs"
        : "gemini",
  };
}

/* ---------------- One-click translation (2 Nov 2026) ----------------
 * A finished full video in another language: the script is translated, a new
 * voice-over, subtitles and cover (it carries words) are made and the
 * ORIGINAL scene visuals are reused, then it is rendered again. Only the new work is charged.
 */
export function translationScriptCredits(duration: string | undefined): number {
  // One translation pass ≈ half the cost of writing (no plan, editor or fact check).
  return Math.max(3, Math.ceil(scriptCredits(duration) / 2));
}

export function translationJob(opts: PipelineOptions): {
  steps: Record<string, StepState>;
  items: Array<{ id: string; label: string; credits: number }>;
  total: number;
} {
  // Subtitles follow the original video (on unless it had none).
  const full = { ...opts, fullVideo: true, research: false, voiceover: true, subtitles: opts.subtitles !== false, trialVideo: false };
  const steps = initialStepsState(full);
  const n = normalize(full);
  const plan = fullVideoPlan(n.duration, n.footage, n.clipMode);
  if (!plan || !steps.video) throw new Error("This video can't be translated.");
  const items = [
    { id: "script", label: "Translation", credits: translationScriptCredits(n.duration) },
    { id: "voiceover", label: `New voice-over (${durationSeconds(n.duration) < 60 ? `${durationSeconds(n.duration)} s` : `${Math.round(durationSeconds(n.duration) / 60)} min`})`, credits: voiceoverCredits(n.voiceEngine, n.duration) },
    { id: "subtitles", label: "Subtitles", credits: n.subtitles ? subtitlesCredits(n.duration) : 0 },
    // The cover has words on it, so it is made again in the new language.
    { id: "thumbnail", label: "New thumbnail", credits: THUMBNAIL_CREDITS },
    { id: "render", label: `Final video render (${plan.seconds} s)`, credits: plan.credits.render },
  ];
  steps.script.credits = items[0].credits;
  steps.voiceover.credits = items[1].credits;
  if (n.subtitles) steps.voiceover.subtitles_credits = items[2].credits;
  steps.thumbnail.credits = items[3].credits;
  steps.render.credits = items[4].credits;
  // Reused visuals cost nothing, so nothing of them is ever refunded either.
  steps.video.plan = {
    ...(steps.video.plan as Record<string, unknown>),
    clipCredits: 0,
    stillCredits: 0,
    stockCredits: 0,
    credits: { ...plan.credits, kling: 0, stills: 0, stock: 0, total: plan.credits.render },
    translation: true,
  };
  return { steps, items: items.filter((i) => i.credits > 0 || i.id !== "subtitles"), total: items.reduce((sum, i) => sum + i.credits, 0) };
}

/* ---------------- Shorts from a long video (2 Nov 2026) ----------------
 * A 25–58 s window of a finished long video, re-framed vertically with its
 * own hook card, subtitles and vertical cover. Narration, visuals and music
 * are reused, so only the cover and the render are charged.
 */
export const SHORT_MIN_SECONDS = 20;
export const SHORT_MAX_SECONDS = 59;
export const MAX_SHORTS_PER_VIDEO = 5;

export function shortJob(opts: PipelineOptions & { seconds: number }): {
  steps: Record<string, StepState>;
  total: number;
  duration: string;
} {
  const duration = opts.seconds <= 30 ? "30 seconds" : "60 seconds";
  // Subtitles are free on a Short (cut from the original's cues) and on unless switched off.
  const full = { ...opts, duration, fullVideo: true, research: false, voiceover: true, subtitles: opts.subtitles !== false, trialVideo: false, footage: "stills" as FootageMode };
  const steps = initialStepsState(full);
  const plan = fullVideoPlan(duration, "stills");
  if (!plan || !steps.video) throw new Error("This video can't be cut into Shorts.");
  for (const id of ["script", "voiceover"]) steps[id].credits = 0;
  if (steps.voiceover.subtitles) steps.voiceover.subtitles_credits = 0;
  // Its own vertical cover with the Short's hook.
  steps.thumbnail.credits = THUMBNAIL_CREDITS;
  steps.render.credits = plan.credits.render;
  steps.video.plan = {
    ...(steps.video.plan as Record<string, unknown>),
    clipCredits: 0,
    stillCredits: 0,
    stockCredits: 0,
    credits: { ...plan.credits, kling: 0, stills: 0, stock: 0, total: plan.credits.render },
    short: true,
  };
  return { steps, total: plan.credits.render + THUMBNAIL_CREDITS, duration };
}
