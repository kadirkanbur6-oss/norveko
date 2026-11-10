// app/api/ambient/route.ts — Ambient music video (lib/ambient/ambient.ts).
//   GET [?id=] → your recent videos (moves a running one along)
//   POST {action:"start", idea, minutes: 10|30|60|120}

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/api-keys";
import { isFullVideoEnabled, isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { hasPurchased, isWatermarkExempt } from "@/lib/pipeline/watermark-policy";
import { advanceSwapJob, type SwapRow } from "@/lib/swap/swap";
import { AMBIENT_MAX_CHARS, ambientCredits, initialState, isAmbientMinutes, readState } from "@/lib/ambient/ambient";
import { AMBIENT_MINUTES } from "@/lib/skit/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ success: false, error, ...extra }, { status });
const MAX_RUNNING = 1;

function view(r: SwapRow) {
  const s = readState(r);
  return {
    id: r.id,
    status: r.status,
    prompt: r.prompt,
    minutes: s.minutes,
    songs: s.tracks.length,
    songsNeeded: s.needed,
    parts: s.parts.length,
    phase: r.phase,
    credits: r.credits,
    outputUrl: r.output_url,
    projectId: r.project_id,
    error: r.error,
    createdAt: r.created_at,
  };
}

async function allowedFor(db: ReturnType<typeof adminDb>, userId: string) {
  return isGenerationEnabled(userId) && isFullVideoEnabled(userId) && (isWatermarkExempt(userId) || (await hasPurchased(db, userId)));
}

export async function GET(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  const db = adminDb();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data } = await db.from("swap_jobs").select("*").eq("id", id).eq("user_id", user.id).eq("kind", "ambient").maybeSingle();
    if (!data) return bad("Not found", 404);
    return NextResponse.json({ success: true, video: view(await advanceSwapJob(db, data as SwapRow)) });
  }
  const { data } = await db.from("swap_jobs").select("*").eq("user_id", user.id).eq("kind", "ambient").order("created_at", { ascending: false }).limit(20);
  return NextResponse.json({
    success: true,
    allowed: await allowedFor(db, user.id),
    maxChars: AMBIENT_MAX_CHARS,
    options: AMBIENT_MINUTES.map((m) => ({ minutes: m, credits: ambientCredits(m) })),
    videos: ((data ?? []) as SwapRow[]).map(view),
  });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  if (!isGenerationEnabled(user.id) || !isFullVideoEnabled(user.id)) return bad(LAUNCH_LOCK_MESSAGE, 403);
  const db = adminDb();
  if (!(await allowedFor(db, user.id))) return bad("Ambient music videos are available once you have bought a plan or pack.", 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action !== "start") return bad("Unknown action.");

  const idea = typeof body.idea === "string" ? body.idea.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, AMBIENT_MAX_CHARS) : "";
  if (idea.length < 5) return bad("Describe the music and the scene in a few words.");
  const minutes = Number(body.minutes);
  if (!isAmbientMinutes(minutes)) return bad("Pick 10, 30, 60 or 120 minutes.");

  const { count } = await db.from("swap_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "running").eq("kind", "ambient");
  if ((count ?? 0) >= MAX_RUNNING) return bad("One ambient video is made at a time. Try again when it finishes.", 429);

  const { isFreeAccount } = await import("@/lib/pipeline/trial");
  if (await isFreeAccount(db, user.id)) {
    const { FREE_PLAN_UPGRADE_MESSAGE } = await import("@/lib/plans");
    return NextResponse.json({ success: false, error: FREE_PLAN_UPGRADE_MESSAGE, code: "upgrade_required" }, { status: 403 });
  }

  const credits = ambientCredits(minutes);
  const { payerFor } = await import("@/lib/teams");
  const payer = await payerFor(db, user.id);
  const { data: paid, error: payErr } = await db.rpc("deduct_credits", {
    p_user_id: payer,
    p_amount: credits,
    p_reason: `Ambient music video (${minutes} min)`,
  });
  if (payErr) return bad(payErr.message, 500);
  if (!paid) return bad(`Not enough credits. This costs ${credits}.`, 402, { code: "insufficient_credits" });

  const id = randomUUID();
  const { error } = await db.from("swap_jobs").insert({
    id,
    kind: "ambient",
    user_id: user.id,
    billed_to: payer !== user.id ? payer : null,
    status: "running",
    phase: "swap",
    source_path: "",
    source_seconds: minutes * 60,
    vertical: false,
    character_id: null,
    character_name: "Ambient music video",
    prompt: idea,
    fal: initialState(minutes),
    credits,
  });
  if (error) {
    console.error("[ambient] start failed:", error);
    await db.rpc("add_credits", { p_user_id: payer, p_amount: credits, p_type: "refund", p_reason: "Refund: ambient music video could not start" });
    return bad("It couldn't be started. Your credits were refunded.", 502, { detail: error.message.slice(0, 300) });
  }
  return NextResponse.json({ success: true, id, credits });
}
