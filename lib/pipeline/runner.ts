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

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildPipelineSteps,
  getPipelineStepDefinition,
  nextStep,
  optionsFromSteps,
  VIDEO_CLIP_CREDITS,
  VIDEO_CLIP_SECONDS,
  VIDEO_MAX_CLIPS,
  type PipelineStepId,
} from "@/lib/pipeline/steps";
import type { KlingTaskResult } from "@/lib/pipeline/kling";

/** A step that has been running longer than this is considered dead. */
export const STEP_TIMEOUT_MS = 8 * 60 * 1000;
/** Async (provider-side) steps may legitimately take much longer. */
export const ASYNC_STEP_TIMEOUT_MS = 40 * 60 * 1000;
/** A pending step that nobody picked up for this long gets re-kicked. */
export const KICK_RETRY_MS = 90 * 1000;
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
  status?: "pending" | "running" | "completed" | "failed";
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
    generateSpeech: typeof import("@/lib/pipeline/elevenlabs").generateSpeech;
    generateThumbnail: typeof import("@/lib/pipeline/gemini-image").generateThumbnail;
    submitTextToVideo: typeof import("@/lib/pipeline/kling").submitTextToVideo;
    getTextToVideoTask: typeof import("@/lib/pipeline/kling").getTextToVideoTask;
    downloadVideo: typeof import("@/lib/pipeline/kling").downloadVideo;
  };
  kick: (jobId: string) => Promise<void>;
  now: () => number;
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

/* ----------------------------------------------------------------------- */
/* Runner factory                                                           */
/* ----------------------------------------------------------------------- */

