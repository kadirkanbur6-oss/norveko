// app/api/pipeline/start/route.ts
// Starts a pipeline job: validates input, charges credits, inserts the job
// and hands it to the background worker. Returns immediately with the jobId;
// the UI polls /api/pipeline/[id] for progress.

import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import {
  buildPipelineSteps,
  FOOTAGE_MODES,
  CLIP_MODES,
  type ClipMode,
  fullVideoPlan,
  resolvePipelineOptions,
  totalPipelineCredits,
  type FootageMode,
  type PipelineOptions,
  initialStepsState,
} from "@/lib/pipeline/steps";
import { kickJob } from "@/lib/pipeline/runner";
import {
  isGenerationEnabled,
  isFullVideoEnabled, isVideoGenerationEnabled,
  LAUNCH_LOCK_MESSAGE,
} from "@/lib/pipeline/features";
import { DURATIONS, LANGUAGES, PLATFORMS, STYLES, ORIENTATIONS, defaultOrientation, isOneOf } from "@/lib/pipeline/options";
import { getTemplate } from "@/lib/pipeline/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const MAX_IDEA_LENGTH = 1000;
const MAX_JOBS_PER_HOUR = 10;

export async function POST(req: NextRequest) {
  try {
    // 1) Authenticate
    const { user } = await requireUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Launch lock: reject before reading the body or touching credits.
    if (!isGenerationEnabled(user.id)) {
      return NextResponse.json(
        { success: false, error: LAUNCH_LOCK_MESSAGE },
        { status: 403 }
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
    // Optional creator notes for the writer (angle, focus, things to avoid).
    const notes =
      typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().replace(/\s+/g, " ").slice(0, 500) : null;
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

    const orientationIds = ORIENTATIONS.map((o) => o.id) as readonly string[];
    const orientation =
      typeof body.orientation === "string" && orientationIds.includes(body.orientation)
        ? (body.orientation as "vertical" | "horizontal")
        : defaultOrientation(platform);
    const template = getTemplate(typeof body.template === "string" ? body.template : null)?.id ?? null;

    const voiceoverEnabled = body.includeVoiceover === true;
    let voiceId = typeof body.voiceId === "string" ? body.voiceId.trim() : "";
    const voicePublicOwnerId =
      typeof body.voicePublicOwnerId === "string" ? body.voicePublicOwnerId.trim() : "";
    const voiceName = typeof body.voiceName === "string" ? body.voiceName.trim() : "";
    const fullVideoRequested = body.includeFullVideo === true;
    const footage: FootageMode = FOOTAGE_MODES.includes(body.footage as FootageMode)
      ? (body.footage as FootageMode)
      : "hybrid";
    const clipMode: ClipMode = CLIP_MODES.includes(body.clipMode as ClipMode) ? (body.clipMode as ClipMode) : "image";
    const videoRequested = !fullVideoRequested && body.includeVideo === true;
    const subtitlesRequested = voiceoverEnabled && body.includeSubtitles === true;

    // Video generation is gated. Rejecting here means a disabled feature can
    // never reach the credit deduction below.
    if (videoRequested && !isVideoGenerationEnabled(user.id)) {
      return NextResponse.json(
        { success: false, error: "Video generation is not available yet." },
        { status: 403 }
      );
    }
    if (fullVideoRequested && !isFullVideoEnabled(user.id)) {
      return NextResponse.json(
        { success: false, error: "Full video rendering is in private beta." },
        { status: 403 }
      );
    }
    if (fullVideoRequested && !fullVideoPlan(duration, footage)) {
      return NextResponse.json(
        { success: false, error: "Full videos are available for 30 and 60 second durations for now." },
        { status: 400 }
      );
    }
    const options: PipelineOptions = {
      research: body.includeResearch !== false,
      voiceover: voiceoverEnabled || fullVideoRequested,
      subtitles: subtitlesRequested || fullVideoRequested,
      video: videoRequested,
      fullVideo: fullVideoRequested,
      footage,
      clipMode,
      duration,
    };
    const resolved = resolvePipelineOptions(options);

    if (resolved.voiceover) {
      if (!voiceId) {
        return NextResponse.json(
          { success: false, error: "Please select a voice for the voiceover." },
          { status: 400 }
        );
      }
      const { isGeminiVoiceId, geminiVoiceName } = await import("@/lib/pipeline/gemini-tts");
      if (isGeminiVoiceId(voiceId)) {
        // Gemini narrators are built in: only the name has to be known.
        if (!geminiVoiceName(voiceId)) {
          return NextResponse.json({ success: false, error: "Selected voice is not available." }, { status: 400 });
        }
      } else {
        const { listVoices, addLibraryVoice, getSubscriptionTier } = await import(
          "@/lib/pipeline/elevenlabs"
        );
        if (voicePublicOwnerId) {
          // A Voice Library pick: make it usable for TTS before charging anything.
          try {
            voiceId = await addLibraryVoice(voicePublicOwnerId, voiceId, voiceName || "Norveko voice");
          } catch (err) {
            console.error("[pipeline] library voice add failed:", err);
            const detail = err instanceof Error ? err.message : "";
            const permission = /voices_write|missing_permissions/i.test(detail);
            return NextResponse.json(
              {
                success: false,
                error: permission
                  ? "Library voices aren't enabled on this deployment yet. Please pick a voice without the Library badge."
                  : "This voice could not be added right now. Please pick another voice.",
              },
              { status: 400 }
            );
          }
        }
        const voices = await listVoices();
        const chosen = voices.find((voice) => voice.voice_id === voiceId);
        if (!chosen) {
          return NextResponse.json(
            { success: false, error: "Selected voice is not available." },
            { status: 400 }
          );
        }
        // Library-origin voices (anything not "premade") fail at TTS time on the
        // ElevenLabs free tier (402 paid_plan_required). Refuse BEFORE charging
        // credits rather than failing the job later.
        if (chosen.category !== "premade") {
          const tier = await getSubscriptionTier().catch(() => null);
          const libraryAllowed = tier
            ? tier !== "free"
            : process.env.ELEVENLABS_LIBRARY_VOICES === "true";
          if (!libraryAllowed) {
            return NextResponse.json(
              {
                success: false,
                error: "This voice isn't available on the current plan. Please pick another voice.",
              },
              { status: 400 }
            );
          }
        }
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

    // Per-user throughput cap: at most MAX_JOBS_PER_HOUR generations per rolling hour.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recent } = await supabaseAdmin
      .from("pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", hourAgo);

    if ((recent ?? 0) >= MAX_JOBS_PER_HOUR) {
      return NextResponse.json(
        {
          success: false,
          error: `You've reached the limit of ${MAX_JOBS_PER_HOUR} generations per hour. Please try again a little later.`,
        },
        { status: 429 }
      );
    }

    // 4) Charge credits
    const cost = totalPipelineCredits(options);
    const { data: deducted, error: deductError } = await supabaseAdmin.rpc(
      "deduct_credits",
      {
        p_user_id: user.id,
        p_amount: cost,
        p_reason: `AI pipeline generation (${resolved.research ? "research + " : ""}content package + thumbnail${resolved.voiceover ? " + voiceover" : ""}${resolved.subtitles ? " + subtitles" : ""}${resolved.fullVideo ? ` + full video (${footage}${footage === "stills" ? "" : `, ${clipMode === "text" ? "text→video" : "image→video"}`})` : ""}${videoRequested ? " + video clips" : ""})`,
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
    const steps = initialStepsState(options) as Record<string, Record<string, unknown>>;
    const firstStep = buildPipelineSteps(options)[0];
    steps[firstStep.id] = { ...steps[firstStep.id], queued_at: new Date().toISOString() };
    if (resolved.voiceover) {
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
        options: { orientation, template, notes, fullVideo: resolved.fullVideo, footage: resolved.fullVideo ? footage : undefined, clipMode: resolved.fullVideo ? clipMode : undefined },
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
