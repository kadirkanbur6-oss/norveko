// lib/pipeline/runner.ts
// Background execution of pipeline jobs. Server-only.
//
// Design (Vercel-friendly, no queue service):
//   - /api/pipeline/start only validates, charges credits and inserts the job
//     with status "running" and every step "pending". It then *kicks* the
//     worker and returns immediately.
//   - /api/pipeline/run executes exactly ONE step per invocation (so each step
//     gets its own function timeout window), then kicks itself again for the
//     next step. Chaining happens inside `after()` so the HTTP response is
//     never blocked by the next step.
//   - Each step is claimed atomically (pending -> running) with a conditional
//     update, so duplicate kicks are harmless.
//   - Stuck jobs are reconciled by `reconcileJob()` (called from the status
//     endpoint for the job being polled, and from the reap cron) which fails
//     the job and refunds credits exactly once.
//
// Everything is built through `createPipelineRunner(deps)` so the logic can be
// tested without Supabase or provider network calls; the module-level exports
// are the production instance.

import { alignmentToCues, cuesToSrt, type CaptionCue } from "@/lib/pipeline/captions";
import {
  buildEdit,
  narrationSeconds,
  planSlots,
  type TimelineSlot,
} from "@/lib/pipeline/timeline";
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildPipelineSteps,
  getPipelineStepDefinition,
  nextStep,
  optionsFromSteps,
  VIDEO_CLIP_CREDITS,
  STILL_SCENE_CREDITS,
  RESEARCH_CREDITS,
  creditBreakdown,
  type FullVideoPlan,
  VIDEO_CLIP_SECONDS,
  VIDEO_MAX_CLIPS,
  type PipelineStepId,
} from "@/lib/pipeline/steps";
import type { KlingTaskResult } from "@/lib/pipeline/kling";
import { getTemplate } from "@/lib/pipeline/templates";
import { musicCredit, pickMusicTrack, type MusicTrack } from "@/lib/pipeline/music";
import { defaultOrientation, languageCode } from "@/lib/pipeline/options";
import { narrationWordCount, rangeForMeasuredRatio } from "@/lib/pipeline/narration";
import { RESEARCH_MODEL, SCRIPT_MODEL, llmUsageKey } from "@/lib/pipeline/llm";
import { captionStyle, clipPrompt } from "@/lib/pipeline/visual-styles";
import { WATERMARK_PUBLIC_PATH } from "@/lib/pipeline/watermark-policy";
import {
  estimateCostUsd,
  recordProviderUsage,
  splitProvider,
  type UsageRecord,
} from "@/lib/pipeline/usage";
import { captureError } from "@/lib/observability";

/** A step that has been running longer than this is considered dead. */
export const STEP_TIMEOUT_MS = 8 * 60 * 1000;
/** Research is optional: a dead research step is skipped (not failed) after this. */
export const RESEARCH_STEP_TIMEOUT_MS = 2 * 60 * 1000;
/** Async (provider-side) steps may legitimately take much longer. */
export const ASYNC_STEP_TIMEOUT_MS = 40 * 60 * 1000;
/** A pending step that nobody picked up for this long gets re-kicked. */
export const KICK_RETRY_MS = 90 * 1000;
/** Give up on a single Kling clip after this long in the provider queue. */
export const KLING_CLIP_TIMEOUT_MS = 12 * 60 * 1000;
/** How often an async step is polled while it is in flight. */
export const ASYNC_POLL_INTERVAL_MS = 20 * 1000;

export interface VideoClipState {
  sceneNumber: number;
  prompt: string;
  taskId?: string;
  status: "pending" | "processing" | "succeed" | "failed";
  error?: string;
  video_url?: string;
  storage_path?: string;
  duration?: number;
}

type StepRecord = Record<string, unknown> & {
  status?: "pending" | "running" | "completed" | "failed" | "skipped";
  started_at?: string;
  queued_at?: string;
  error?: string | null;
};

export interface JobRow {
  id: string;
  user_id: string;
  idea: string;
  platform: string | null;
  style: string | null;
  duration: string | null;
  output_language: string | null;
  /** Optional UI choices stored on the job (orientation, template id). */
  options?: {
    orientation?: "vertical" | "horizontal";
    template?: string | null;
    notes?: string | null;
    /** Look presets (lib/pipeline/visual-styles.ts). */
    visualStyle?: string | null;
    captionStyle?: string | null;
  } | null;
  status: "queued" | "running" | "completed" | "failed";
  current_step: string | null;
  steps: Record<string, StepRecord>;
  credits_charged: number | null;
  credits_refunded: number | null;
  error: string | null;
  created_at: string;
}

export type RunOutcome = "advanced" | "completed" | "noop" | "failed";
export type ReconcileAction = "failed" | "kicked" | "ok";

/** Injectable dependencies so the runner can be exercised without network. */
export interface RunnerDeps {
  db: SupabaseClient;
  providers: {
    generateScript: typeof import("@/lib/pipeline/openai").generateScript;
    researchTopic: typeof import("@/lib/pipeline/openai").researchTopic;
    generateSpeech: typeof import("@/lib/pipeline/tts").synthesizeNarration;
    reviseNarration: typeof import("@/lib/pipeline/openai").reviseNarrationLength;
    generateThumbnail: typeof import("@/lib/pipeline/gemini-image").generateThumbnail;
    submitTextToVideo: typeof import("@/lib/pipeline/kling").submitTextToVideo;
    getTextToVideoTask: typeof import("@/lib/pipeline/kling").getTextToVideoTask;
    submitImageToVideo: typeof import("@/lib/pipeline/fal-video").submitImageToVideo;
    getImageToVideo: typeof import("@/lib/pipeline/fal-video").getImageToVideo;
    downloadVideo: typeof import("@/lib/pipeline/kling").downloadVideo;
    generateSceneImage: typeof import("@/lib/pipeline/gemini-image").generateSceneImage;
    submitRender: typeof import("@/lib/pipeline/shotstack").submitRender;
    getRender: typeof import("@/lib/pipeline/shotstack").getRender;
    downloadRender: typeof import("@/lib/pipeline/shotstack").downloadRender;
    /** Free-trial watermark (optional so tests can leave it out → never watermark). */
    needsWatermark?: (userId: string) => Promise<boolean>;
    watermarkThumbnail?: typeof import("@/lib/pipeline/watermark").watermarkStoredThumbnail;
  };
  kick: (jobId: string) => Promise<void>;
  now: () => number;
  /**
   * Provider cost log sink (see lib/pipeline/usage.ts). Optional so tests can
   * omit it; production writes to the `provider_usage` table.
   */
  recordUsage?: (record: UsageRecord) => Promise<void>;
  /**
   * Called after a job finishes (first render and re-renders alike). Series
   * autopilot uses it to publish episodes; failures here never fail the job.
   */
  afterComplete?: (jobId: string) => Promise<void>;
}

/* ----------------------------------------------------------------------- */
/* Worker addressing                                                        */
/* ----------------------------------------------------------------------- */

export function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

export function getWorkerSecret(): string {
  const secret = process.env.PIPELINE_WORKER_SECRET ?? process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("PIPELINE_WORKER_SECRET (or CRON_SECRET) is not set.");
  }
  return secret;
}

/**
 * Fire a request to the worker route. Awaited so that, inside `after()`, the
 * request is fully sent before the function is frozen.
 */
