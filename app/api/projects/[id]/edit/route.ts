// app/api/projects/[id]/edit/route.ts
// "Edit video" for finished full videos:
//   GET  → the timeline (one entry per ~5 s slot), current music + subtitle style
//   POST {action:"regenerate", index, prompt?} → new AI image for one slot (charged like a still)
//   POST {action:"rerender", musicId?, captionStyle?} → render again with the edits (first one free, then the render price; capped)
//   POST {action:"restoreScene", index, url} → put back an earlier picture of a slot (free)
//   POST {action:"useVersion", url} → make an earlier render the project's video again (free)

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { STILL_SCENE_CREDITS } from "@/lib/pipeline/steps";
import { MAX_RENDER_RETRIES, MAX_RERENDERS, freeRerendersFor, queueRerender, rerenderCredits, retryFailedRender, retryRenderCredits, type RenderVersion } from "@/lib/pipeline/rerender";
import { DEFAULT_CAPTION_STYLE } from "@/lib/pipeline/visual-styles";
import type { TimelineSlot } from "@/lib/pipeline/timeline";
import type { CaptionCue } from "@/lib/pipeline/captions";
import { randomUUID } from "node:crypto";

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
  if (slot.editedClip) {
    return {
      index: slot.index,
      start: slot.start,
      length: slot.length,
      prompt: slot.prompt,
      kind: "clip" as const,
      edited: true,
      source: slot.editedClip.source,
      imageUrl: slot.editedClip.poster ?? null,
      clipUrl: slot.editedClip.url,
      history: (slot.editHistory ?? []).map((h) => ({ url: h.url, at: h.at, poster: h.clip?.poster ?? null, clip: Boolean(h.clip) })),
    };
  }
  const isMap = Boolean(slot.map?.frames?.length) && !slot.editedStillUrl;
  const clip = !isMap && (slot.kind === "kling" || slot.kind === "stock" || slot.kind === "avatar") && slot.status === "succeed" && !slot.editedStillUrl;
  return {
    index: slot.index,
    start: slot.start,
    length: slot.length,
    prompt: slot.prompt,
    kind: clip ? "clip" : "image",
    edited: Boolean(slot.editedStillUrl),
    // What the viewer sees for this slot (a clip shows its source still if it has one).
    imageUrl: slot.editedStillUrl ?? (isMap || slot.kind === "still" || slot.kind === "archive" ? slot.url : slot.imageUrl ?? slot.posterUrl) ?? null,
    clipUrl: clip ? slot.url ?? null : null,
    history: (slot.editHistory ?? []).map((h) => ({ url: h.url, at: h.at, poster: h.clip?.poster ?? null, clip: Boolean(h.clip) })),
  };
}

/** What a slot currently shows (for its history when it changes). */
function currentPicture(slot: TimelineSlot): { url: string; original: boolean; clip?: NonNullable<TimelineSlot["editHistory"]>[number]["clip"] } | null {
  if (slot.editedClip) {
    const { url, ...clip } = slot.editedClip;
    return { url, original: false, clip };
  }
  if (slot.editedStillUrl) return { url: slot.editedStillUrl, original: false };
  const url =
    slot.kind === "still" || slot.kind === "archive"
      ? slot.url
      : slot.kind === "stock"
        ? slot.posterUrl
        : (slot.kind === "kling" || slot.kind === "avatar") && slot.status === "succeed"
          ? slot.imageUrl ?? slot.url
          : slot.imageUrl;
  return url ? { url, original: true } : null;
}

/** Original clip/still marker: restoring it clears the edit. */
const ORIGINAL = "original";

function historyEntry(was: NonNullable<ReturnType<typeof currentPicture>>, prompt: string) {
  return {
    url: was.original ? ORIGINAL : was.url,
    prompt,
    at: new Date().toISOString(),
    ...(was.clip && !was.original ? { clip: was.clip } : {}),
  };
}

