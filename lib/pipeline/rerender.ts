// lib/pipeline/rerender.ts
// Queue a re-render of a finished full video (only the render step runs
// again; script, voice and visuals are reused). Used by "Edit video" on the
// project page and by the lab. The first FREE_RERENDERS are included with the
// video; after that each one costs the render price (5 Nov 2026: free re-renders
// were our biggest unpaid provider cost). Capped per job at MAX_RERENDERS.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCaptionStyle } from "./visual-styles";
import { RENDER_CREDITS_PER_30S } from "./steps";

export const MAX_RERENDERS = 10;
/** Re-renders included with every video; later ones are charged (rerenderCredits). */
export const FREE_RERENDERS = 3;

/** Credits the NEXT re-render of this job costs (0 while free ones are left). */
export function rerenderCredits(steps: Record<string, Record<string, unknown>> | null | undefined): number {
  const version = Number(steps?.render?.version) || 0;
  if (version < FREE_RERENDERS) return 0;
  const seconds = Number(steps?.video?.total_seconds) || Number(steps?.voiceover?.duration_seconds) || 30;
  return RENDER_CREDITS_PER_30S * Math.max(1, Math.ceil(seconds / 30));
}

export interface RerenderChanges {
  musicId?: string | null;
  captionStyle?: string | null;
  reason?: string;
  /** Credits already charged for this re-render (refunded by failJob if it fails). */
  credits?: number;
}

export interface RenderVersion {
  version: number;
  url: string;
  at: string;
  /** Made with the free-trial badge. */
  watermarked?: boolean;
}

export async function queueRerender(
  db: SupabaseClient,
  jobId: string,
  userId: string,
  changes: RerenderChanges
): Promise<{ version: number }> {
  const { data: job } = await db.from("pipeline_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job || job.user_id !== userId) throw new Error("Video not found.");
  if (job.status === "running") throw new Error("This video is still being made. Try again when it has finished.");
  const steps = (job.steps ?? {}) as Record<string, Record<string, unknown>>;
  if (!steps.render || typeof steps.render.video_url !== "string") throw new Error("Only finished full videos can be re-rendered.");
  const version = (Number(steps.render.version) || 0) + 1;
  if (version > MAX_RERENDERS) throw new Error(`This video has reached the limit of ${MAX_RERENDERS} re-renders.`);

  if (changes.musicId) {
    const { MUSIC_TRACKS } = await import("./music");
    if (!MUSIC_TRACKS.some((t) => t.id === changes.musicId)) throw new Error("Unknown music track.");
  }
  const options = { ...((job.options ?? {}) as Record<string, unknown>) };
  if (changes.captionStyle) {
    if (!isCaptionStyle(changes.captionStyle)) throw new Error("Unknown subtitle style.");
    options.captionStyle = changes.captionStyle;
  }

  // Keep earlier renders (each version has its own file) so the creator can go back.
  const history = (Array.isArray(steps.render.history) ? (steps.render.history as RenderVersion[]) : []).filter((h) => h.url !== steps.render.video_url);
  history.unshift({
    version: Number(steps.render.version) || 0,
    url: steps.render.video_url as string,
    at: new Date().toISOString(),
    ...(steps.render.watermarked === true ? { watermarked: true } : {}),
  });

  steps.render = {
    ...steps.render,
    history: history.slice(0, MAX_RERENDERS + 1),
    status: "pending",
    render_id: null,
    provider_status: null,
    error: null,
    ...(changes.musicId ? { music_id: changes.musicId } : {}),
    version,
    reason: changes.reason ?? "edited",
    rerender_credits: changes.credits ?? 0,
    // Edited scene images are picked up by this render.
    edits_pending: false,
    queued_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("pipeline_jobs")
    .update({ steps, options, status: "running", current_step: "render", error: null })
    .eq("id", jobId)
    .neq("status", "running");
  if (error) throw new Error(error.message);
  const { kickJob } = await import("./runner");
  await kickJob(jobId);
  return { version };
}

/** A failed render can be tried again for free (the failure was ours), a couple of times. */
export const MAX_RENDER_RETRIES = 2;

/**
 * Retry a job whose visuals were made but whose final render failed. Credits
 * for the render were refunded by failJob; the retry is free, and a second
 * failure refunds nothing more (failJob refunds once). On success the partial
 * project gets the video (finalizeJob → refreshProjectVideo).
 */
export async function retryFailedRender(db: SupabaseClient, jobId: string, userId: string): Promise<void> {
  const { data: job } = await db.from("pipeline_jobs").select("*").eq("id", jobId).maybeSingle();
  if (!job || job.user_id !== userId) throw new Error("Video not found.");
  const steps = (job.steps ?? {}) as Record<string, Record<string, unknown>>;
  if (job.status !== "failed" || steps.render?.status !== "failed" || steps.video?.status !== "completed") {
    throw new Error("Only a video whose final render failed can be retried.");
  }
  const retries = Number(steps.render.retries) || 0;
  if (retries >= MAX_RENDER_RETRIES) throw new Error("This render has already been retried. Please contact support.");
  steps.render = {
    ...steps.render,
    status: "pending",
    render_id: null,
    provider_status: null,
    error: null,
    retries: retries + 1,
    queued_at: new Date().toISOString(),
  };
  const { error } = await db
    .from("pipeline_jobs")
    .update({ steps, status: "running", current_step: "render", error: null })
    .eq("id", jobId)
    .eq("status", "failed");
  if (error) throw new Error(error.message);
  const { kickJob } = await import("./runner");
  await kickJob(jobId);
}