export async function kickJob(jobId: string): Promise<void> {
  try {
    const res = await fetch(`${getBaseUrl()}/api/pipeline/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${getWorkerSecret()}`,
      },
      body: JSON.stringify({ jobId }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[pipeline] kick ${jobId} -> HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[pipeline] kick ${jobId} failed:`, err);
  }
}

/** Prefer the first AI-generated title; fall back to the idea. */
function projectTitle(titles: unknown, idea: string): string {
  const first = Array.isArray(titles) ? titles.find((t) => typeof t === "string" && t.trim()) : null;
  return (typeof first === "string" ? first.trim() : idea).slice(0, 120);
}

/* ----------------------------------------------------------------------- */
/* Runner factory                                                           */
/* ----------------------------------------------------------------------- */

export function createPipelineRunner(deps: RunnerDeps) {
  const { db, providers, kick, now } = deps;

  /** Write one provider usage row; never throws. */
  async function logUsage(
    job: Pick<JobRow, "id" | "user_id">,
    stepId: PipelineStepId,
    data: Omit<UsageRecord, "jobId" | "userId" | "step" | "provider" | "model" | "estimatedCostUsd"> & {
      inputTokens?: number;
      outputTokens?: number;
      /** "provider:model" when it differs from the step default (e.g. Gemini voices). */
      usageKey?: string;
    }
  ): Promise<void> {
    if (!deps.recordUsage) return;
    const { usageKey, ...rest } = data;
    data = rest;
    const { provider, model } = splitProvider(usageKey ?? getPipelineStepDefinition(stepId).provider);
    try {
      await deps.recordUsage({
        jobId: job.id,
        userId: job.user_id,
        step: stepId,
        provider,
        model,
        estimatedCostUsd:
          data.status === "ok"
            ? estimateCostUsd(provider, model, {
                inputTokens: data.inputTokens,
                outputTokens: data.outputTokens,
                quantity: data.quantity,
              })
            : 0,
        ...data,
      });
    } catch (err) {
      console.error(`[usage] log failed for ${job.id}/${stepId}:`, err);
    }
  }

  async function loadJob(jobId: string): Promise<JobRow | null> {
    const { data } = await db
      .from("pipeline_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    return (data as JobRow | null) ?? null;
  }

  /** Merge a patch into steps[stepId] and persist. Not atomic; use for data. */
  async function patchStep(
    job: JobRow,
    stepId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    const steps = { ...(job.steps ?? {}) };
    steps[stepId] = { ...(steps[stepId] ?? {}), ...patch };
    job.steps = steps;
    const { error } = await db
      .from("pipeline_jobs")
      .update({ steps })
      .eq("id", job.id);
    if (error) throw new Error(`Could not update step ${stepId}: ${error.message}`);
  }

  /**
   * Atomically move a step from pending -> running. Returns the fresh job
   * when this call won the claim, or null when another invocation has it.
   */
  async function claimStep(job: JobRow, stepId: PipelineStepId): Promise<JobRow | null> {
    const steps = { ...(job.steps ?? {}) };
    steps[stepId] = {
      ...(steps[stepId] ?? {}),
      status: "running",
      started_at: new Date(now()).toISOString(),
      error: null,
    };

    const { data } = await db
      .from("pipeline_jobs")
      .update({ steps, current_step: stepId, status: "running" })
      .eq("id", job.id)
      .eq("status", "running")
      .eq(`steps->${stepId}->>status`, "pending")
      .select("*")
      .maybeSingle();

    return (data as JobRow | null) ?? null;
  }

  /**
   * Mark the job failed and refund credits, exactly once. The conditional
   * update (status = running AND nothing refunded yet) is the guard.
   * `credits_refunded` defaults to 0 in the DB (older rows may be NULL), so
   * both count as "not refunded" — filtering on IS NULL alone silently
   * skipped every refund and left jobs stuck in "running".
   */
  /**
   * Credits consumed by work that completed (and is delivered to the user).
   * Everything else is refunded when a job fails.
   */
  function consumedCredits(steps: Record<string, StepRecord> | null | undefined): number {
    if (!steps) return 0;
    const items = creditBreakdown(optionsFromSteps(steps));
    const done = (id: string) => steps[id]?.status === "completed";
    // Prefer the price recorded at purchase time (initialStepsState) over today's list.
    const charged = (id: string, fallback: number) => {
      const stored = id === "subtitles" ? steps.voiceover?.subtitles_credits : steps[id]?.credits;
      return typeof stored === "number" ? stored : fallback;
    };
    // (a skipped research step was already refunded — see skipResearch)
    let total = 0;
    for (const item of items) {
      switch (item.id) {
        case "research":
        case "script":
        case "thumbnail":
          if (done(item.id)) total += charged(item.id, item.credits);
          break;
        case "render":
          // A re-render (version ≥ 1) re-does a render that was already delivered and paid.
          if (done("render") || Number(steps.render?.version) > 0) total += charged("render", item.credits);
          break;
        case "voiceover":
        case "subtitles":
          if (done("voiceover")) total += charged(item.id, item.credits);
          break;
        case "kling": {
          const slots = (steps.video?.slots as TimelineSlot[] | undefined) ?? [];
          const clips = (steps.video?.clips as VideoClipState[] | undefined) ?? [];
          const planClip = (steps.video?.plan as Partial<FullVideoPlan> | undefined)?.clipCredits;
          total += slots.filter((x) => x.kind === "kling" && x.status === "succeed").length * (typeof planClip === "number" ? planClip : VIDEO_CLIP_CREDITS);
          total += clips.filter((c) => c.status === "succeed").length * VIDEO_CLIP_CREDITS;
          break;
        }
        case "stills": {
          const slots = (steps.video?.slots as TimelineSlot[] | undefined) ?? [];
          const perStill = (steps.video?.plan as Partial<FullVideoPlan> | undefined)?.stillCredits;
          total += slots.filter((x) => x.kind === "still" && x.status === "succeed").length * (typeof perStill === "number" ? perStill : STILL_SCENE_CREDITS);
          break;
        }
        case "video": // legacy clips-only option: paid per succeeded clip
          total += ((steps.video?.clips as VideoClipState[] | undefined) ?? []).filter((c) => c.status === "succeed").length * VIDEO_CLIP_CREDITS;
          break;
      }
    }
    return total;
  }

  /**
   * Mark the job failed, refund the credits for everything that did NOT
   * complete (finished steps stay paid — their output is saved as a project),
   * exactly once. The conditional update (status = running AND nothing
   * refunded yet) is the guard. `credits_refunded` defaults to 0 in the DB
   * (older rows may be NULL), so both count as "not refunded".
   */
  async function failJob(jobId: string, message: string): Promise<boolean> {
    const { data: claimed, error: claimError } = await db
      .from("pipeline_jobs")
      .update({ status: "failed", error: message })
      .eq("id", jobId)
      .eq("status", "running")
      .or("credits_refunded.is.null,credits_refunded.eq.0")
      .select("id, user_id, credits_charged, steps")
      .maybeSingle();

    if (claimError) {
      console.error(`[pipeline] failJob update failed for ${jobId}:`, claimError.message);
      await captureError(new Error(claimError.message), { jobId, area: "pipeline.failJob" });
    }
    if (!claimed) return false;

    const steps = (claimed.steps as Record<string, StepRecord> | null) ?? {};
    const charged = Number(claimed.credits_charged ?? 0);
    const alreadyRefunded = Number(steps.video?.refunded ?? 0) + Number(steps.research?.refunded ?? 0);
    const refund = Math.max(0, charged - consumedCredits(steps) - alreadyRefunded);
    if (refund > 0) {
      const { error } = await db.rpc("add_credits", {
        p_user_id: claimed.user_id,
        p_amount: refund,
        p_type: "refund",
        p_reason: `Refund: unfinished steps of a failed generation (${message.slice(0, 100)})`,
      });
      if (error) {
        console.error(`[pipeline] refund failed for ${jobId}:`, error);
        return true;
      }
      await db.from("pipeline_jobs").update({ credits_refunded: refund }).eq("id", jobId);
    }

    // Keep what was produced: a finished script becomes a project so the
    // user can still use the package, voiceover or thumbnail they paid for.
    // A failed re-render of a finished video keeps its project (and the previous MP4).
    const hasProject = typeof (steps.result as { project_id?: unknown } | undefined)?.project_id === "string";
    if (steps.script?.status === "completed" && !hasProject) {
      const fresh = await loadJob(jobId);
      if (fresh) {
        const projectId = await saveProject(fresh);
        if (projectId) {
          const patched = { ...(fresh.steps ?? {}), result: { status: "partial", project_id: projectId } };
          await db.from("pipeline_jobs").update({ steps: patched }).eq("id", jobId);
        }
      }
    }
    return true;
  }

  function isDone(status: StepRecord["status"] | undefined): boolean {
    return status === "completed" || status === "skipped";
  }

  /** CC BY attribution for the background track, appended once to the description. */
  function withMusicCredit(description: unknown, music: unknown): unknown {
    const credit = (music as { credit?: string } | null | undefined)?.credit;
    if (typeof description !== "string" || !credit || description.includes(credit)) return description;
    return `${description.trimEnd()}\n\n${credit}`;
  }

  function stepOrder(job: Pick<JobRow, "steps">): PipelineStepId[] {
    return buildPipelineSteps(optionsFromSteps(job.steps)).map((s) => s.id);
  }

  /** Give back credits for clips that were charged but never generated. */
  async function refundUnusedClips(job: JobRow, unusedClips: number): Promise<void> {
    if (unusedClips <= 0) return;
    const amount = unusedClips * VIDEO_CLIP_CREDITS;
    const { error } = await db.rpc("add_credits", {
      p_user_id: job.user_id,
      p_amount: amount,
      p_type: "refund",
      p_reason: `Refund: ${unusedClips} unused video clip${unusedClips === 1 ? "" : "s"}`,
    });
    if (error) {
      console.error(`[pipeline] ${job.id} clip refund failed:`, error);
      return;
    }
    await patchStep(job, "video", { refunded: Number(job.steps?.video?.refunded ?? 0) + amount });
  }

  /* ---------------- Video (async) step ---------------- */

  /** First run of the video step: submit one task per scene. */
  async function submitVideoTasks(job: JobRow): Promise<void> {
    const orientation = job.options?.orientation ?? defaultOrientation(job.platform ?? "");
    const scenes = Array.isArray(job.steps?.script?.scenes)
      ? (job.steps.script.scenes as Array<{ sceneNumber?: number; videoPrompt?: string; description?: string }>)
      : [];
    const usable = scenes
      .filter((s) => typeof s.videoPrompt === "string" && s.videoPrompt.trim())
      .slice(0, VIDEO_MAX_CLIPS);
    if (usable.length === 0) {
      throw new Error("No scene prompts available for video generation.");
    }

    const aspectRatio: "9:16" | "16:9" = orientation === "vertical" ? "9:16" : "16:9";
    const clips: VideoClipState[] = [];
    for (const [i, scene] of usable.entries()) {
      const prompt = String(scene.videoPrompt).trim();
      const clip: VideoClipState = {
        sceneNumber: scene.sceneNumber ?? i + 1,
        prompt,
        status: "pending",
      };
      try {
        clip.taskId = await providers.submitTextToVideo({
          prompt: clipPrompt(prompt, visualStyleOf(job)),
          duration: String(VIDEO_CLIP_SECONDS) as "5" | "10",
          aspectRatio,
          mode: "std",
        });
        clip.status = "processing";
      } catch (err) {
        clip.status = "failed";
        clip.error = err instanceof Error ? err.message : "Submit failed";
        await logUsage(job, "video", {
          unit: "seconds",
          quantity: VIDEO_CLIP_SECONDS,
          durationMs: 0,
          status: "failed",
          error: clip.error,
        });
      }
      clips.push(clip);
    }

    if (clips.every((c) => c.status === "failed")) {
      throw new Error(`Video generation could not be started: ${clips[0].error}`);
    }

    await refundUnusedClips(job, VIDEO_MAX_CLIPS - clips.length);
    await patchStep(job, "video", {
      clips,
      submitted_at: new Date(now()).toISOString(),
      last_polled_at: new Date(now()).toISOString(),
    });
  }

  /** Seconds of speech from a character alignment (0 when unknown). */
  function spokenSeconds(alignment: { character_end_times_seconds: number[] } | null | undefined): number {
    const ends = alignment?.character_end_times_seconds;
    return Array.isArray(ends) && ends.length ? Number(ends[ends.length - 1]) || 0 : 0;
  }

  /** Milliseconds since the video step was submitted (for the cost log). */
  function submittedAgoMs(job: JobRow): number {
    const step = job.steps?.render?.status === "running" ? job.steps.render : job.steps?.video;
    const submitted = Date.parse(String(step?.submitted_at ?? ""));
    return Number.isFinite(submitted) ? Math.max(0, now() - submitted) : 0;
  }

  /**
   * Later runs of the video step: poll in-flight tasks, store finished clips.
   * Returns true once every clip is settled.
   */
  async function pollVideoTasks(job: JobRow): Promise<boolean> {
    const clips = (job.steps?.video?.clips as VideoClipState[] | undefined) ?? [];
    let changed = false;

    for (const clip of clips) {
      if (clip.status !== "processing" || !clip.taskId) continue;
      let result: KlingTaskResult;
      try {
        result = await providers.getTextToVideoTask(clip.taskId);
      } catch (err) {
        console.error(`[pipeline] ${job.id} poll ${clip.taskId} failed:`, err);
        continue;
      }
      if (result.status === "failed") {
        clip.status = "failed";
        clip.error = result.statusMessage ?? "Provider reported failure";
        changed = true;
        await logUsage(job, "video", {
          unit: "seconds",
          quantity: VIDEO_CLIP_SECONDS,
          durationMs: submittedAgoMs(job),
          status: "failed",
          error: clip.error,
        });
      } else if (result.status === "succeed" && result.videoUrl) {
        await logUsage(job, "video", {
          unit: "seconds",
          quantity: result.durationSeconds ?? VIDEO_CLIP_SECONDS,
          durationMs: submittedAgoMs(job),
          status: "ok",
        });
        try {
          const buffer = await providers.downloadVideo(result.videoUrl);
          const storagePath = `${job.user_id}/${job.id}/scene-${clip.sceneNumber}.mp4`;
          const { error: uploadError } = await db.storage
            .from("videos")
            .upload(storagePath, buffer, { contentType: "video/mp4", upsert: true });
          if (uploadError) throw new Error(uploadError.message);
          const { data: urlData } = db.storage.from("videos").getPublicUrl(storagePath);
          clip.video_url = urlData.publicUrl;
          clip.storage_path = storagePath;
          clip.duration = result.durationSeconds;
          clip.status = "succeed";
        } catch (err) {
          clip.status = "failed";
          clip.error = err instanceof Error ? err.message : "Store failed";
        }
        changed = true;
      }
    }

    const settled = clips.every((c) => c.status === "succeed" || c.status === "failed");
    const patch: Record<string, unknown> = { last_polled_at: new Date(now()).toISOString() };
    if (changed) patch.clips = clips;

    if (settled) {
      const succeeded = clips.filter((c) => c.status === "succeed").length;
      await refundUnusedClips(job, clips.length - succeeded);
      if (succeeded === 0) {
        await patchStep(job, "video", patch);
        throw new Error(`All video clips failed: ${clips[0]?.error ?? "unknown error"}`);
      }
      patch.status = "completed";
    }

    await patchStep(job, "video", patch);
    return settled;
  }

  /* ---------------- Full video: slot-based visuals (async) ---------------- */

  /** Stills generated per poll invocation (keeps each worker run short). */
  const STILLS_PER_POLL = 2;

  function isFullVideo(job: JobRow): boolean {
    return Boolean(job.steps?.video?.plan) && Boolean(job.steps?.render);
  }

  function visualStyleOf(job: JobRow): string | null {
    return job.options?.visualStyle ?? null;
  }

  function orientationOf(job: JobRow): "vertical" | "horizontal" {
    return (job.options?.orientation ?? defaultOrientation(job.platform ?? "")) === "vertical"
      ? "vertical"
      : "horizontal";
  }

  /**
   * Skip the optional research step (timeout / provider error): mark it
   * skipped, refund its credits once, and let the pipeline continue.
   */
  async function skipResearch(job: JobRow, reason: string): Promise<void> {
    const already = Number(job.steps?.research?.refunded ?? 0);
    let refunded = already;
    const paid = typeof job.steps?.research?.credits === "number" ? (job.steps.research.credits as number) : RESEARCH_CREDITS;
    if (already <= 0 && paid > 0) {
      const { error } = await db.rpc("add_credits", {
        p_user_id: job.user_id,
        p_amount: paid,
        p_type: "refund",
        p_reason: `Refund: web research skipped (${reason.slice(0, 100)})`,
      });
      if (error) console.error(`[pipeline] ${job.id} research refund failed:`, error);
      else refunded = paid;
    }
    await patchStep(job, "research", { status: "skipped", error: reason.slice(0, 300), refunded, brief: null, sources: [] });
  }

  /** Give back credits for planned visuals that were never produced. */
  /** Credits per AI clip for this job (image→video and text→video differ). */
  function clipCreditsOf(job: Pick<JobRow, "steps">): number {
    const plan = job.steps?.video?.plan as Partial<FullVideoPlan> | undefined;
    return typeof plan?.clipCredits === "number" ? plan.clipCredits : VIDEO_CLIP_CREDITS;
  }

  function clipModeOf(job: Pick<JobRow, "steps">): "image" | "text" {
    const plan = job.steps?.video?.plan as Partial<FullVideoPlan> | undefined;
    return plan?.clipMode === "image" ? "image" : "text";
  }

  async function refundVisuals(job: JobRow, klingUnused: number, stillUnused: number): Promise<void> {
    const perStill = (job.steps?.video?.plan as Partial<FullVideoPlan> | undefined)?.stillCredits;
    const amount =
      Math.max(0, klingUnused) * clipCreditsOf(job) +
      Math.max(0, stillUnused) * (typeof perStill === "number" ? perStill : STILL_SCENE_CREDITS);
    if (amount <= 0) return;
    const { error } = await db.rpc("add_credits", {
      p_user_id: job.user_id,
      p_amount: amount,
      p_type: "refund",
      p_reason: `Refund: unused visuals (${klingUnused} clip${klingUnused === 1 ? "" : "s"}, ${stillUnused} scene${stillUnused === 1 ? "" : "s"})`,
    });
    if (error) {
      console.error(`[pipeline] ${job.id} visuals refund failed:`, error);
      return;
    }
    await patchStep(job, "video", { refunded: Number(job.steps?.video?.refunded ?? 0) + amount });
  }

  /**
   * First run of the visuals step for a full video: plan the slots from the
   * script scenes and narration length, submit every Kling slot, and refund
   * still credits for scenes that share an image.
   */
  async function submitFullVideoVisuals(job: JobRow): Promise<void> {
    const plan = job.steps!.video!.plan as FullVideoPlan;
    const scenes = Array.isArray(job.steps?.script?.scenes)
      ? (job.steps!.script!.scenes as Array<{ sceneNumber?: number; videoPrompt?: string; description?: string }>)
      : [];
    const cues = job.steps?.voiceover?.captions as CaptionCue[] | undefined;
    const total = narrationSeconds(cues, plan.seconds);
    const slots = planSlots(
      scenes.map((sc, i) => ({
        sceneNumber: sc.sceneNumber ?? i + 1,
        videoPrompt: String(sc.videoPrompt ?? ""),
        description: sc.description,
      })),
      total,
      plan.slots,
      plan.klingSlots
    );
    if (!slots.length) throw new Error("No scene prompts available for the video.");

    const aspectRatio: "9:16" | "16:9" = orientationOf(job) === "vertical" ? "9:16" : "16:9";
    // Image→video clips are started later, once their still exists (poll).
    const textClips = clipModeOf(job) === "text";
    for (const slot of slots) {
      if (slot.kind !== "kling" || !textClips) continue;
      try {
        slot.taskId = await providers.submitTextToVideo({
          prompt: clipPrompt(slot.prompt, visualStyleOf(job)),
          duration: String(VIDEO_CLIP_SECONDS) as "5" | "10",
          aspectRatio,
          mode: "std",
        });
        slot.status = "processing";
      } catch (err) {
        slot.status = "failed";
        slot.refunded = true; // refunded just below
        slot.error = err instanceof Error ? err.message : "Submit failed";
        await logUsage(job, "video", {
          unit: "seconds",
          quantity: VIDEO_CLIP_SECONDS,
          durationMs: 0,
          status: "failed",
          error: slot.error,
        });
      }
    }

    // Stills: one image per SLOT (a scene spanning several slots gets a
    // different angle in each), so no visual ever repeats back-to-back.
    const klingFailed = slots.filter((s) => s.kind === "kling" && s.status === "failed").length;
    await refundVisuals(job, klingFailed, 0);

    await patchStep(job, "video", {
      slots,
      total_seconds: total,
      stills: {},
      submitted_at: new Date(now()).toISOString(),
      last_polled_at: new Date(now()).toISOString(),
    });
  }

  /**
   * Later runs: poll Kling slots, generate a few stills, settle when every
   * slot is done. Returns true once settled.
   */
  async function pollFullVideoVisuals(job: JobRow): Promise<boolean> {
    const slots = (job.steps?.video?.slots as TimelineSlot[] | undefined) ?? [];
    const stills = { ...((job.steps?.video?.stills as Record<string, string> | undefined) ?? {}) };
    let changed = false;

    // 1) Kling polls.
    for (const slot of slots) {
      if (slot.kind !== "kling" || slot.status !== "processing" || (!slot.taskId && !slot.fal)) continue;
      let result: KlingTaskResult;
      try {
        if (slot.fal) {
          const r = await providers.getImageToVideo(slot.fal);
          result = { taskId: slot.fal.requestId, status: r.status, videoUrl: r.videoUrl, durationSeconds: r.durationSeconds, statusMessage: r.statusMessage } as KlingTaskResult;
        } else {
          result = await providers.getTextToVideoTask(slot.taskId!);
        }
      } catch (err) {
        console.error(`[pipeline] ${job.id} poll ${slot.taskId ?? slot.fal?.requestId} failed:`, err);
        continue;
      }
      // A clip stuck in the provider's queue must not hold the whole video
      // hostage: give it up, refund it, and fill the slot (its own still for
      // image→video, else a neighbour).
      const clipAge = slot.submittedAt ? now() - Date.parse(slot.submittedAt) : submittedAgoMs(job);
      if (result.status !== "succeed" && result.status !== "failed" && clipAge > KLING_CLIP_TIMEOUT_MS) {
        result = { ...result, status: "failed", statusMessage: `Clip took longer than ${Math.round(KLING_CLIP_TIMEOUT_MS / 60000)} minutes` };
      }
      const clipUsageKey = slot.fal ? `fal:${process.env.FAL_VIDEO_MODEL || "fal-ai/bytedance/seedance/v1.5/pro/image-to-video"}` : undefined;
      if (result.status === "failed") {
        slot.status = "failed";
        slot.error = result.statusMessage ?? "Provider reported failure";
        changed = true;
        await logUsage(job, "video", {
          usageKey: clipUsageKey,
          unit: "seconds",
          quantity: VIDEO_CLIP_SECONDS,
          durationMs: submittedAgoMs(job),
          status: "failed",
          error: slot.error,
        });
      } else if (result.status === "succeed" && result.videoUrl) {
        await logUsage(job, "video", {
          usageKey: clipUsageKey,
          unit: "seconds",
          quantity: result.durationSeconds ?? VIDEO_CLIP_SECONDS,
          durationMs: submittedAgoMs(job),
          status: "ok",
        });
        try {
          const buffer = await providers.downloadVideo(result.videoUrl);
          const storagePath = `${job.user_id}/${job.id}/slot-${slot.index}.mp4`;
          const { error: uploadError } = await db.storage
            .from("videos")
            .upload(storagePath, buffer, { contentType: "video/mp4", upsert: true });
          if (uploadError) throw new Error(uploadError.message);
          const { data: urlData } = db.storage.from("videos").getPublicUrl(storagePath);
          slot.url = urlData.publicUrl;
          slot.storage_path = storagePath;
          slot.sourceSeconds = result.durationSeconds ?? VIDEO_CLIP_SECONDS;
          slot.status = "succeed";
        } catch (err) {
          slot.status = "failed";
          slot.error = err instanceof Error ? err.message : "Store failed";
        }
        changed = true;
      }
    }

    // 2) Image→video clips: draw the slot's still, then hand it to the video
    // model. Clips go first (they take longest); they share the per-poll
    // image budget with plain stills.
    let generated = 0;
    if (clipModeOf(job) === "image") {
      const aspectRatio: "9:16" | "16:9" = orientationOf(job) === "vertical" ? "9:16" : "16:9";
      for (const slot of slots) {
        if (slot.kind !== "kling" || slot.status !== "pending") continue;
        if (generated >= STILLS_PER_POLL) break;
        generated += 1;
        changed = true;
        const startedAt = now();
        try {
          const img = await providers.generateSceneImage(slot.prompt, job.id, job.user_id, slot.index + 1, orientationOf(job), visualStyleOf(job));
          slot.imageUrl = img.imageUrl;
          await logUsage(job, "thumbnail", {
            usageKey: `gemini:${process.env.GEMINI_SCENE_IMAGE_MODEL || "gemini-nano-banana-2.1"}`,
            unit: "images",
            quantity: 1,
            durationMs: now() - startedAt,
            status: "ok",
          });
        } catch (err) {
          slot.status = "failed";
          slot.error = err instanceof Error ? err.message : "Image failed";
          continue;
        }
        try {
          slot.fal = await providers.submitImageToVideo({ prompt: clipPrompt(slot.prompt, visualStyleOf(job)), imageUrl: slot.imageUrl, aspectRatio });
          slot.submittedAt = new Date(now()).toISOString();
          slot.status = "processing";
        } catch (err) {
          // Keep the still as this slot's visual; the clip credits are refunded at settle.
          slot.status = "failed";
          slot.error = err instanceof Error ? err.message : "Submit failed";
        }
      }
    }

    // 3) Stills: a few per invocation, one image per slot. Slots that share a
    // scene get a varied camera angle so the picture visibly changes.
    const ANGLES = ["wide establishing shot", "close-up detail", "low angle", "over-the-shoulder view", "aerial view", "dramatic side light"];
    for (const slot of slots) {
      if (slot.kind !== "still" || slot.status !== "pending") continue;
      const key = `slot-${slot.index}`;
      if (generated >= STILLS_PER_POLL) continue;
      generated += 1;
      const startedAt = now();
      try {
        const sameScene = slots.filter((s) => s.kind === "still" && s.sceneNumber === slot.sceneNumber);
        const variant = sameScene.findIndex((s) => s.index === slot.index);
        const prompt = sameScene.length > 1 ? `${slot.prompt} (${ANGLES[variant % ANGLES.length]})` : slot.prompt;
        const img = await providers.generateSceneImage(
          prompt,
          job.id,
          job.user_id,
          slot.index + 1,
          orientationOf(job),
          visualStyleOf(job)
        );
        stills[key] = img.imageUrl;
        slot.url = img.imageUrl;
        slot.storage_path = img.storagePath;
        slot.status = "succeed";
        await logUsage(job, "thumbnail", {
          usageKey: `gemini:${process.env.GEMINI_SCENE_IMAGE_MODEL || "gemini-nano-banana-2.1"}`,
          unit: "images",
          quantity: 1,
          durationMs: now() - startedAt,
          status: "ok",
        });
      } catch (err) {
        slot.status = "failed";
        slot.error = err instanceof Error ? err.message : "Image failed";
        await logUsage(job, "thumbnail", {
          unit: "images",
          quantity: 1,
          durationMs: now() - startedAt,
          status: "failed",
          error: slot.error,
        });
      }
      changed = true;
    }

    const settled = slots.every((s) => s.status === "succeed" || s.status === "failed");
    const patch: Record<string, unknown> = { last_polled_at: new Date(now()).toISOString() };
    if (changed) {
      patch.slots = slots;
      patch.stills = stills;
    }
    if (settled) {
      const ok = slots.filter((s) => s.status === "succeed").length;
      if (ok === 0) {
        await patchStep(job, "video", patch);
        throw new Error(`No visuals could be generated: ${slots[0]?.error ?? "unknown error"}`);
      }
      // Clips that failed after submission (or, for image→video, at any
      // point) get their credits back now — once per slot.
      const imageClips = clipModeOf(job) === "image";
      const lateFailed = slots.filter(
        (s) => s.kind === "kling" && s.status === "failed" && !s.refunded && (imageClips || s.taskId)
      );
      lateFailed.forEach((s) => (s.refunded = true));
      patch.slots = slots;
      await refundVisuals(job, lateFailed.length, 0);
      patch.status = "completed";
    }
    await patchStep(job, "video", patch);
    return settled;
  }

  /* ---------------- Full video: render (async) ---------------- */

  /** Copy a music track into `videos/music/<id>.mp3` if it is not there yet; return our public URL. */
  async function ensureMusicCached(track: MusicTrack): Promise<string> {
    const path = `music/${track.id}.mp3`;
    const publicUrl = db.storage.from("videos").getPublicUrl(path).data.publicUrl;
    const { data: existing } = await db.storage.from("videos").list("music", { search: `${track.id}.mp3`, limit: 1 });
    if (existing?.some((f) => f.name === `${track.id}.mp3`)) return publicUrl;
    const res = await fetch(track.sourceUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`music download failed (HTTP ${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const { error } = await db.storage.from("videos").upload(path, buffer, { contentType: "audio/mpeg", upsert: true });
    if (error) throw new Error(`music upload failed: ${error.message}`);
    return publicUrl;
  }

  async function submitRenderJob(job: JobRow): Promise<void> {
    const slots = (job.steps?.video?.slots as TimelineSlot[] | undefined) ?? [];
    const voiceoverUrl = job.steps?.voiceover?.audio_url;
    if (typeof voiceoverUrl !== "string" || !voiceoverUrl) throw new Error("Voiceover is missing; cannot render.");
    const total = Number(job.steps?.video?.total_seconds) || (job.steps?.render?.plan as { seconds?: number } | undefined)?.seconds || 60;

    // Subtitles: upload the SRT so Shotstack can fetch it.
    let subtitlesUrl: string | undefined;
    const cues = job.steps?.voiceover?.captions as CaptionCue[] | undefined;
    if (cues?.length) {
      const path = `${job.user_id}/${job.id}/captions.srt`;
      const { error } = await db.storage
        .from("videos")
        // Burned-in captions are uppercase; do it here with the output
        // language's rules (Turkish İ/ı) — the renderer's textTransform is
        // locale-blind and turned "piramidi" into "PIRAMIDI".
        .upload(
          path,
          Buffer.from(
            cuesToSrt(cues, captionStyle(job.options?.captionStyle).uppercase ? { uppercase: languageCode(job.output_language ?? "English") } : {}),
            "utf8"
          ),
          { contentType: "application/x-subrip", upsert: true }
        );
      if (error) {
        console.warn(`[pipeline] ${job.id} srt upload failed, rendering without subtitles:`, error.message);
      } else {
        subtitlesUrl = db.storage.from("videos").getPublicUrl(path).data.publicUrl;
      }
    }

    // Background music: mirror the CC BY track into our bucket once, then
    // reference our copy (no dependency on the source host at render time).
    const music = pickMusicTrack(job.style, job.id, {
      mood: job.steps?.script?.music_mood,
      trackId: job.steps?.render?.music_id,
    });
    let musicUrl: string | undefined;
    try {
      musicUrl = await ensureMusicCached(music);
    } catch (err) {
      console.warn(`[pipeline] ${job.id} music unavailable, rendering without it:`, err instanceof Error ? err.message : err);
    }

    // Free trial: "Made with Norveko" badge on the video (removed by a re-render after purchase).
    const watermarked = Boolean(providers.needsWatermark && (await providers.needsWatermark(job.user_id)));
    const edit = buildEdit({
      watermarkUrl: watermarked ? `${getBaseUrl()}${WATERMARK_PUBLIC_PATH}` : undefined,
      slots,
      voiceoverUrl,
      subtitlesUrl,
      musicUrl,
      orientation: orientationOf(job),
      totalSeconds: total,
      fallbackImageUrl: typeof job.steps?.thumbnail?.image_url === "string" ? job.steps.thumbnail.image_url : undefined,
      hookText: typeof job.steps?.script?.hook === "string" ? job.steps.script.hook : undefined,
      languageCode: languageCode(job.output_language ?? "English"),
      captionStyle: job.options?.captionStyle ?? undefined,
    });

    const renderId = await providers.submitRender(edit);
    await patchStep(job, "render", {
      render_id: renderId,
      watermarked,
      subtitles_url: subtitlesUrl,
      music: musicUrl ? { id: music.id, title: music.title, mood: music.mood, credit: musicCredit(music) } : null,
      total_seconds: total,
      submitted_at: new Date(now()).toISOString(),
      last_polled_at: new Date(now()).toISOString(),
    });
  }

  async function pollRenderJob(job: JobRow): Promise<boolean> {
    const renderId = job.steps?.render?.render_id;
    if (typeof renderId !== "string" || !renderId) throw new Error("Render id is missing.");
    const result = await providers.getRender(renderId);
    const patch: Record<string, unknown> = {
      last_polled_at: new Date(now()).toISOString(),
      provider_status: result.status,
    };
    if (result.status === "failed") {
      await patchStep(job, "render", patch);
      await logUsage(job, "render", {
        unit: "seconds",
        quantity: Number(job.steps?.render?.total_seconds) || 0,
        durationMs: submittedAgoMs(job),
        status: "failed",
        error: result.error ?? "Render failed",
      });
      throw new Error(`Final video render failed: ${result.error ?? "provider error"}`);
    }
    if (result.status !== "done" || !result.url) {
      await patchStep(job, "render", patch);
      return false;
    }
    const buffer = await providers.downloadRender(result.url);
    // Re-renders (e.g. different music) get a new file name so CDN caches and
    // the original never serve a stale video.
    const version = Number(job.steps?.render?.version) || 0;
    const storagePath = `${job.user_id}/${job.id}/final${version ? `-v${version}` : ""}.mp4`;
    const { error: uploadError } = await db.storage
      .from("videos")
      .upload(storagePath, buffer, { contentType: "video/mp4", upsert: true });
    let finalUrl: string;
    let hostedBy: "supabase" | "shotstack" = "supabase";
    if (uploadError) {
      // Too large for our bucket (Supabase free plan caps objects at 50 MB):
      // deliver the provider-hosted file instead of failing a finished render.
      // Shotstack keeps renders for ~24 h, so the UI warns the user to download.
      console.warn(`[pipeline] ${job.id} final upload failed (${uploadError.message}); using provider URL`);
      await captureError(new Error(`Final video upload failed: ${uploadError.message}`), {
        jobId: job.id,
        step: "render",
        area: "pipeline.render.upload",
        bytes: buffer.byteLength,
      });
      finalUrl = result.url;
      hostedBy = "shotstack";
    } else {
      finalUrl = db.storage.from("videos").getPublicUrl(storagePath).data.publicUrl;
    }
    await logUsage(job, "render", {
      unit: "seconds",
      quantity: result.duration ?? Number(job.steps?.render?.total_seconds) ?? 0,
      durationMs: submittedAgoMs(job),
      status: "ok",
    });
    await patchStep(job, "render", {
      ...patch,
      status: "completed",
      video_url: finalUrl,
      storage_path: hostedBy === "supabase" ? storagePath : undefined,
      provider_url: result.url,
      hosted_by: hostedBy,
      bytes: buffer.byteLength,
    });
    return true;
  }

  /** Poll whichever async step is in flight. */
  async function pollAsyncStep(job: JobRow, stepId: PipelineStepId): Promise<boolean> {
    if (stepId === "render") return pollRenderJob(job);
    return isFullVideo(job) ? pollFullVideoVisuals(job) : pollVideoTasks(job);
  }

  async function executeStep(job: JobRow, stepId: PipelineStepId): Promise<void> {
    if (stepId === "research") {
      const model = RESEARCH_MODEL;
      const startedAt = now();
      let result: Awaited<ReturnType<typeof providers.researchTopic>>;
      try {
        result = await providers.researchTopic({
          idea: job.idea,
          outputLanguage: job.output_language ?? "EN",
          model,
          today: new Date(now()).toISOString().slice(0, 10),
          notes: job.options?.notes ?? null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logUsage(job, "research", {
          unit: "tokens",
          quantity: 0,
          durationMs: now() - startedAt,
          status: "failed",
          error: message,
        });
        // Research is a nice-to-have: skip it, give the credits back and let
        // the script run on the model's own knowledge.
        await skipResearch(job, message);
        return;
      }
      await logUsage(job, "research", {
        unit: "tokens",
        quantity: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        durationMs: now() - startedAt,
        status: "ok",
      });
      await patchStep(job, "research", {
        status: "completed",
        brief: result.brief,
        sources: result.sources,
      });
      return;
    }

    if (stepId === "script") {
      const model = SCRIPT_MODEL;
      const orientation = job.options?.orientation ?? defaultOrientation(job.platform ?? "");
      const startedAt = now();
      let result: Awaited<ReturnType<typeof providers.generateScript>>;
      try {
        result = await providers.generateScript({
          idea: job.idea,
          platform: job.platform ?? "youtube",
          style: job.style,
          duration: job.duration,
          outputLanguage: job.output_language ?? "EN",
          model,
          orientation,
          brief: getTemplate(job.options?.template)?.brief ?? null,
          research: typeof job.steps?.research?.brief === "string" ? (job.steps.research.brief as string) : null,
          notes: job.options?.notes ?? null,
          visualStyle: visualStyleOf(job),
        });
      } catch (err) {
        await logUsage(job, "script", {
          usageKey: llmUsageKey(model),
          unit: "tokens",
          quantity: 0,
          durationMs: now() - startedAt,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      await logUsage(job, "script", {
        usageKey: result.usageKey ?? llmUsageKey(model),
        unit: "tokens",
        quantity: (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0),
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        durationMs: now() - startedAt,
        status: "ok",
      });
      await patchStep(job, "script", {
        status: "completed",
        hook: result.hook,
        script: result.script,
        scenes: result.scenes,
        titles: result.titles,
        description: result.description,
        tags: result.tags,
        thumbnailIdea: result.thumbnailIdea,
        thumbnailPrompt: result.thumbnailPrompt,
        model: llmUsageKey(model),
        prompt_version: result.promptVersion ?? null,
        plan: result.plan ?? null,
        fact_check: result.factCheck ?? null,
        music_mood: result.musicMood ?? null,
      });
      return;
    }

    if (stepId === "voiceover") {
      const scriptRaw = job.steps?.script?.script;
      const voiceId = job.steps?.voiceover?.voice_id;
      if (typeof scriptRaw !== "string" || !scriptRaw) {
        throw new Error("Script is missing; cannot generate voiceover.");
      }
      let script: string = scriptRaw;
      if (typeof voiceId !== "string" || !voiceId) {
        throw new Error("Voice is missing; cannot generate voiceover.");
      }
      const voiceUsageKey = voiceId.startsWith("gemini:")
        ? `gemini:${process.env.GEMINI_TTS_MODEL || "gemini-2.5-pro-preview-tts"}`
        : "elevenlabs:eleven_multilingual_v2";

      const startedAt = now();
      let speech: Awaited<ReturnType<typeof providers.generateSpeech>>;
      try {
        speech = await providers.generateSpeech(script, voiceId);
      } catch (err) {
        await logUsage(job, "voiceover", { usageKey: voiceUsageKey,
          unit: "characters",
          quantity: script.length,
          durationMs: now() - startedAt,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      await logUsage(job, "voiceover", { usageKey: voiceUsageKey,
        unit: "characters",
        quantity: script.length,
        durationMs: now() - startedAt,
        status: "ok",
      });

      // Full videos must hit the chosen duration. Speaking rate varies ±20%
      // with the text, so measure the first take and, if it misses the target
      // by more than 10%, re-synthesise once with ElevenLabs' speed setting
      // (0.7–1.2). Costs one extra TTS call only when needed.
      let speed = 1;
      let rewritten = false;
      const targetSeconds = Number((job.steps?.render?.plan as { seconds?: number } | undefined)?.seconds);
      let measured = spokenSeconds(speech.alignment);
      if (isFullVideo(job) && targetSeconds > 0 && measured > 0) {
        let ratio = measured / targetSeconds;

        // Way off (>15 %): the text itself is the wrong length for this
        // language/voice. Rewrite it to the word count the measured rate
        // implies, re-synthesise, then fall through to the gentle speed fix.
        if (ratio > 1.15 || ratio < 0.85) {
          const hook = typeof job.steps?.script?.hook === "string" ? job.steps.script.hook : "";
          const count = narrationWordCount("", script);
          const range = rangeForMeasuredRatio(count, ratio, targetSeconds);
          const model = SCRIPT_MODEL;
          const rewriteAt = now();
          try {
            const fixed = await providers.reviseNarration({
              hook,
              script,
              range,
              outputLanguage: job.output_language ?? "EN",
              model,
              count,
            });
            if (fixed?.script?.trim()) {
              const retake = await providers.generateSpeech(fixed.script, voiceId);
              await logUsage(job, "voiceover", { usageKey: voiceUsageKey, unit: "characters", quantity: fixed.script.length, durationMs: now() - rewriteAt, status: "ok" });
              if (retake.alignment) {
                script = fixed.script;
                speech = retake;
                rewritten = true;
                measured = spokenSeconds(retake.alignment) || measured;
                ratio = measured / targetSeconds;
                await patchStep(job, "script", { hook: fixed.hook || hook, script: fixed.script, length_fixed_from_words: count });
              }
            }
          } catch (err) {
            console.warn(`[pipeline] ${job.id} length rewrite failed, keeping first take:`, err);
          }
        }

        if (ratio < 0.9 || ratio > 1.1) {
          // Cap the correction at ±12 %: beyond that the delivery sounds
          // rushed/dragged, and the timeline follows the real length anyway.
          const wanted = Math.min(1.12, Math.max(0.88, Math.round(ratio * 100) / 100));
          const retryAt = now();
          try {
            const retake = await providers.generateSpeech(script, voiceId, { speed: wanted });
            if (retake.alignment) {
              speech = retake;
              speed = wanted;
            }
            await logUsage(job, "voiceover", { usageKey: voiceUsageKey,
              unit: "characters",
              quantity: script.length,
              durationMs: now() - retryAt,
              status: "ok",
            });
          } catch (err) {
            console.warn(`[pipeline] ${job.id} speed retake failed, keeping first take:`, err);
          }
        }
      }
      const ext = speech.ext ?? "mp3";
      const storagePath = `${job.user_id}/${job.id}.${ext}`;
      const { error: uploadError } = await db.storage
        .from("voiceovers")
        .upload(storagePath, speech.audio, {
          contentType: speech.contentType ?? "audio/mpeg",
          upsert: true,
        });
      if (uploadError) {
        throw new Error(`Voiceover upload failed: ${uploadError.message}`);
      }
      const { data: urlData } = db.storage
        .from("voiceovers")
        .getPublicUrl(storagePath);

      // Word-timed subtitles (paid add-on, see SUBTITLES_CREDITS) from the
      // same TTS call. Kept compact: cues only, not the character alignment.
      const wantsSubtitles = job.steps?.voiceover?.subtitles === true;
      const captions = wantsSubtitles && speech.alignment ? alignmentToCues(speech.alignment) : undefined;
      await patchStep(job, "voiceover", {
        status: "completed",
        rewritten_for_length: rewritten || undefined,
        audio_url: urlData.publicUrl,
        storage_path: storagePath,
        speed,
        duration_seconds: spokenSeconds(speech.alignment) || undefined,
        ...(captions ? { captions } : {}),
      });
      return;
    }

    if (stepId === "video") {
      // Async: submitting is the whole first invocation; polling happens later.
      if (isFullVideo(job)) await submitFullVideoVisuals(job);
      else await submitVideoTasks(job);
      return;
    }

    if (stepId === "render") {
      await submitRenderJob(job);
      return;
    }

    if (stepId === "thumbnail") {
      const idea = job.steps?.script?.thumbnailIdea;
      if (typeof idea !== "string" || !idea) {
        throw new Error("Thumbnail idea is missing; cannot generate thumbnail.");
      }
      const orientation = job.options?.orientation ?? defaultOrientation(job.platform ?? "");
      const startedAt = now();
      let result: Awaited<ReturnType<typeof providers.generateThumbnail>>;
      try {
        result = await providers.generateThumbnail(idea, job.id, orientation, visualStyleOf(job));
      } catch (err) {
        await logUsage(job, "thumbnail", {
          unit: "images",
          quantity: 1,
          durationMs: now() - startedAt,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      await logUsage(job, "thumbnail", {
        unit: "images",
        quantity: 1,
        durationMs: now() - startedAt,
        status: "ok",
      });
      // Free trial: badge the thumbnail, keep the clean copy for after the first purchase.
      let watermark: { watermarked: boolean; clean_url?: string; clean_path?: string } = { watermarked: false };
      if (providers.needsWatermark && providers.watermarkThumbnail && (await providers.needsWatermark(job.user_id))) {
        try {
          const clean = await providers.watermarkThumbnail({ storagePath: result.storagePath, jobId: job.id, baseUrl: getBaseUrl() });
          watermark = { watermarked: true, clean_url: clean.cleanUrl, clean_path: clean.cleanPath };
        } catch (err) {
          console.warn(`[pipeline] ${job.id} thumbnail watermark failed, delivering it clean:`, err);
          await captureError(err, { jobId: job.id, step: "thumbnail", area: "pipeline.watermark" });
        }
      }
      await patchStep(job, "thumbnail", {
        status: "completed",
        image_url: result.imageUrl,
        storage_path: result.storagePath,
        ...watermark,
      });
      return;
    }

    throw new Error(`Unknown pipeline step: ${stepId}`);
  }

  /** Free-trial watermark state for projects.content (server-owned keys). */
  function projectWatermark(fresh: JobRow): { watermarked?: boolean; cleanAssets?: { thumbnailUrl?: string } } {
    const thumbMarked = fresh.steps?.thumbnail?.watermarked === true;
    const videoMarked = fresh.steps?.render?.watermarked === true;
    if (!thumbMarked && !videoMarked) return { watermarked: false };
    return {
      watermarked: true,
      cleanAssets: thumbMarked ? { thumbnailUrl: fresh.steps?.thumbnail?.clean_url as string | undefined } : undefined,
    };
  }

  /** After a re-render: point the project at the new MP4 and the new music credit. */
  async function refreshProjectVideo(fresh: JobRow, projectId: string): Promise<string | null> {
    const { data: project } = await db.from("projects").select("content").eq("id", projectId).maybeSingle();
    if (!project) return saveProject(fresh);
    const finalVideoUrl =
      typeof fresh.steps?.render?.video_url === "string" ? (fresh.steps.render.video_url as string) : undefined;
    const content = {
      ...((project.content ?? {}) as Record<string, unknown>),
      finalVideoUrl,
      description: withMusicCredit(fresh.steps?.script?.description, fresh.steps?.render?.music),
      // A clean re-render after the first purchase clears the badge.
      ...(fresh.steps?.render?.watermarked === true ? {} : { watermarked: fresh.steps?.thumbnail?.watermarked === true }),
    };
    const { error } = await db.from("projects").update({ content }).eq("id", projectId);
    if (error) console.error(`[pipeline] ${fresh.id} project refresh failed:`, error.message);
    return projectId;
  }

  /** Save the finished package as a project and mark the job completed. */
  /** Insert a project from whatever the job has produced. Returns its id. */
  async function saveProject(fresh: JobRow): Promise<string | null> {
    const script = fresh.steps?.script ?? {};
    const thumb = fresh.steps?.thumbnail ?? {};
    const voice = fresh.steps?.voiceover ?? {};
    const voiceoverUrl = typeof voice.audio_url === "string" ? voice.audio_url : "";
    const captions = Array.isArray(voice.captions) && voice.captions.length ? voice.captions : undefined;
    const finalVideoUrl =
      typeof fresh.steps?.render?.video_url === "string" ? (fresh.steps.render.video_url as string) : undefined;
    const research =
      typeof fresh.steps?.research?.brief === "string"
        ? { brief: fresh.steps.research.brief as string, sources: (fresh.steps.research.sources as unknown[]) ?? [] }
        : undefined;
    const clips = (fresh.steps?.video?.clips as VideoClipState[] | undefined) ?? [];
    const scenes = Array.isArray(script.scenes)
      ? (script.scenes as Array<Record<string, unknown> & { sceneNumber?: number }>).map((scene) => {
          const clip = clips.find((c) => c.sceneNumber === scene.sceneNumber && c.status === "succeed");
          return clip ? { ...scene, videoUrl: clip.video_url, videoDuration: clip.duration } : scene;
        })
      : script.scenes;

    try {
      const { data: project, error } = await db
        .from("projects")
        .insert({
          user_id: fresh.user_id,
          title: projectTitle(script.titles, fresh.idea),
          platform: fresh.platform ?? "youtube",
          style: fresh.style,
          duration: fresh.duration,
          idea: fresh.idea,
          status: "draft",
          content: {
            hook: script.hook,
            script: script.script,
            scenes,
            titles: script.titles,
            description: withMusicCredit(script.description, fresh.steps?.render?.music),
            tags: script.tags,
            thumbnailIdea: script.thumbnailIdea,
            thumbnailUrl: thumb.image_url,
            voiceoverUrl: voiceoverUrl || undefined,
            audio_url: voiceoverUrl || undefined,
            captions,
            finalVideoUrl,
            research,
            ...projectWatermark(fresh),
            scriptMeta: {
              model: typeof script.model === "string" ? script.model : undefined,
              promptVersion: typeof script.prompt_version === "string" ? script.prompt_version : undefined,
              factCheckIssues: Array.isArray((script.fact_check as { issues?: unknown[] } | undefined)?.issues)
                ? (script.fact_check as { issues: unknown[] }).issues.length
                : undefined,
            },
          },
        })
        .select("id")
        .single();
      if (error) {
        console.error(`[pipeline] ${fresh.id} project insert failed:`, error.message);
        return null;
      }
      return project?.id ?? null;
    } catch (err) {
      console.error(`[pipeline] ${fresh.id} project save exception:`, err);
      return null;
    }
  }

  /** Save the finished package as a project and mark the job completed. */
  async function finalizeJob(job: JobRow): Promise<void> {
    const fresh = (await loadJob(job.id)) ?? job;
    // A re-render of an already finished job updates its project in place.
    const existingProject = (fresh.steps?.result as { project_id?: unknown } | undefined)?.project_id;
    const projectId =
      typeof existingProject === "string" && existingProject
        ? await refreshProjectVideo(fresh, existingProject)
        : await saveProject(fresh);
    const steps = { ...(fresh.steps ?? {}) };
    if (projectId) {
      steps.result = { status: "completed", project_id: projectId };
    }
    await db
      .from("pipeline_jobs")
      .update({ status: "completed", current_step: null, steps })
      .eq("id", fresh.id)
      .eq("status", "running");
    if (deps.afterComplete) {
      try {
        await deps.afterComplete(fresh.id);
      } catch (err) {
        console.error(`[pipeline] ${fresh.id} afterComplete failed:`, err);
      }
    }
  }

  /**
   * Execute the job's next pending step.
   *   "advanced"  - a step ran and another is waiting (caller should kick)
   *   "completed" - the whole pipeline finished
   *   "noop"      - nothing to do (claimed elsewhere, or job not running)
   *   "failed"    - the step threw; job has been failed and refunded
   */
  async function runNextStep(jobId: string): Promise<RunOutcome> {
    const job = await loadJob(jobId);
    if (!job || job.status !== "running") return "noop";

    const order = stepOrder(job);

    // An async step in flight: poll it instead of looking for pending work.
    const inFlight = order.find(
      (id) => job.steps?.[id]?.status === "running" && getPipelineStepDefinition(id).async
    );
    if (inFlight) {
      try {
        const settled = await pollAsyncStep(job, inFlight);
        if (!settled) return "noop";
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[pipeline] ${jobId} step ${inFlight} failed:`, message);
        await captureError(err, { jobId, step: inFlight, area: "pipeline" });
        try {
          await patchStep(job, inFlight, { status: "failed", error: message });
        } catch {
          // best effort
        }
        await failJob(jobId, message);
        return "failed";
      }
      const after = nextStep(inFlight, optionsFromSteps(job.steps));
      if (after) {
        await patchStep(job, after.id, { queued_at: new Date(now()).toISOString() });
        await db.from("pipeline_jobs").update({ current_step: after.id }).eq("id", jobId);
        return "advanced";
      }
      await finalizeJob(job);
      return "completed";
    }

    const stepId = order.find((id) => (job.steps?.[id]?.status ?? "pending") === "pending");

    if (!stepId) {
      if (order.every((id) => isDone(job.steps?.[id]?.status))) {
        await finalizeJob(job);
        return "completed";
      }
      return "noop";
    }

    // Steps run strictly in order: wait while an earlier one is still running.
    const idx = order.indexOf(stepId);
    if (idx > 0 && !isDone(job.steps?.[order[idx - 1]]?.status)) {
      return "noop";
    }

    const claimed = await claimStep(job, stepId);
    if (!claimed) return "noop";

    try {
      await executeStep(claimed, stepId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[pipeline] ${jobId} step ${stepId} failed:`, message);
      await captureError(err, { jobId, step: stepId, area: "pipeline" });
      try {
        await patchStep(claimed, stepId, { status: "failed", error: message });
      } catch {
        // best effort
      }
      await failJob(jobId, message);
      return "failed";
    }

    if (getPipelineStepDefinition(stepId).async) {
      // Submitted; completion arrives through later polls (status endpoint / cron).
      return "advanced";
    }

    const next = nextStep(stepId, optionsFromSteps(claimed.steps));
    if (next) {
      await patchStep(claimed, next.id, { queued_at: new Date(now()).toISOString() });
      await db
        .from("pipeline_jobs")
        .update({ current_step: next.id })
        .eq("id", jobId);
      return "advanced";
    }

    await finalizeJob(claimed);
    return "completed";
  }

  /**
   * Inspect a running job: fail+refund it when a step has been running too
   * long, or re-kick it when a pending step was never picked up.
   */
  async function reconcileJob(
    job: Pick<JobRow, "id" | "status" | "steps" | "created_at">
  ): Promise<ReconcileAction> {
    if (job.status !== "running") return "ok";

    const current = now();
    const steps = job.steps ?? {};
    const order = stepOrder(job);

    const runningId = order.find((id) => steps[id]?.status === "running");
    if (runningId) {
      const isAsync = Boolean(getPipelineStepDefinition(runningId).async);
      const started = Date.parse(steps[runningId]?.started_at ?? job.created_at);
      if (runningId === "research" && current - started > RESEARCH_STEP_TIMEOUT_MS) {
        // The worker died mid-search (function time limit). Research is
        // optional, so skip + refund it and move the job on.
        const full = await loadJob(job.id);
        if (full) {
          await skipResearch(full, "Web research took too long and was skipped.");
          const next = nextStep("research", optionsFromSteps(full.steps));
          if (next) {
            const fresh = await loadJob(job.id);
            if (fresh) await patchStep(fresh, next.id, { queued_at: new Date(current).toISOString() });
            await db.from("pipeline_jobs").update({ current_step: next.id }).eq("id", job.id);
          }
          await kick(job.id);
          return "kicked";
        }
      }
      if (current - started > (isAsync ? ASYNC_STEP_TIMEOUT_MS : STEP_TIMEOUT_MS)) {
        await failJob(job.id, `Step "${runningId}" timed out.`);
        return "failed";
      }
      if (isAsync && steps[runningId]?.submitted_at) {
        const lastPolled = Date.parse(String(steps[runningId]?.last_polled_at ?? 0));
        if (current - lastPolled > ASYNC_POLL_INTERVAL_MS) {
          const patched = {
            ...steps,
            [runningId]: { ...steps[runningId], last_polled_at: new Date(current).toISOString() },
          };
          await db.from("pipeline_jobs").update({ steps: patched }).eq("id", job.id);
          await kick(job.id);
          return "kicked";
        }
      }
      return "ok";
    }

    const pendingId = order.find((id) => (steps[id]?.status ?? "pending") === "pending");
    if (pendingId) {
      const queued = Date.parse(steps[pendingId]?.queued_at ?? job.created_at);
      if (current - queued > KICK_RETRY_MS) {
        // Reset the queue timestamp so we don't kick on every poll.
        const patched = {
          ...steps,
          [pendingId]: { ...steps[pendingId], queued_at: new Date(current).toISOString() },
        };
        await db.from("pipeline_jobs").update({ steps: patched }).eq("id", job.id);
        await kick(job.id);
        return "kicked";
      }
    }
    return "ok";
  }

  /** Cron entry point: reconcile every running job. */
  async function reapStuckJobs(): Promise<{ checked: number; failed: number; kicked: number }> {
    const { data } = await db
      .from("pipeline_jobs")
      .select("id, status, steps, created_at")
      .eq("status", "running")
      .limit(200);

    const summary = { checked: 0, failed: 0, kicked: 0 };
    for (const job of (data ?? []) as JobRow[]) {
      summary.checked += 1;
      const action = await reconcileJob(job);
      if (action === "failed") summary.failed += 1;
      if (action === "kicked") summary.kicked += 1;
    }
    return summary;
  }

  return { runNextStep, reconcileJob, reapStuckJobs, failJob };
}

/* ----------------------------------------------------------------------- */
/* Production instance                                                      */
/* ----------------------------------------------------------------------- */

let productionRunner: ReturnType<typeof createPipelineRunner> | null = null;
let productionClient: SupabaseClient | null = null;

function productionDb(): SupabaseClient {
  if (!productionClient) {
    productionClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return productionClient;
}

function getRunner() {
  if (!productionRunner) {
    productionRunner = createPipelineRunner({
      db: productionDb(),
      providers: {
        generateScript: async (...args) =>
          (await import("@/lib/pipeline/openai")).generateScript(...args),
        researchTopic: async (...args) =>
          (await import("@/lib/pipeline/openai")).researchTopic(...args),
        reviseNarration: async (...args) =>
          (await import("@/lib/pipeline/openai")).reviseNarrationLength(...args),
        generateSpeech: async (...args) =>
          (await import("@/lib/pipeline/tts")).synthesizeNarration(...args),
        generateThumbnail: async (...args) =>
          (await import("@/lib/pipeline/gemini-image")).generateThumbnail(...args),
        submitTextToVideo: async (...args) =>
          (await import("@/lib/pipeline/kling")).submitTextToVideo(...args),
        getTextToVideoTask: async (...args) =>
          (await import("@/lib/pipeline/kling")).getTextToVideoTask(...args),
        submitImageToVideo: async (...args) =>
          (await import("@/lib/pipeline/fal-video")).submitImageToVideo(...args),
        getImageToVideo: async (...args) =>
          (await import("@/lib/pipeline/fal-video")).getImageToVideo(...args),
        downloadVideo: async (...args) =>
          (await import("@/lib/pipeline/kling")).downloadVideo(...args),
        generateSceneImage: async (...args) =>
          (await import("@/lib/pipeline/gemini-image")).generateSceneImage(...args),
        submitRender: async (...args) =>
          (await import("@/lib/pipeline/shotstack")).submitRender(...args),
        getRender: async (...args) =>
          (await import("@/lib/pipeline/shotstack")).getRender(...args),
        downloadRender: async (...args) =>
          (await import("@/lib/pipeline/shotstack")).downloadRender(...args),
        needsWatermark: async (userId) =>
          (await import("@/lib/pipeline/watermark-policy")).needsWatermark(productionDb(), userId),
        watermarkThumbnail: async (...args) =>
          (await import("@/lib/pipeline/watermark")).watermarkStoredThumbnail(...args),
      },
      kick: kickJob,
      now: Date.now,
      recordUsage: async (record) => {
        await recordProviderUsage(productionDb(), record);
      },
      afterComplete: async (jobId) => {
        await (await import("@/lib/series/run")).onJobCompleted(jobId);
      },
    });
  }
  return productionRunner;
}

export const runNextStep = (jobId: string) => getRunner().runNextStep(jobId);
export const reconcileJob = (job: Pick<JobRow, "id" | "status" | "steps" | "created_at">) =>
  getRunner().reconcileJob(job);
export const reapStuckJobs = () => getRunner().reapStuckJobs();
export const failJob = (jobId: string, message: string) => getRunner().failJob(jobId, message);
