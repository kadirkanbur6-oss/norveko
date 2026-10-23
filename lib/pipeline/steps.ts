// lib/pipeline/steps.ts
// Pipeline step definitions and credit costs — the single source of truth.

export type PipelineStepId = "script" | "voiceover" | "thumbnail" | "video";

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

/** Options that decide which optional steps a job includes. */
export interface PipelineOptions {
  voiceover?: boolean;
  video?: boolean;
}

/* ---------------- Video (Kling) pricing ---------------- */

/** Credits charged per generated clip. Tune against Kling's per-second price. */
export const VIDEO_CLIP_CREDITS = 12;
/** Clips generated per job (one per scene, capped). Charged up front. */
export const VIDEO_MAX_CLIPS = 5;
/** Seconds per clip requested from the provider. */
export const VIDEO_CLIP_SECONDS = 5;

export const PIPELINE_STEP_ORDER: StepDefinition[] = [
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
    label: "Video clips",
    credits: VIDEO_CLIP_CREDITS * VIDEO_MAX_CLIPS,
    provider: "kling:kling-v2-1",
    async: true,
  },
];

/** Accept the legacy boolean (voiceover only) or the options object. */
function normalize(opts: boolean | PipelineOptions | undefined): Required<PipelineOptions> {
  if (typeof opts === "boolean") return { voiceover: opts, video: false };
  return { voiceover: Boolean(opts?.voiceover), video: Boolean(opts?.video) };
}

export function buildPipelineSteps(
  opts: boolean | PipelineOptions = false
): StepDefinition[] {
  const { voiceover, video } = normalize(opts);
  return PIPELINE_STEP_ORDER.filter((step) => {
    if (step.id === "voiceover") return voiceover;
    if (step.id === "video") return video;
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
  return buildPipelineSteps(opts).reduce((sum, step) => sum + step.credits, 0);
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
  return state;
}

/** Derive the options a stored job was created with from its steps JSON. */
export function optionsFromSteps(steps: Record<string, unknown> | null | undefined): Required<PipelineOptions> {
  return {
    voiceover: Boolean(steps?.voiceover),
    video: Boolean(steps?.video),
  };
}
