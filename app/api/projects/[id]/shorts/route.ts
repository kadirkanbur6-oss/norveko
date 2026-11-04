// app/api/projects/[id]/shorts/route.ts
// Long video → Shorts (2 Nov 2026):
//   GET  → can this video be cut, the suggested moments, Shorts already made
//   POST {action:"suggest"} → AI picks the moments that work on their own (free)
//   POST {action:"make", index} → render that moment as a vertical Short (render credits only)

import { NextResponse, after, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { isFullVideoEnabled, isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { MAX_SHORTS_PER_VIDEO, SHORT_MAX_SECONDS, SHORT_MIN_SECONDS, SHORT_FORM_MAX_SECONDS, shortJob } from "@/lib/pipeline/steps";
import { SCRIPT_MODEL } from "@/lib/pipeline/llm";
import { kickJob } from "@/lib/pipeline/runner";
import type { CaptionCue } from "@/lib/pipeline/captions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** How many times the moments can be picked again for one video. */
const MAX_SUGGESTIONS = 5;
/** Shorts rendering at the same time for one account. */
const MAX_RUNNING_SHORTS = 3;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

type Pick = { from: number; to: number; title: string; hook: string };
type SourceJob = {
  id: string;
  user_id: string;
  idea: string;
  style: string | null;
  output_language: string | null;
  options: Record<string, unknown> | null;
  steps: Record<string, Record<string, unknown>>;
};

async function sourceFor(userId: string, projectId: string): Promise<{ job: SourceJob | null; reason?: string }> {
  const { data } = await admin()
    .from("pipeline_jobs")
    .select("id, user_id, idea, style, output_language, options, steps")
    .eq("user_id", userId)
    .eq("steps->result->>project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = (data as SourceJob | null) ?? null;
  if (!job || !job.steps?.render || !Array.isArray(job.steps?.video?.slots)) return { job: null };
  if (job.options?.short) return { job: null };
  const total = Number(job.steps.video.total_seconds) || 0;
  if (total <= SHORT_FORM_MAX_SECONDS + 5) return { job: null, reason: "Already short." };
  if (job.steps.render.status !== "completed") return { job: null, reason: "Cut Shorts once the video has finished rendering." };
  const cues = job.steps.voiceover?.captions;
  if (!Array.isArray(cues) || cues.length < 5) return { job: null, reason: "This video has no timed narration to cut from." };
  return { job };
}

async function existingShorts(userId: string, sourceJobId: string) {
  const { data } = await admin()
    .from("pipeline_jobs")
    .select("id, status, options->short, steps->result")
    .eq("user_id", userId)
    .eq("options->short->>sourceJobId", sourceJobId)
    .order("created_at", { ascending: true })
    .limit(30);
  return (data ?? []).map((row) => {
    const short = (row.short ?? {}) as { from?: number; to?: number; title?: string };
    return {
      jobId: row.id as string,
      status: row.status as string,
      from: Number(short.from) || 0,
      to: Number(short.to) || 0,
      title: short.title ?? "",
      projectId: ((row.result as { project_id?: string } | null)?.project_id as string | undefined) ?? null,
    };
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const { job, reason } = await sourceFor(user.id, id);
  if (!job) return NextResponse.json({ success: true, available: false, reason: reason ?? null });
  const stored = (job.steps.shorts ?? {}) as { picks?: Pick[]; runs?: number };
  const picks = stored.picks ?? [];
  return NextResponse.json({
    success: true,
    available: isGenerationEnabled(user.id) && isFullVideoEnabled(user.id),
    suggestionsLeft: Math.max(0, MAX_SUGGESTIONS - (stored.runs ?? 0)),
    picks: picks.map((p) => ({ ...p, credits: shortJob({ seconds: p.to - p.from }).total })),
    shorts: await existingShorts(user.id, job.id),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  if (!isGenerationEnabled(user.id) || !isFullVideoEnabled(user.id)) {
    return NextResponse.json({ success: false, error: LAUNCH_LOCK_MESSAGE }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { job: source, reason } = await sourceFor(user.id, id);
  if (!source) return NextResponse.json({ success: false, error: reason ?? "Only finished long videos can be cut into Shorts." }, { status: 400 });
  const db = admin();
  const stored = (source.steps.shorts ?? {}) as { picks?: Pick[]; runs?: number };
  const cues = source.steps.voiceover!.captions as CaptionCue[];

  if (body.action === "suggest") {
    if ((stored.runs ?? 0) >= MAX_SUGGESTIONS) {
      return NextResponse.json({ success: false, error: "You've picked moments for this video enough times." }, { status: 429 });
    }
    const { pickShortClips } = await import("@/lib/pipeline/openai");
    const { picks } = await pickShortClips({
      cues,
      outputLanguage: source.output_language ?? "English",
      count: MAX_SHORTS_PER_VIDEO,
      minSeconds: SHORT_MIN_SECONDS + 5,
      maxSeconds: SHORT_MAX_SECONDS - 1,
      model: SCRIPT_MODEL,
    });
    if (!picks.length) return NextResponse.json({ success: false, error: "No good standalone moments were found. Try again." }, { status: 422 });
    // Cut on the narration's own pauses: a little air before the first word, after the last.
    const total = Number(source.steps.video?.total_seconds) || cues[cues.length - 1].end;
    const next: Pick[] = picks.map((p) => {
      const from = Math.max(0, Math.round((cues[p.firstCue].start - 0.15) * 100) / 100);
      const to = Math.min(total, Math.round((cues[p.lastCue].end + 0.5) * 100) / 100, from + SHORT_MAX_SECONDS);
      return { from, to, title: p.title, hook: p.hook };
    });
    const { error } = await db
      .from("pipeline_jobs")
      .update({ steps: { ...source.steps, shorts: { picks: next, runs: (stored.runs ?? 0) + 1, at: new Date().toISOString() } } })
      .eq("id", source.id);
    if (error) return NextResponse.json({ success: false, error: "Could not save the moments." }, { status: 500 });
    return NextResponse.json({ success: true, picks: next.map((p) => ({ ...p, credits: shortJob({ seconds: p.to - p.from }).total })) });
  }

  if (body.action === "make") {
    const index = Number(body.index);
    const pick = Number.isInteger(index) ? stored.picks?.[index] : undefined;
    if (!pick) return NextResponse.json({ success: false, error: "Pick a moment first." }, { status: 400 });
    const shorts = await existingShorts(user.id, source.id);
    if (shorts.some((s) => s.status !== "failed" && Math.abs(s.from - pick.from) < 0.5 && Math.abs(s.to - pick.to) < 0.5)) {
      return NextResponse.json({ success: false, error: "This Short is already made." }, { status: 409 });
    }
    const { count: running } = await db
      .from("pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "running")
      .not("options->short", "is", null);
    if ((running ?? 0) >= MAX_RUNNING_SHORTS) {
      return NextResponse.json({ success: false, error: `Up to ${MAX_RUNNING_SHORTS} Shorts are made at a time. Try again in a minute.` }, { status: 429 });
    }

    const seconds = pick.to - pick.from;
    const { steps, total, duration } = shortJob({ seconds, subtitles: body.subtitles !== false });
    steps.script = { ...steps.script, queued_at: new Date().toISOString() };
    const music = source.steps.render?.music as { id?: string } | null | undefined;
    if (music?.id) steps.render = { ...steps.render, music_id: music.id };

    const { payerFor } = await import("@/lib/teams");
    const payer = await payerFor(db, user.id);
    const { data: deducted, error: deductError } = await db.rpc("deduct_credits", {
      p_user_id: payer,
      p_amount: total,
      p_reason: `Short from a long video (${Math.round(seconds)} s render)`,
    });
    if (deductError) return NextResponse.json({ success: false, error: deductError.message }, { status: 500 });
    if (!deducted) {
      return NextResponse.json({ success: false, code: "insufficient_credits", error: `Not enough credits — a Short costs ${total}.` }, { status: 402 });
    }

    const o = source.options ?? {};
    const { data: job, error } = await db
      .from("pipeline_jobs")
      .insert({
        user_id: user.id,
        idea: pick.title || source.idea,
        platform: "YouTube Shorts",
        style: source.style,
        duration,
        output_language: source.output_language,
        options: {
          orientation: "vertical",
          visualStyle: o.visualStyle,
          captionStyle: o.captionStyle,
          brand: o.brand,
          fullVideo: true,
        billedTo: payer !== user.id ? payer : undefined,
          footage: "stills",
          short: { sourceJobId: source.id, from: pick.from, to: pick.to, title: pick.title, hook: pick.hook },
        },
        status: "running",
        current_step: "script",
        steps,
        credits_charged: total,
      })
      .select("id")
      .single();
    if (error || !job) {
      await db.rpc("add_credits", { p_user_id: payer, p_amount: total, p_type: "refund", p_reason: "Refund: Short could not be started" });
      return NextResponse.json({ success: false, error: "Could not start the Short." }, { status: 500 });
    }
    after(() => kickJob(job.id));
    return NextResponse.json({ success: true, jobId: job.id, credits: total });
  }

  return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
}
