// app/api/projects/[id]/edit/route.ts
// "Edit video" for finished full videos:
//   GET  → the timeline (one entry per ~5 s slot), current music + subtitle style
//   POST {action:"regenerate", index, prompt?} → new AI image for one slot (charged like a still)
//   POST {action:"rerender", musicId?, captionStyle?} → render again with the edits (free, capped)
//   POST {action:"restoreScene", index, url} → put back an earlier picture of a slot (free)
//   POST {action:"useVersion", url} → make an earlier render the project's video again (free)

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { STILL_SCENE_CREDITS } from "@/lib/pipeline/steps";
import { MAX_RENDER_RETRIES, MAX_RERENDERS, queueRerender, retryFailedRender, type RenderVersion } from "@/lib/pipeline/rerender";
import { DEFAULT_CAPTION_STYLE } from "@/lib/pipeline/visual-styles";
import type { TimelineSlot } from "@/lib/pipeline/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

type Job = {
  id: string;
  user_id: string;
  status: string;
  style: string | null;
  platform: string | null;
  options: Record<string, unknown> | null;
  steps: Record<string, Record<string, unknown>>;
};

/** The full-video job behind a project (owned by the user). */
async function jobForProject(userId: string, projectId: string): Promise<Job | null> {
  const { data } = await admin()
    .from("pipeline_jobs")
    .select("id, user_id, status, style, platform, options, steps")
    .eq("user_id", userId)
    .eq("steps->result->>project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Job | null) ?? null;
}

function slotView(slot: TimelineSlot) {
  const clip = (slot.kind === "kling" || slot.kind === "stock") && slot.status === "succeed" && !slot.editedStillUrl;
  return {
    index: slot.index,
    start: slot.start,
    length: slot.length,
    prompt: slot.prompt,
    kind: clip ? "clip" : "image",
    edited: Boolean(slot.editedStillUrl),
    // What the viewer sees for this slot (a clip shows its source still if it has one).
    imageUrl: slot.editedStillUrl ?? (slot.kind === "still" || slot.kind === "archive" ? slot.url : slot.imageUrl ?? slot.posterUrl) ?? null,
    clipUrl: clip ? slot.url ?? null : null,
    history: (slot.editHistory ?? []).map((h) => ({ url: h.url, at: h.at })),
  };
}

/** What a slot currently shows (for its history when it changes). */
function currentPicture(slot: TimelineSlot): { url: string; original: boolean } | null {
  if (slot.editedStillUrl) return { url: slot.editedStillUrl, original: false };
  const url =
    slot.kind === "still" || slot.kind === "archive"
      ? slot.url
      : slot.kind === "stock"
        ? slot.posterUrl
        : slot.kind === "kling" && slot.status === "succeed"
          ? slot.imageUrl ?? slot.url
          : slot.imageUrl;
  return url ? { url, original: true } : null;
}

/** Original clip/still marker: restoring it clears the edit. */
const ORIGINAL = "original";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const job = await jobForProject(user.id, id);
  const slots = (job?.steps?.video?.slots as TimelineSlot[] | undefined) ?? [];
  if (!job || typeof job.steps?.render?.video_url !== "string" || !slots.length) {
    // A video whose final render failed (visuals done) can be retried for free.
    const retryRender =
      Boolean(job) &&
      job!.status === "failed" &&
      job!.steps?.render?.status === "failed" &&
      job!.steps?.video?.status === "completed" &&
      (Number(job!.steps?.render?.retries) || 0) < MAX_RENDER_RETRIES;
    return NextResponse.json({ success: true, editable: false, retryRender, renderStatus: job?.steps?.render?.status ?? null, status: job?.status ?? null });
  }

  const { MUSIC_TRACKS, pickMusicTrack } = await import("@/lib/pipeline/music");
  const current = pickMusicTrack(job.style, job.id, {
    mood: job.steps?.script?.music_mood as never,
    trackId: job.steps?.render?.music_id as string | undefined,
  });
  const version = Number(job.steps.render.version) || 0;
  return NextResponse.json({
    success: true,
    editable: true,
    jobId: job.id,
    status: job.status,
    renderStatus: job.steps.render.status ?? null,
    renderError: job.status === "failed" ? (job.steps.render.error as string | null) ?? "Render failed" : null,
    videoUrl: job.steps.render.video_url,
    versions: ((Array.isArray(job.steps.render.history) ? job.steps.render.history : []) as RenderVersion[]).filter(
      (v) => !v.watermarked || job.steps.render.watermarked === true
    ),
    slots: slots.map(slotView),
    music: { id: current.id, title: current.title, mood: current.mood },
    tracks: MUSIC_TRACKS.map((t) => ({ id: t.id, title: t.title, mood: t.mood })),
    captionStyle: (job.options?.captionStyle as string | undefined) ?? DEFAULT_CAPTION_STYLE,
    stillCredits: STILL_SCENE_CREDITS,
    rerendersLeft: Math.max(0, MAX_RERENDERS - version),
    pendingEdits: Boolean(job.steps.render.edits_pending),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // handled below
  }
  const job = await jobForProject(user.id, id);
  if (!job || !job.steps?.render) {
    return NextResponse.json({ success: false, error: "This project has no editable video." }, { status: 404 });
  }
  if (job.status === "running") {
    return NextResponse.json({ success: false, error: "The video is being rendered. Try again when it has finished." }, { status: 409 });
  }
  const db = admin();

  if (body.action === "retryRender") {
    try {
      await retryFailedRender(db, job.id, user.id);
      return NextResponse.json({ success: true, jobId: job.id });
    } catch (err) {
      return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Could not retry." }, { status: 400 });
    }
  }

  if (body.action === "rerender") {
    try {
      const { version } = await queueRerender(db, job.id, user.id, {
        musicId: typeof body.musicId === "string" ? body.musicId : null,
        captionStyle: typeof body.captionStyle === "string" ? body.captionStyle : null,
        reason: "edited by user",
      });
      return NextResponse.json({ success: true, jobId: job.id, version });
    } catch (err) {
      return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Could not re-render." }, { status: 400 });
    }
  }

  if (body.action === "regenerate") {
    const slots = (job.steps?.video?.slots as TimelineSlot[] | undefined) ?? [];
    const index = Number(body.index);
    const slot = slots.find((s) => s.index === index);
    if (!slot) return NextResponse.json({ success: false, error: "Unknown scene." }, { status: 400 });
    const prompt =
      typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.trim().replace(/\s+/g, " ").slice(0, 800) : slot.prompt;

    // Charge first (like any generation); refund if the image fails.
    const { data: ok, error: deductError } = await db.rpc("deduct_credits", {
      p_user_id: user.id,
      p_amount: STILL_SCENE_CREDITS,
      p_reason: "Edit video: new scene image",
    });
    if (deductError) return NextResponse.json({ success: false, error: "Could not charge credits." }, { status: 500 });
    if (!ok) {
      return NextResponse.json(
        { success: false, error: `Not enough credits. A new image costs ${STILL_SCENE_CREDITS} credits.`, code: "insufficient_credits" },
        { status: 402 }
      );
    }
    try {
      const { generateSceneImage } = await import("@/lib/pipeline/gemini-image");
      const { defaultOrientation } = await import("@/lib/pipeline/options");
      const orientation = ((job.options?.orientation as string | undefined) ?? defaultOrientation(job.platform ?? "")) === "vertical" ? "vertical" : "horizontal";
      // Unique file name per edit so CDN caches never show the old picture.
      const fileNumber = 1000 + slot.index * 100 + (Number(job.steps.render.edit_count) || 0) + 1;
      const img = await generateSceneImage(prompt, job.id, user.id, fileNumber, orientation, (job.options?.visualStyle as string | undefined) ?? null);

      // Re-read and patch only this slot (another edit may have landed meanwhile).
      const { data: fresh } = await db.from("pipeline_jobs").select("steps").eq("id", job.id).maybeSingle();
      const steps = (fresh?.steps ?? job.steps) as Record<string, Record<string, unknown>>;
      const freshSlots = ((steps.video?.slots as TimelineSlot[] | undefined) ?? []).map((s) => {
        if (s.index !== slot.index) return s;
        const was = currentPicture(s);
        const history = [
          ...(was ? [{ url: was.original ? ORIGINAL : was.url, prompt: s.prompt, at: new Date().toISOString() }] : []),
          ...(s.editHistory ?? []),
        ].slice(0, 8);
        return { ...s, editedStillUrl: img.imageUrl, prompt, editHistory: history };
      });
      steps.video = { ...steps.video, slots: freshSlots };
      steps.render = {
        ...steps.render,
        edits_pending: true,
        edit_count: (Number(steps.render?.edit_count) || 0) + 1,
        edit_credits: (Number(steps.render?.edit_credits) || 0) + STILL_SCENE_CREDITS,
      };
      await db.from("pipeline_jobs").update({ steps }).eq("id", job.id);
      return NextResponse.json({ success: true, slot: slotView(freshSlots.find((s) => s.index === slot.index)!) });
    } catch (err) {
      console.error("[edit] regenerate failed:", err);
      await db.rpc("add_credits", {
        p_user_id: user.id,
        p_amount: STILL_SCENE_CREDITS,
        p_type: "refund",
        p_reason: "Refund: edit video image failed",
      });
      return NextResponse.json({ success: false, error: "The new image could not be made. Your credits were refunded." }, { status: 502 });
    }
  }

  if (body.action === "restoreScene") {
    const index = Number(body.index);
    const url = typeof body.url === "string" ? body.url : "";
    const { data: fresh } = await db.from("pipeline_jobs").select("steps").eq("id", job.id).maybeSingle();
    const steps = (fresh?.steps ?? job.steps) as Record<string, Record<string, unknown>>;
    const slots = (steps.video?.slots as TimelineSlot[] | undefined) ?? [];
    const slot = slots.find((s) => s.index === index);
    const entry = slot?.editHistory?.find((h) => h.url === url);
    if (!slot || !entry) return NextResponse.json({ success: false, error: "That picture isn't in this scene's history." }, { status: 400 });
    const was = currentPicture(slot);
    const history = [
      ...(was ? [{ url: was.original ? ORIGINAL : was.url, prompt: slot.prompt, at: new Date().toISOString() }] : []),
      ...(slot.editHistory ?? []).filter((h) => h.url !== url),
    ].slice(0, 8);
    const restored: TimelineSlot = { ...slot, editHistory: history, prompt: entry.prompt ?? slot.prompt };
    if (url === ORIGINAL) delete restored.editedStillUrl;
    else restored.editedStillUrl = url;
    steps.video = { ...steps.video, slots: slots.map((s) => (s.index === index ? restored : s)) };
    steps.render = { ...steps.render, edits_pending: true };
    await db.from("pipeline_jobs").update({ steps }).eq("id", job.id);
    return NextResponse.json({ success: true, slot: slotView(restored) });
  }

  if (body.action === "useVersion") {
    const url = typeof body.url === "string" ? body.url : "";
    const render = job.steps.render;
    const history = (Array.isArray(render.history) ? render.history : []) as RenderVersion[];
    const chosen = history.find((h) => h.url === url);
    if (!chosen) return NextResponse.json({ success: false, error: "That version isn't available." }, { status: 400 });
    // Never bring the trial badge back once the current video is clean.
    if (chosen.watermarked && render.watermarked !== true) {
      return NextResponse.json({ success: false, error: "That version has the free-trial badge. Re-render instead." }, { status: 400 });
    }
    const current: RenderVersion = {
      version: Number(render.version) || 0,
      url: render.video_url as string,
      at: new Date().toISOString(),
      ...(render.watermarked === true ? { watermarked: true } : {}),
    };
    const steps = {
      ...job.steps,
      render: { ...render, video_url: chosen.url, version: Math.max(Number(render.version) || 0, chosen.version), history: [current, ...history.filter((h) => h.url !== url)].slice(0, MAX_RERENDERS + 1) },
    };
    await db.from("pipeline_jobs").update({ steps }).eq("id", job.id);
    const { data: project } = await db.from("projects").select("content").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (project) {
      await db.from("projects").update({ content: { ...((project.content ?? {}) as Record<string, unknown>), finalVideoUrl: chosen.url } }).eq("id", id).eq("user_id", user.id);
    }
    return NextResponse.json({ success: true, videoUrl: chosen.url });
  }

  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
