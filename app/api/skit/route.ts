// app/api/skit/route.ts — skits with dialogue (lib/skit/skit.ts).
//   GET [?id=] → your recent skits (a running one is moved one step along)
//   POST {action:"plan", script, orientation} → cast + shot list + price (saved as a draft, free)
//   POST {action:"start", id, rights:true} → charge and make it

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/api-keys";
import { isFullVideoEnabled, isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { hasPurchased, isWatermarkExempt } from "@/lib/pipeline/watermark-policy";
import { SKIT_MAX_SCRIPT, advanceSkitJob, estimateSeconds, planSkit, skitCredits, type SkitRow } from "@/lib/skit/skit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ success: false, error, ...extra }, { status });
const MAX_RUNNING = 2;
const PLANS_PER_HOUR = 20;
const planCalls = new Map<string, number[]>();

function view(r: SkitRow) {
  const plan = r.plan;
  const shots = plan?.shots ?? [];
  return {
    id: r.id,
    status: r.status,
    phase: r.phase,
    title: plan?.title ?? "Skit",
    vertical: r.vertical,
    credits: r.credits || skitCredits(plan),
    seconds: Math.round(estimateSeconds(plan).total),
    characters: (plan?.characters ?? []).map((c) => ({ id: c.id, name: c.name, look: c.look, voice: c.voice })),
    shots: shots.map((s) => ({
      id: s.id,
      camera: s.camera,
      speaker: plan.characters.find((c) => c.id === s.speaker)?.name ?? null,
      line: s.line,
      action: s.action,
      sfx: s.sfx,
      crowd: s.crowd ?? "",
      imageUrl: s.imageUrl ?? null,
      ready: Boolean(s.clipUrl || s.clipFailed),
    })),
    phaseAt: plan?.phaseAt ?? {},
    updatedAt: r.updated_at,
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
    const { data } = await db.from("skit_jobs").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (!data) return bad("Not found", 404);
    return NextResponse.json({ success: true, skit: view(await advanceSkitJob(db, data as SkitRow)) });
  }
  const { data } = await db.from("skit_jobs").select("*").eq("user_id", user.id).neq("status", "draft").order("created_at", { ascending: false }).limit(20);
  return NextResponse.json({ success: true, allowed: await allowedFor(db, user.id), maxChars: SKIT_MAX_SCRIPT, skits: ((data ?? []) as SkitRow[]).map(view) });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  if (!isGenerationEnabled(user.id) || !isFullVideoEnabled(user.id)) return bad(LAUNCH_LOCK_MESSAGE, 403);
  const db = adminDb();
  if (!(await allowedFor(db, user.id))) return bad("Skits are available on any plan or pack.", 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "plan") {
    const script = typeof body.script === "string" ? body.script.trim() : "";
    if (script.length < 10) return bad("Write the joke or scene, with the lines people say.");
    if (script.length > SKIT_MAX_SCRIPT) return bad(`Keep it under ${SKIT_MAX_SCRIPT} characters.`);
    const now = Date.now();
    const recent = (planCalls.get(user.id) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= PLANS_PER_HOUR) return bad("That's a lot of tries — wait a little and try again.", 429);
    planCalls.set(user.id, [...recent, now]);
    try {
      const { GEMINI_VOICES } = await import("@/lib/pipeline/gemini-tts");
      const plan = await planSkit(script, GEMINI_VOICES);
      const id = randomUUID();
      const { error } = await db.from("skit_jobs").insert({
        id,
        user_id: user.id,
        status: "draft",
        phase: "cast",
        script,
        plan,
        vertical: body.orientation !== "horizontal",
        credits: 0,
      });
      if (error) throw new Error(error.message);
      const { data } = await db.from("skit_jobs").select("*").eq("id", id).single();
      return NextResponse.json({ success: true, skit: view(data as SkitRow) });
    } catch (err) {
      console.error("[skit] plan failed:", err);
      return bad(err instanceof Error && /script|lines|speaking/.test(err.message) ? err.message : "The scene couldn't be planned. Try again.", 502);
    }
  }

  if (body.action === "start") {
    if (body.rights !== true) return bad("Confirm the checkbox first.");
    const { data } = await db.from("skit_jobs").select("*").eq("id", String(body.id ?? "")).eq("user_id", user.id).eq("status", "draft").maybeSingle();
    const row = data as SkitRow | null;
    if (!row) return bad("Plan the skit first.");
    const { count } = await db.from("skit_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "running");
    if ((count ?? 0) >= MAX_RUNNING) return bad(`Up to ${MAX_RUNNING} skits are made at a time. Try again when one finishes.`, 429);
    const credits = skitCredits(row.plan);
    const { payerFor } = await import("@/lib/teams");
    const payer = await payerFor(db, user.id);
    const { data: paid, error: payErr } = await db.rpc("deduct_credits", { p_user_id: payer, p_amount: credits, p_reason: `Skit: ${row.plan.title}` });
    if (payErr) return bad(payErr.message, 500);
    if (!paid) return bad(`Not enough credits — this skit costs ${credits}.`, 402, { code: "insufficient_credits" });
    const { data: started } = await db
      .from("skit_jobs")
      .update({ status: "running", credits, billed_to: payer !== user.id ? payer : null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (!started) {
      await db.rpc("add_credits", { p_user_id: payer, p_amount: credits, p_type: "refund", p_reason: "Refund: skit could not start" });
      return bad("This skit was already started.", 409);
    }
    return NextResponse.json({ success: true, id: row.id, credits });
  }

  return bad("Unknown action.");
}
