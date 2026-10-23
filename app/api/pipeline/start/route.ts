// app/api/pipeline/start/route.ts
// Starts a pipeline job: validates input, charges credits, inserts the job
// and hands it to the background worker. Returns immediately with the jobId;
// the UI polls /api/pipeline/[id] for progress.

import { NextRequest, NextResponse, after } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  buildPipelineSteps,
  totalPipelineCredits,
  initialStepsState,
} from "@/lib/pipeline/steps";
import { kickJob } from "@/lib/pipeline/runner";
import { DURATIONS, LANGUAGES, PLATFORMS, STYLES, isOneOf } from "@/lib/pipeline/options";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const MAX_IDEA_LENGTH = 1000;

export async function POST(req: NextRequest) {
  try {
    // 1) Authenticate
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {},
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // 2) Validate input
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) ?? {};
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid request body." },
        { status: 400 }
      );
    }

    const idea = typeof body.idea === "string" ? body.idea.trim() : "";
    if (idea.length < 3) {
      return NextResponse.json(
        { success: false, error: "Please provide a video idea." },
        { status: 400 }
      );
    }
    if (idea.length > MAX_IDEA_LENGTH) {
      return NextResponse.json(
        { success: false, error: `Idea is too long (max ${MAX_IDEA_LENGTH} characters).` },
        { status: 400 }
      );
    }

    if (
      !isOneOf(PLATFORMS, body.platform) ||
      !isOneOf(STYLES, body.style) ||
      !isOneOf(DURATIONS, body.duration) ||
      !isOneOf(LANGUAGES, body.outputLanguage)
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid platform, style, duration or language." },
        { status: 400 }
      );
    }
    const platform = body.platform;
    const style = body.style;
    const duration = body.duration;
    const outputLanguage = body.outputLanguage;

    const voiceoverEnabled = body.includeVoiceover === true;
    const voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";

    if (voiceoverEnabled) {
      if (!voiceId) {
        return NextResponse.json(
          { success: false, error: "Please select a voice for the voiceover." },
          { status: 400 }
        );
      }
      const { listVoices } = await import("@/lib/pipeline/elevenlabs");
      const voices = await listVoices();
      if (!voices.some((voice) => voice.voice_id === voiceId)) {
        return NextResponse.json(
          { success: false, error: "Selected voice is not available." },
          { status: 400 }
        );
      }
    }

    // 3) Reject if the user already has a job in flight (cheap rate limit)
    const { count: inFlight } = await supabaseAdmin
      .from("pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "running");

    if ((inFlight ?? 0) >= 2) {
      return NextResponse.json(
        {
          success: false,
          error: "You already have generations in progress. Please wait for them to finish.",
        },
        { status: 429 }
      );
    }

    // 4) Charge credits
    const cost = totalPipelineCredits(voiceoverEnabled);
    const { data: deducted, error: deductError } = await supabaseAdmin.rpc(
      "deduct_credits",
      {
        p_user_id: user.id,
        p_amount: cost,
        p_reason: `AI pipeline generation (content package + thumbnail${voiceoverEnabled ? " + voiceover" : ""})`,
      }
    );

    if (deductError) {
      throw new Error(deductError.message);
    }

    if (!deducted) {
      return NextResponse.json(
        {
          success: false,
          error: `Not enough credits. This generation costs ${cost} credits. Please top up your balance.`,
        },
        { status: 402 }
      );
    }

    // 5) Insert the job with every step pending
    const steps = initialStepsState(voiceoverEnabled) as Record<string, Record<string, unknown>>;
    const firstStep = buildPipelineSteps(voiceoverEnabled)[0];
    steps[firstStep.id] = { ...steps[firstStep.id], queued_at: new Date().toISOString() };
    if (voiceoverEnabled) {
      steps.voiceover = { ...steps.voiceover, voice_id: voiceId };
    }

    const { data: job, error: jobError } = await supabaseAdmin
      .from("pipeline_jobs")
      .insert({
        user_id: user.id,
        idea,
        platform,
        style,
        duration,
        output_language: outputLanguage,
        status: "running",
        current_step: firstStep.id,
        steps,
        credits_charged: cost,
      })
      .select("id")
      .single();

    if (jobError || !job) {
      await supabaseAdmin.rpc("add_credits", {
        p_user_id: user.id,
        p_amount: cost,
        p_type: "refund",
        p_reason: "Refund: pipeline job could not be created",
      });
      return NextResponse.json(
        { success: false, error: "Could not create job." },
        { status: 500 }
      );
    }

    // 6) Hand off to the worker after the response is sent
    after(() => kickJob(job.id));

    return NextResponse.json({ success: true, jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[pipeline] start failed:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
