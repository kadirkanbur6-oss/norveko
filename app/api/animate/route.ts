// app/api/animate/route.ts — Image to video (lib/animate/animate.ts).
//   GET [?id=] → your recent clips (moves a running one along)
//   POST {action:"uploadUrl", type, size} → signed upload for the picture
//   POST {action:"start", path, prompt?, seconds: 5|10, orientation, rights:true}

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/api-keys";
import { isFullVideoEnabled, isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { hasPurchased, isWatermarkExempt } from "@/lib/pipeline/watermark-policy";
import { advanceSwapJob, type SwapRow } from "@/lib/swap/swap";
import {
  ANIMATE_MAX_BYTES,
  ANIMATE_MAX_CHARS,
  ANIMATE_SECONDS,
  IMAGE_CONTENT_TYPES,
  IMAGE_TYPES,
  ANIMATE_SPEECH_MAX_SECONDS,
  animateCredits,
  animatePrompt,
  animateSpeechCredits,
  animateSpeechPrompt,
  checkAnimateImage,
  isAnimateSeconds,
} from "@/lib/animate/animate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ success: false, error, ...extra }, { status });
const MAX_RUNNING = 2;

function view(r: SwapRow) {
  return {
    id: r.id,
    status: r.status,
    prompt: r.prompt,
    seconds: r.source_seconds,
    vertical: r.vertical,
    credits: r.credits,
    imageUrl: r.image_url ?? null,
    outputUrl: r.output_url,
    projectId: r.project_id,
    error: r.error,
    createdAt: r.created_at,
  };
}

const AUDIO_RE = (userId: string) => new RegExp(`^${userId}/talk/(aud|rec)-[0-9a-f-]{36}\\.(mp3|wav|m4a)$`);
const PATH_RE = (userId: string) => new RegExp(`^${userId}/animate/img-[0-9a-f-]{36}\\.(jpg|png|webp)$`);

async function allowedFor(db: ReturnType<typeof adminDb>, userId: string) {
  return isGenerationEnabled(userId) && isFullVideoEnabled(userId) && (isWatermarkExempt(userId) || (await hasPurchased(db, userId)));
}

export async function GET(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  const db = adminDb();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data } = await db.from("swap_jobs").select("*").eq("id", id).eq("user_id", user.id).eq("kind", "animate").maybeSingle();
    if (!data) return bad("Not found", 404);
    return NextResponse.json({ success: true, clip: view(await advanceSwapJob(db, data as SwapRow)) });
  }
  const { data } = await db.from("swap_jobs").select("*").eq("user_id", user.id).eq("kind", "animate").order("created_at", { ascending: false }).limit(20);
  return NextResponse.json({
    success: true,
    allowed: await allowedFor(db, user.id),
    maxChars: ANIMATE_MAX_CHARS,
    speechCredits: Array.from({ length: ANIMATE_SPEECH_MAX_SECONDS }, (_, i) => animateSpeechCredits(i + 1)),
    options: ANIMATE_SECONDS.map((s) => ({ seconds: s, credits: animateCredits(s) })),
    clips: ((data ?? []) as SwapRow[]).map(view),
  });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  if (!isGenerationEnabled(user.id) || !isFullVideoEnabled(user.id)) return bad(LAUNCH_LOCK_MESSAGE, 403);
  const db = adminDb();
  if (!(await allowedFor(db, user.id))) return bad("Image to video is available once you have bought a plan or pack.", 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "uploadUrl") {
    const ext = IMAGE_TYPES[String(body.type ?? "")];
    if (!ext) return bad("Use a JPG, PNG or WebP picture.");
    if (Number(body.size) > ANIMATE_MAX_BYTES) return bad("Pictures can be up to 8 MB.");
    const path = `${user.id}/animate/img-${randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from("videos").createSignedUploadUrl(path);
    if (error || !data) return bad("Could not prepare the upload.", 500);
    return NextResponse.json({ success: true, path, token: data.token, contentType: IMAGE_CONTENT_TYPES[ext] });
  }

  if (body.action === "start") {
    if (body.rights !== true) return bad("Confirm the checkbox first.");
    const path = typeof body.path === "string" ? body.path : "";
    if (!PATH_RE(user.id).test(path)) return bad("Add a picture first.");
    const audioPath = typeof body.audioPath === "string" && body.audioPath ? body.audioPath : "";
    if (audioPath && !AUDIO_RE(user.id).test(audioPath)) return bad("Add the voice first.");
    if (!audioPath && !isAnimateSeconds(Number(body.seconds))) return bad("Pick 5 or 10 seconds.");
    let seconds = Number(body.seconds) as number;
    if (audioPath) {
      const { audioSeconds } = await import("@/lib/talk/talk");
      const { data: af, error: aErr } = await db.storage.from("videos").download(audioPath);
      if (aErr || !af) return bad("The voice wasn't found. Add it again.");
      if (af.size > 8 * 1024 * 1024) return bad("Recordings can be up to 8 MB.");
      const aext = audioPath.slice(audioPath.lastIndexOf(".") + 1) as "mp3" | "wav" | "m4a";
      const len = audioSeconds(Buffer.from(await af.arrayBuffer()), aext);
      if (!(len >= 1)) return bad("The recording is too short.");
      if (len > ANIMATE_SPEECH_MAX_SECONDS + 0.5) return bad(`Up to ${ANIMATE_SPEECH_MAX_SECONDS} seconds. Shorten the line or trim the recording.`);
      seconds = Math.round(len * 10) / 10;
    }
    const script = audioPath && typeof body.script === "string" ? body.script.replace(/\s+/g, " ").trim().slice(0, 450) : "";
    const vertical = body.orientation !== "horizontal";
    const prompt = typeof body.prompt === "string" ? body.prompt.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, ANIMATE_MAX_CHARS) : "";

    const { count } = await db.from("swap_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "running").eq("kind", "animate");
    if ((count ?? 0) >= MAX_RUNNING) return bad(`Up to ${MAX_RUNNING} are made at a time. Try again when one finishes.`, 429);

    const { isFreeAccount } = await import("@/lib/pipeline/trial");
    if (await isFreeAccount(db, user.id)) {
      const { FREE_PLAN_UPGRADE_MESSAGE } = await import("@/lib/plans");
      return NextResponse.json({ success: false, error: FREE_PLAN_UPGRADE_MESSAGE, code: "upgrade_required" }, { status: 403 });
    }

    const { data: file, error: dlErr } = await db.storage.from("videos").download(path);
    if (dlErr || !file) return bad("The picture wasn't found. Add it again.");
    if (file.size > ANIMATE_MAX_BYTES) return bad("Pictures can be up to 8 MB.");
    const ext = path.slice(path.lastIndexOf(".") + 1) as "jpg" | "png" | "webp";
    const check = await checkAnimateImage(Buffer.from(await file.arrayBuffer()), IMAGE_CONTENT_TYPES[ext]);
    if (!check.ok) return bad(check.reason);

    const credits = audioPath ? animateSpeechCredits(seconds) : animateCredits(seconds as 5 | 10);
    const { payerFor } = await import("@/lib/teams");
    const payer = await payerFor(db, user.id);
    const { data: paid, error: payErr } = await db.rpc("deduct_credits", {
      p_user_id: payer,
      p_amount: credits,
      p_reason: audioPath ? `Image to video with voice (${seconds} s)` : `Image to video (${seconds} s)`,
    });
    if (payErr) return bad(payErr.message, 500);
    if (!paid) return bad(`Not enough credits. This costs ${credits}.`, 402, { code: "insufficient_credits" });

    const id = randomUUID();
    try {
      const fv = await import("@/lib/pipeline/fal-video");
      const imageUrl = db.storage.from("videos").getPublicUrl(path).data.publicUrl;
      const audioUrl = audioPath ? db.storage.from("videos").getPublicUrl(audioPath).data.publicUrl : "";
      const fal = audioPath
        ? await fv.submitAvatar({ imageUrl, audioUrl, prompt: animateSpeechPrompt(prompt) })
        : await fv.submitImageToVideo({ prompt: animatePrompt(prompt), imageUrl, aspectRatio: vertical ? "9:16" : "16:9", seconds: seconds as 5 | 10 });
      const { error } = await db.from("swap_jobs").insert({
        id,
        kind: "animate",
        user_id: user.id,
        billed_to: payer !== user.id ? payer : null,
        status: "running",
        phase: "swap",
        source_path: audioPath || path,
        source_seconds: seconds,
        vertical,
        character_id: null,
        character_name: "Image to video",
        prompt: prompt || null,
        script: script || null,
        image_url: imageUrl,
        fal,
        credits,
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error("[animate] start failed:", err);
      await db.rpc("add_credits", { p_user_id: payer, p_amount: credits, p_type: "refund", p_reason: "Refund: image to video could not start" });
      const msg = err instanceof Error ? err.message : String(err);
      const why = /balance|locked|quota|402|403/i.test(msg) ? "the video provider is temporarily unavailable" : "something went wrong on our side";
      return bad(`It couldn't be started: ${why}. Your credits were refunded.`, 502, { detail: msg.slice(0, 300) });
    }
    return NextResponse.json({ success: true, id, credits });
  }

  return bad("Unknown action.");
}
