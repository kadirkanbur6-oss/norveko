// lib/pipeline/unwatermark.ts
// First purchase → remove the free-trial badge from everything the user made:
//   • thumbnails: swap in the clean copy kept at watermark time
//   • videos: queue a clean re-render (render step only, new file version);
//     refreshProjectVideo() points the project at it when it finishes.
// Called from the Paddle webhook after credits are granted. Idempotent.

import "server-only";
import { createClient } from "@supabase/supabase-js";
import { kickJob } from "./runner";

/** Re-renders are bounded so one purchase can't trigger an unbounded bill. */
const MAX_RERENDERS = 20;

export async function removeWatermarksForUser(userId: string): Promise<{ projects: number; rerenders: number }> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  // 1) Projects: clean thumbnail back in, badge flag off (videos follow below).
  const { data: projects } = await db
    .from("projects")
    .select("id, content")
    .eq("user_id", userId)
    .eq("content->>watermarked", "true")
    .limit(500);
  let projectCount = 0;
  for (const p of projects ?? []) {
    const content = { ...((p.content ?? {}) as Record<string, unknown>) };
    const clean = (content.cleanAssets as { thumbnailUrl?: string } | undefined)?.thumbnailUrl;
    if (clean) content.thumbnailUrl = clean;
    content.watermarked = false;
    const { error } = await db.from("projects").update({ content }).eq("id", p.id);
    if (!error) projectCount++;
  }

  // 2) Jobs: thumbnails in the job record, and clean re-renders for videos.
  const { data: jobs } = await db
    .from("pipeline_jobs")
    .select("id, status, steps")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  let rerenders = 0;
  for (const job of jobs ?? []) {
    const steps = { ...((job.steps ?? {}) as Record<string, Record<string, unknown>>) };
    let changed = false;
    if (steps.thumbnail?.watermarked === true && typeof steps.thumbnail.clean_url === "string") {
      steps.thumbnail = { ...steps.thumbnail, image_url: steps.thumbnail.clean_url, watermarked: false };
      changed = true;
    }
    const renderMarked = steps.render?.watermarked === true && steps.render?.status === "completed";
    if (renderMarked && job.status === "completed" && rerenders < MAX_RERENDERS) {
      steps.render = {
        ...steps.render,
        status: "pending",
        render_id: null,
        provider_status: null,
        error: null,
        version: (Number(steps.render.version) || 0) + 1,
        queued_at: new Date().toISOString(),
        reason: "watermark removed after purchase",
      };
      const { error } = await db
        .from("pipeline_jobs")
        .update({ steps, status: "running", current_step: "render", error: null })
        .eq("id", job.id)
        .eq("status", "completed");
      if (!error) {
        rerenders++;
        await kickJob(job.id);
      }
      continue;
    }
    if (changed) await db.from("pipeline_jobs").update({ steps }).eq("id", job.id);
  }
  return { projects: projectCount, rerenders };
}
