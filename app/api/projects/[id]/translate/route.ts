// app/api/projects/[id]/translate/route.ts
// One-click translation of a finished full video (2 Nov 2026):
//   GET  → can it be translated, the price per voice engine, earlier translations
//   POST {language, voiceId} → new job: translated script + new voice-over and
//        subtitles over the ORIGINAL visuals and thumbnail, rendered as a new project.

import { NextResponse, after, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { isFullVideoEnabled, isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { LANGUAGES, isOneOf } from "@/lib/pipeline/options";
import { translationJob, type FootageMode, type ClipMode } from "@/lib/pipeline/steps";
import { kickJob } from "@/lib/pipeline/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

type SourceJob = {
  id: string;
  user_id: string;
  idea: string;
  platform: string | null;
  style: string | null;
  duration: string | null;
  output_language: string | null;
  options: Record<string, unknown> | null;
  steps: Record<string, Record<string, unknown>>;
};

/** The finished full video behind a project (owned by the user), or why it can't be translated. */
async function sourceFor(userId: string, projectId: string): Promise<{ job: SourceJob | null; reason?: string }> {
  const { data } = await admin()
    .from("pipeline_jobs")
    .select("id, user_id, idea, platform, style, duration, output_language, options, steps")
    .eq("user_id", userId)
    .eq("steps->result->>project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = (data as SourceJob | null) ?? null;
  if (!job) return { job: null, reason: "Only videos made with Norveko's full video can be translated." };
  const slots = job.steps?.video?.slots;
  if (!job.steps?.render || !Array.isArray(slots) || !slots.length) {
    return { job: null, reason: "Only finished full videos can be translated." };
  }
  if (job.steps.render.status !== "completed" || typeof job.steps.render.video_url !== "string") {
    return { job: null, reason: "Translate the video once it has finished rendering." };
  }
  return { job };
}

function planOf(job: SourceJob) {
  const plan = (job.steps.video?.plan ?? {}) as { footage?: FootageMode; clipMode?: ClipMode; duration?: string };
  return { footage: plan.footage ?? "stills", clipMode: plan.clipMode ?? "image", duration: plan.duration ?? job.duration ?? "60 seconds" };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const { job, reason } = await sourceFor(user.id, id);
  if (!job) return NextResponse.json({ success: true, available: false, reason });
  const p = planOf(job);
  const price = (voiceEngine: "gemini" | "elevenlabs") => translationJob({ ...p, voiceEngine }).total;

  // Earlier translations of this video (newest first).
  const { data: done } = await admin()
    .from("pipeline_jobs")
    .select("id, status, output_language, steps->result")
    .eq("user_id", user.id)
    .eq("options->translate->>sourceJobId", job.id)
    .order("created_at", { ascending: false })
    .limit(30);

  return NextResponse.json({
    success: true,
    available: isGenerationEnabled(user.id) && isFullVideoEnabled(user.id),
    from: job.output_language ?? "English",
    prices: { gemini: price("gemini"), elevenlabs: price("elevenlabs") },
    translations: (done ?? []).map((t) => ({
      jobId: t.id,
      status: t.status,
      language: t.output_language,
      projectId: (t.result as { project_id?: string } | null)?.project_id ?? null,
    })),
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
  if (!source) return NextResponse.json({ success: false, error: reason }, { status: 400 });

  if (!isOneOf(LANGUAGES, body.language)) {
    return NextResponse.json({ success: false, error: "Pick a language." }, { status: 400 });
  }
  const language = body.language;
  if (language === (source.output_language ?? "English")) {
    return NextResponse.json({ success: false, error: "The video is already in this language." }, { status: 400 });
  }

  // Voices: the Norveko narrators (every language) or the creator's own cloned voice.
  const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
  const db = admin();
  const { isGeminiVoiceId, geminiVoiceName } = await import("@/lib/pipeline/gemini-tts");
  let voiceEngine: "gemini" | "elevenlabs" = "gemini";
  if (isGeminiVoiceId(voiceId)) {
    if (!geminiVoiceName(voiceId)) return NextResponse.json({ success: false, error: "Unknown voice." }, { status: 400 });
  } else {
    const { cloneOwners } = await import("@/lib/voice/clones");
    const owners = await cloneOwners(db).catch(() => new Map<string, string>());
    if (!voiceId || owners.get(voiceId) !== user.id) {
      return NextResponse.json({ success: false, error: "Pick one of the narrators or your own voice." }, { status: 400 });
    }
    voiceEngine = "elevenlabs";
  }

  // One generation at a time (same rule as /api/pipeline/start).
  const { data: inFlight } = await db
    .from("pipeline_jobs")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "running")
    .is("options->series", null)
      .is("options->short", null)
    .limit(1)
    .maybeSingle();
  if (inFlight) {
    return NextResponse.json(
      { success: false, code: "job_in_progress", jobId: inFlight.id, error: "Your video is still being made. You can start the next one when it finishes." },
      { status: 429 }
    );
  }

  const p = planOf(source);
  const { steps, total, items } = translationJob({ ...p, voiceEngine });
  steps.script = { ...steps.script, queued_at: new Date().toISOString() };
  steps.voiceover = { ...steps.voiceover, voice_id: voiceId };
  // Same music as the original.
  const music = source.steps.render?.music as { id?: string } | null | undefined;
  if (music?.id) steps.render = { ...steps.render, music_id: music.id };

  const { data: deducted, error: deductError } = await db.rpc("deduct_credits", {
    p_user_id: user.id,
    p_amount: total,
    p_reason: `Translate video to ${language} (${items.map((i) => i.label.toLowerCase()).join(" + ")})`,
  });
  if (deductError) return NextResponse.json({ success: false, error: deductError.message }, { status: 500 });
  if (!deducted) {
    return NextResponse.json({ success: false, code: "insufficient_credits", error: `Not enough credits — translating this video costs ${total}.` }, { status: 402 });
  }

  const srcOptions = source.options ?? {};
  const { data: job, error } = await db
    .from("pipeline_jobs")
    .insert({
      user_id: user.id,
      idea: source.idea,
      platform: source.platform,
      style: source.style,
      duration: p.duration,
      output_language: language,
      options: {
        orientation: srcOptions.orientation,
        template: srcOptions.template,
        visualStyle: srcOptions.visualStyle,
        captionStyle: srcOptions.captionStyle,
        brand: srcOptions.brand,
        fullVideo: true,
        footage: p.footage,
        clipMode: p.clipMode,
        translate: { sourceJobId: source.id, fromLanguage: source.output_language ?? "English" },
      },
      status: "running",
      current_step: "script",
      steps,
      credits_charged: total,
    })
    .select("id")
    .single();

  if (error || !job) {
    await db.rpc("add_credits", { p_user_id: user.id, p_amount: total, p_type: "refund", p_reason: "Refund: translation could not be started" });
    return NextResponse.json({ success: false, error: "Could not start the translation." }, { status: 500 });
  }

  after(() => kickJob(job.id));
  return NextResponse.json({ success: true, jobId: job.id, credits: total });
}