/** Allowed hosts for a stock clip picked in the editor. */
const STOCK_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(pixabay\.com|pexels\.com)\//i;
/** Uploaded media limits (Supabase free plan: 50 MB per object). */
const MAX_UPLOAD_BYTES = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024 };
const MIN_SLOT_SECONDS = 1;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const job = await jobForProject(user.id, id);
  const { workingFilesRemoved, WORKING_FILES_GONE_MESSAGE } = await import("@/lib/retention");
  if (job && workingFilesRemoved((job.steps as Record<string, unknown>).retention)) {
    return NextResponse.json({ success: true, editable: false, retryRender: false, expired: true, reason: WORKING_FILES_GONE_MESSAGE, status: job.status });
  }
  const slots = (job?.steps?.video?.slots as TimelineSlot[] | undefined) ?? [];
  if (!job || typeof job.steps?.render?.video_url !== "string" || !slots.length) {
    // A video whose final render failed (visuals done) can be retried (it costs the refunded render price).
    const retryRender =
      Boolean(job) &&
      job!.status === "failed" &&
      job!.steps?.render?.status === "failed" &&
      job!.steps?.video?.status === "completed" &&
      (Number(job!.steps?.render?.retries) || 0) < MAX_RENDER_RETRIES;
    return NextResponse.json({ success: true, editable: false, retryRender, retryCredits: retryRender ? retryRenderCredits(job!.steps) : 0, renderStatus: job?.steps?.render?.status ?? null, status: job?.status ?? null });
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
    freeRerendersLeft: Math.max(0, freeRerendersFor(job.steps) - version),
    rerenderCredits: rerenderCredits(job.steps),
    pendingEdits: Boolean(job.steps.render.edits_pending),
    totalSeconds: Number(job.steps.video?.total_seconds) || slots.reduce((m, x) => Math.max(m, x.start + x.length), 0),
    hook: typeof job.steps.script?.hook === "string" ? job.steps.script.hook : "",
    cues: ((job.steps.voiceover?.captions as CaptionCue[] | undefined) ?? []).map((c, i) => ({ index: i, start: c.start, end: c.end, text: c.text })),
    orientation: ((job.options?.orientation as string | undefined) ?? "") === "horizontal" || job.platform === "YouTube Long-form" ? "horizontal" : "vertical",
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
  const { workingFilesRemoved, WORKING_FILES_GONE_MESSAGE } = await import("@/lib/retention");
  if (workingFilesRemoved((job.steps as Record<string, unknown>).retention)) {
    return NextResponse.json({ success: false, error: WORKING_FILES_GONE_MESSAGE }, { status: 410 });
  }
  const db = admin();

  if (body.action === "retryRender") {
    try {
      const { credits } = await retryFailedRender(db, job.id, user.id);
      return NextResponse.json({ success: true, jobId: job.id, credits });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not retry.";
      return NextResponse.json({ success: false, error: msg, ...(msg.startsWith("Not enough credits") ? { code: "insufficient_credits" } : {}) }, { status: msg.startsWith("Not enough credits") ? 402 : 400 });
    }
  }

  if (body.action === "rerender") {
    // The first few re-renders come with the video; later ones cost the render price.
    const cost = rerenderCredits(job.steps);
    const { payerFor } = await import("@/lib/teams");
    const payer = cost > 0 ? await payerFor(db, user.id) : user.id;
    if (cost > 0) {
      const { data: ok, error: deductError } = await db.rpc("deduct_credits", { p_user_id: payer, p_amount: cost, p_reason: "Edit video: re-render" });
      if (deductError) return NextResponse.json({ success: false, error: "Could not charge credits." }, { status: 500 });
      if (!ok) {
        return NextResponse.json(
          { success: false, error: `Not enough credits. This re-render costs ${cost} credits.`, code: "insufficient_credits" },
          { status: 402 }
        );
      }
    }
    try {
      const { version } = await queueRerender(db, job.id, user.id, {
        musicId: typeof body.musicId === "string" ? body.musicId : null,
        captionStyle: typeof body.captionStyle === "string" ? body.captionStyle : null,
        reason: "edited by user",
        credits: cost,
      });
      return NextResponse.json({ success: true, jobId: job.id, version, credits: cost });
    } catch (err) {
      if (cost > 0) await db.rpc("add_credits", { p_user_id: payer, p_amount: cost, p_type: "refund", p_reason: "Refund: re-render could not start" });
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
    const { payerFor } = await import("@/lib/teams");
    const payer = await payerFor(db, user.id);
    const { data: ok, error: deductError } = await db.rpc("deduct_credits", {
      p_user_id: payer,
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
      // Cast members of this scene keep their faces in the new picture too.
      const { readCast, loadReferenceImages } = await import("@/lib/characters/characters");
      const castInSlot = readCast(job.options?.cast).filter((c) => (slot.characters ?? []).includes(c.name));
      const refs = await Promise.all(
        castInSlot.map(async (c) => ({ name: c.name, description: c.description, images: await loadReferenceImages(db, c.refs).catch(() => []) }))
      );
      const img = await generateSceneImage(prompt, job.id, user.id, fileNumber, orientation, (job.options?.visualStyle as string | undefined) ?? null, refs.length ? refs : undefined);

      // Re-read and patch only this slot (another edit may have landed meanwhile).
      const { data: fresh } = await db.from("pipeline_jobs").select("steps").eq("id", job.id).maybeSingle();
      const steps = (fresh?.steps ?? job.steps) as Record<string, Record<string, unknown>>;
      const freshSlots = ((steps.video?.slots as TimelineSlot[] | undefined) ?? []).map((s) => {
        if (s.index !== slot.index) return s;
        const was = currentPicture(s);
        const history = [
          ...(was ? [historyEntry(was, s.prompt)] : []),
          ...(s.editHistory ?? []),
        ].slice(0, 8);
        const next: TimelineSlot = { ...s, editedStillUrl: img.imageUrl, prompt, editHistory: history };
        delete next.editedClip;
        return next;
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
        p_user_id: payer,
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
      ...(was ? [historyEntry(was, slot.prompt)] : []),
      ...(slot.editHistory ?? []).filter((h) => h.url !== url),
    ].slice(0, 8);
    const restored: TimelineSlot = { ...slot, editHistory: history, prompt: entry.prompt ?? slot.prompt };
    delete restored.editedStillUrl;
    delete restored.editedClip;
    if (url !== ORIGINAL) {
      if (entry.clip) restored.editedClip = { url, ...entry.clip };
      else restored.editedStillUrl = url;
    }
    steps.video = { ...steps.video, slots: slots.map((s) => (s.index === index ? restored : s)) };
    steps.render = { ...steps.render, edits_pending: true };
    await db.from("pipeline_jobs").update({ steps }).eq("id", job.id);
    return NextResponse.json({ success: true, slot: slotView(restored) });
  }

  /** Re-read the job's steps, change them, mark the render out of date. */
  async function mutate(change: (steps: Record<string, Record<string, unknown>>) => string | null) {
    const { data: fresh } = await db.from("pipeline_jobs").select("steps").eq("id", job!.id).maybeSingle();
    const steps = structuredClone((fresh?.steps ?? job!.steps) as Record<string, Record<string, unknown>>);
    const problem = change(steps);
    if (problem) return NextResponse.json({ success: false, error: problem }, { status: 400 });
    steps.render = { ...steps.render, edits_pending: true };
    const { error } = await db.from("pipeline_jobs").update({ steps }).eq("id", job!.id);
    if (error) return NextResponse.json({ success: false, error: "Could not save the change." }, { status: 500 });
    return NextResponse.json({ success: true, slots: ((steps.video?.slots as TimelineSlot[] | undefined) ?? []).map(slotView) });
  }

  /** Put a video (upload or stock) on a slot, keeping what it showed in its history. */
  function setClip(steps: Record<string, Record<string, unknown>>, index: number, clip: NonNullable<TimelineSlot["editedClip"]>): string | null {
    const slots = (steps.video?.slots as TimelineSlot[] | undefined) ?? [];
    const slot = slots.find((s) => s.index === index);
    if (!slot) return "Unknown scene.";
    const was = currentPicture(slot);
    const next: TimelineSlot = {
      ...slot,
      editedClip: clip,
      editHistory: [...(was ? [historyEntry(was, slot.prompt)] : []), ...(slot.editHistory ?? [])].slice(0, 8),
    };
    delete next.editedStillUrl;
    steps.video = { ...steps.video, slots: slots.map((s) => (s.index === index ? next : s)) };
    return null;
  }

  // Move the cuts between scenes: `cuts` are the new start times of scenes 2…n.
  if (body.action === "retime") {
    const cuts = Array.isArray(body.cuts) ? body.cuts.map(Number) : [];
    return mutate((steps) => {
      const slots = [...((steps.video?.slots as TimelineSlot[] | undefined) ?? [])].sort((a, b) => a.start - b.start);
      if (cuts.length !== slots.length - 1 || cuts.some((c) => !Number.isFinite(c))) return "The timeline changed. Reload and try again.";
      const total = slots[slots.length - 1].start + slots[slots.length - 1].length;
      const bounds = [0, ...cuts.map((c) => Math.round(c * 100) / 100), Math.round(total * 100) / 100];
      for (let i = 1; i < bounds.length; i++) {
        if (bounds[i] - bounds[i - 1] < MIN_SLOT_SECONDS) return `Every scene needs at least ${MIN_SLOT_SECONDS} second on screen.`;
      }
      steps.video = {
        ...steps.video,
        slots: slots.map((s, i) => ({ ...s, start: bounds[i], length: Math.round((bounds[i + 1] - bounds[i]) * 100) / 100 })),
      };
      return null;
    });
  }

  // Swap what two scenes show (their timing stays).
  if (body.action === "swap") {
    const a = Number(body.a);
    const b = Number(body.b);
    return mutate((steps) => {
      const slots = (steps.video?.slots as TimelineSlot[] | undefined) ?? [];
      const sa = slots.find((s) => s.index === a);
      const sb = slots.find((s) => s.index === b);
      if (!sa || !sb || a === b) return "Pick two different scenes.";
      const timing = (s: TimelineSlot) => ({ index: s.index, start: s.start, length: s.length });
      steps.video = {
        ...steps.video,
        slots: slots.map((s) => (s.index === a ? { ...sb, ...timing(sa) } : s.index === b ? { ...sa, ...timing(sb) } : s)),
      };
      return null;
    });
  }

  // Your own picture or video for a scene: a signed upload URL (the file goes straight to storage).
  if (body.action === "uploadUrl") {
    const type = typeof body.type === "string" ? body.type : "";
    const size = Number(body.size) || 0;
    const kind = /^image\/(jpeg|png|webp)$/.test(type) ? "image" : /^video\/(mp4|webm|quicktime)$/.test(type) ? "video" : null;
    if (!kind) return NextResponse.json({ success: false, error: "Use a JPG, PNG or WebP picture, or an MP4, WebM or MOV video." }, { status: 400 });
    if (size > MAX_UPLOAD_BYTES[kind]) {
      return NextResponse.json({ success: false, error: kind === "image" ? "Pictures can be up to 10 MB." : "Videos can be up to 50 MB." }, { status: 400 });
    }
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" }[type];
    const path = `${user.id}/${job.id}/upload-${randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from("videos").createSignedUploadUrl(path);
    if (error || !data) return NextResponse.json({ success: false, error: "Could not prepare the upload." }, { status: 500 });
    return NextResponse.json({ success: true, path, token: data.token, signedUrl: data.signedUrl, kind });
  }

  if (body.action === "useUpload") {
    const index = Number(body.index);
    const path = typeof body.path === "string" ? body.path : "";
    // Only files this user uploaded for this video.
    if (!new RegExp(`^${user.id}/${job.id}/upload-[0-9a-f-]{36}\\.(jpg|png|webp|mp4|webm|mov)$`).test(path)) {
      return NextResponse.json({ success: false, error: "Unknown upload." }, { status: 400 });
    }
    const url = db.storage.from("videos").getPublicUrl(path).data.publicUrl;
    const isVideo = /\.(mp4|webm|mov)$/.test(path);
    const seconds = Number(body.seconds) || undefined;
    return mutate((steps) => {
      if (isVideo) return setClip(steps, index, { url, seconds, source: "upload" });
      const slots = (steps.video?.slots as TimelineSlot[] | undefined) ?? [];
      const slot = slots.find((s) => s.index === index);
      if (!slot) return "Unknown scene.";
      const was = currentPicture(slot);
      const next: TimelineSlot = {
        ...slot,
        editedStillUrl: url,
        editHistory: [...(was ? [historyEntry(was, slot.prompt)] : []), ...(slot.editHistory ?? [])].slice(0, 8),
      };
      delete next.editedClip;
      steps.video = { ...steps.video, slots: slots.map((s) => (s.index === index ? next : s)) };
      return null;
    });
  }

  // Stock footage: search, then put a clip on a scene.
  if (body.action === "stockSearch") {
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";
    if (query.length < 2) return NextResponse.json({ success: false, error: "Type what the clip should show." }, { status: 400 });
    try {
      const { searchStockClips } = await import("@/lib/pipeline/pexels");
      const vertical = ((job.options?.orientation as string | undefined) ?? "vertical") === "vertical" && job.platform !== "YouTube Long-form";
      const clips = await searchStockClips(query, vertical ? "vertical" : "horizontal", 12);
      return NextResponse.json({
        success: true,
        clips: clips.map((c) => ({ id: c.id, provider: c.provider, preview: c.previewImage, videoUrl: c.videoUrl, seconds: c.durationSeconds, author: c.author, pageUrl: c.url })),
      });
    } catch {
      return NextResponse.json({ success: false, error: "Stock search isn't available right now." }, { status: 502 });
    }
  }

  if (body.action === "useStock") {
    const index = Number(body.index);
    const url = typeof body.videoUrl === "string" ? body.videoUrl : "";
    const poster = typeof body.preview === "string" && STOCK_HOSTS.test(body.preview) ? body.preview : undefined;
    if (!STOCK_HOSTS.test(url)) return NextResponse.json({ success: false, error: "Pick a clip from the search." }, { status: 400 });
    const author = typeof body.author === "string" ? body.author.slice(0, 80) : "";
    return mutate((steps) =>
      setClip(steps, index, { url, poster, seconds: Number(body.seconds) || undefined, source: "stock", credit: author || undefined })
    );
  }

  // Fix subtitle words (timing stays) and the on-screen hook.
  if (body.action === "text") {
    return mutate((steps) => {
      if (typeof body.hook === "string") {
        const hook = body.hook.trim().replace(/\s+/g, " ").slice(0, 200);
        if (!hook) return "The hook can't be empty.";
        steps.script = { ...steps.script, hook };
      }
      if (Array.isArray(body.cues)) {
        const cues = [...((steps.voiceover?.captions as CaptionCue[] | undefined) ?? [])];
        for (const raw of body.cues as Array<{ index?: unknown; text?: unknown }>) {
          const i = Number(raw?.index);
          // Keep the cue's line break (two-line subtitles), tidy everything else.
          const text =
            typeof raw?.text === "string"
              ? raw.text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/ *\n+ */g, "\n").trim().split("\n").slice(0, 2).join("\n").slice(0, 160)
              : "";
          if (!cues[i] || !text) continue;
          cues[i] = { ...cues[i], text };
        }
        steps.voiceover = { ...steps.voiceover, captions: cues };
      }
      return null;
    });
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