export function createPipelineRunner(deps: RunnerDeps) {
  const { db, providers, kick, now } = deps;

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
   * update (status = running AND credits_refunded IS NULL) is the guard.
   */
  async function failJob(jobId: string, message: string): Promise<boolean> {
    const { data: claimed } = await db
      .from("pipeline_jobs")
      .update({ status: "failed", error: message })
      .eq("id", jobId)
      .eq("status", "running")
      .is("credits_refunded", null)
      .select("id, user_id, credits_charged")
      .maybeSingle();

    if (!claimed) return false;

    const cost = Number(claimed.credits_charged ?? 0);
    if (cost > 0) {
      const { error } = await db.rpc("add_credits", {
        p_user_id: claimed.user_id,
        p_amount: cost,
        p_type: "refund",
        p_reason: `Refund: pipeline job failed (${message.slice(0, 120)})`,
      });
      if (error) {
        console.error(`[pipeline] refund failed for ${jobId}:`, error);
        return true;
      }
      await db
        .from("pipeline_jobs")
        .update({ credits_refunded: cost })
        .eq("id", jobId);
    }
    return true;
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
    }
  }

  /* ---------------- Video (async) step ---------------- */

  /** First run of the video step: submit one task per scene. */
  async function submitVideoTasks(job: JobRow): Promise<void> {
    const { aspectRatioForPlatform } = await import("@/lib/pipeline/kling");
    const scenes = Array.isArray(job.steps?.script?.scenes)
      ? (job.steps.script.scenes as Array<{ sceneNumber?: number; videoPrompt?: string; description?: string }>)
      : [];
    const usable = scenes
      .filter((s) => typeof s.videoPrompt === "string" && s.videoPrompt.trim())
      .slice(0, VIDEO_MAX_CLIPS);
    if (usable.length === 0) {
      throw new Error("No scene prompts available for video generation.");
    }

    const aspectRatio = aspectRatioForPlatform(job.platform);
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
          prompt,
          duration: String(VIDEO_CLIP_SECONDS) as "5" | "10",
          aspectRatio,
          mode: "std",
        });
        clip.status = "processing";
      } catch (err) {
        clip.status = "failed";
        clip.error = err instanceof Error ? err.message : "Submit failed";
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
      } else if (result.status === "succeed" && result.videoUrl) {
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

  async function executeStep(job: JobRow, stepId: PipelineStepId): Promise<void> {
    const def = getPipelineStepDefinition(stepId);

    if (stepId === "script") {
      const model = def.provider.split(":")[1] ?? "gpt-5-mini";
      const result = await providers.generateScript({
        idea: job.idea,
        platform: job.platform ?? "youtube",
        style: job.style,
        duration: job.duration,
        outputLanguage: job.output_language ?? "EN",
        model,
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
      });
      return;
    }

    if (stepId === "voiceover") {
      const script = job.steps?.script?.script;
      const voiceId = job.steps?.voiceover?.voice_id;
      if (typeof script !== "string" || !script) {
        throw new Error("Script is missing; cannot generate voiceover.");
      }
      if (typeof voiceId !== "string" || !voiceId) {
        throw new Error("Voice is missing; cannot generate voiceover.");
      }

      const speechBuffer = await providers.generateSpeech(script, voiceId);
      const storagePath = `${job.user_id}/${job.id}.mp3`;
      const { error: uploadError } = await db.storage
        .from("voiceovers")
        .upload(storagePath, speechBuffer, {
          contentType: "audio/mpeg",
          upsert: true,
        });
      if (uploadError) {
        throw new Error(`Voiceover upload failed: ${uploadError.message}`);
      }
      const { data: urlData } = db.storage
        .from("voiceovers")
        .getPublicUrl(storagePath);

      await patchStep(job, "voiceover", {
        status: "completed",
        audio_url: urlData.publicUrl,
        storage_path: storagePath,
      });
      return;
    }

    if (stepId === "video") {
      // Async: submitting is the whole first invocation; polling happens later.
      await submitVideoTasks(job);
      return;
    }

    if (stepId === "thumbnail") {
      const idea = job.steps?.script?.thumbnailIdea;
      if (typeof idea !== "string" || !idea) {
        throw new Error("Thumbnail idea is missing; cannot generate thumbnail.");
      }
      const result = await providers.generateThumbnail(idea, job.id);
      await patchStep(job, "thumbnail", {
        status: "completed",
        image_url: result.imageUrl,
        storage_path: result.storagePath,
      });
      return;
    }

    throw new Error(`Unknown pipeline step: ${stepId}`);
  }

  /** Save the finished package as a project and mark the job completed. */
  async function finalizeJob(job: JobRow): Promise<void> {
    const fresh = (await loadJob(job.id)) ?? job;
    const script = fresh.steps?.script ?? {};
    const thumb = fresh.steps?.thumbnail ?? {};
    const voice = fresh.steps?.voiceover ?? {};
    const voiceoverUrl = typeof voice.audio_url === "string" ? voice.audio_url : "";
    const clips = (fresh.steps?.video?.clips as VideoClipState[] | undefined) ?? [];
    const scenes = Array.isArray(script.scenes)
      ? (script.scenes as Array<Record<string, unknown> & { sceneNumber?: number }>).map((scene) => {
          const clip = clips.find((c) => c.sceneNumber === scene.sceneNumber && c.status === "succeed");
          return clip ? { ...scene, videoUrl: clip.video_url, videoDuration: clip.duration } : scene;
        })
      : script.scenes;

    let projectId: string | null = null;
    try {
      const { data: project, error } = await db
        .from("projects")
        .insert({
          user_id: fresh.user_id,
          title: fresh.idea.slice(0, 90),
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
            description: script.description,
            tags: script.tags,
            thumbnailIdea: script.thumbnailIdea,
            thumbnailUrl: thumb.image_url,
            voiceoverUrl: voiceoverUrl || undefined,
            audio_url: voiceoverUrl || undefined,
          },
        })
        .select("id")
        .single();
      if (error) {
        console.error(`[pipeline] ${fresh.id} project insert failed:`, error.message);
      } else {
        projectId = project?.id ?? null;
      }
    } catch (err) {
      console.error(`[pipeline] ${fresh.id} project save exception:`, err);
    }

    const steps = { ...(fresh.steps ?? {}) };
    if (projectId) {
      steps.result = { status: "completed", project_id: projectId };
    }

    await db
      .from("pipeline_jobs")
      .update({ status: "completed", current_step: null, steps })
      .eq("id", fresh.id)
      .eq("status", "running");
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
        const settled = await pollVideoTasks(job);
        if (!settled) return "noop";
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(`[pipeline] ${jobId} step ${inFlight} failed:`, message);
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
      if (order.every((id) => job.steps?.[id]?.status === "completed")) {
        await finalizeJob(job);
        return "completed";
      }
      return "noop";
    }

    // Steps run strictly in order: wait while an earlier one is still running.
    const idx = order.indexOf(stepId);
    if (idx > 0 && job.steps?.[order[idx - 1]]?.status !== "completed") {
      return "noop";
    }

    const claimed = await claimStep(job, stepId);
    if (!claimed) return "noop";

    try {
      await executeStep(claimed, stepId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[pipeline] ${jobId} step ${stepId} failed:`, message);
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

function getRunner() {
  if (!productionRunner) {
    productionRunner = createPipelineRunner({
      db: createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      ),
      providers: {
        generateScript: async (...args) =>
          (await import("@/lib/pipeline/openai")).generateScript(...args),
        generateSpeech: async (...args) =>
          (await import("@/lib/pipeline/elevenlabs")).generateSpeech(...args),
        generateThumbnail: async (...args) =>
          (await import("@/lib/pipeline/gemini-image")).generateThumbnail(...args),
        submitTextToVideo: async (...args) =>
          (await import("@/lib/pipeline/kling")).submitTextToVideo(...args),
        getTextToVideoTask: async (...args) =>
          (await import("@/lib/pipeline/kling")).getTextToVideoTask(...args),
        downloadVideo: async (...args) =>
          (await import("@/lib/pipeline/kling")).downloadVideo(...args),
      },
      kick: kickJob,
      now: Date.now,
    });
  }
  return productionRunner;
}

export const runNextStep = (jobId: string) => getRunner().runNextStep(jobId);
export const reconcileJob = (job: Pick<JobRow, "id" | "status" | "steps" | "created_at">) =>
  getRunner().reconcileJob(job);
export const reapStuckJobs = () => getRunner().reapStuckJobs();
export const failJob = (jobId: string, message: string) => getRunner().failJob(jobId, message);
