// lib/pipeline/rerender.ts
// Queue a re-render of a finished full video (only the render step runs
// again; script, voice and visuals are reused). Used by "Edit video" on the
// project page and by the lab. No charge: the render was paid with the video,
// and re-renders are capped per job (MAX_RERENDERS) to bound our cost.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCaptionStyle } from "./visual-styles";

export const MAX_RERENDERS = 10;

export interface RerenderChanges {
  musicId?: string | null;
  captionStyle?: string | null;
  reason?: string;
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
