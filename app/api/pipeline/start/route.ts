// app/api/pipeline/start/route.ts
// Starts a pipeline job: validates input, charges credits, inserts the job
// and hands it to the background worker. Returns immediately with the jobId;
// the UI polls /api/pipeline/[id] for progress.

import { NextRequest, NextResponse, after } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { brandSnapshot, rowToKit, type BrandSnapshot } from "@/lib/brand/kit";
import { castSnapshot } from "@/lib/characters/characters";
import {
  buildPipelineSteps,
  FOOTAGE_MODES,
  CLIP_MODES,
  type ClipMode,
  fullVideoPlan,
  resolvePipelineOptions,
  totalPipelineCredits,
  isTrialVideoShape,
  type FootageMode,
  SHORT_FORM_MAX_SECONDS,
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
import { isCaptionStyle, isVisualStyle } from "@/lib/pipeline/visual-styles";

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

    // "Make it from a link": a public article/blog page becomes the research brief.
    const { cleanSourceUrl, fetchArticle } = await import("@/lib/pipeline/source-url");
    const sourceUrl = cleanSourceUrl(body.sourceUrl);
    if (body.sourceUrl && typeof body.sourceUrl === "string" && body.sourceUrl.trim() && !sourceUrl) {
      return NextResponse.json({ success: false, error: "That link doesn't look like a web address." }, { status: 400 });
    }
    let sourceTitle = "";
    if (sourceUrl) {
      try {
        sourceTitle = (await fetchArticle(sourceUrl)).title;
      } catch (err) {
        return NextResponse.json(
          { success: false, error: err instanceof Error ? err.message : "We couldn't read that page." },
          { status: 400 }
        );
      }
    }
    let idea = typeof body.idea === "string" ? body.idea.trim() : "";
    if (!idea && sourceUrl) idea = sourceTitle ? `A video about: ${sourceTitle}` : `A video about the article at ${sourceUrl}`;
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
    const visualStyle = isVisualStyle(body.visualStyle) ? body.visualStyle : null;
    const captionStyle = isCaptionStyle(body.captionStyle) ? body.captionStyle : null;

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
    const subtitlesRequested = (voiceoverEnabled || fullVideoRequested) && body.includeSubtitles === true;

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
        { success: false, error: "This footage option isn't available for that duration (long videos use stock, hybrid or stills)." },
        { status: 400 }
      );
    }
    // Long-form full videos are horizontal YouTube videos.
    if (fullVideoRequested && (fullVideoPlan(duration, footage)?.seconds ?? 0) > SHORT_FORM_MAX_SECONDS && orientation !== "horizontal") {
      return NextResponse.json(
        { success: false, error: "Videos longer than 60 seconds are rendered in 16:9 (horizontal)." },
        { status: 400 }
      );
    }
    const options: PipelineOptions = {
      // A linked page is read in the research step, so research is always on with a link.
      research: Boolean(sourceUrl) || body.includeResearch !== false,
      voiceover: voiceoverEnabled || fullVideoRequested,
      subtitles: subtitlesRequested,
      video: videoRequested,
      fullVideo: fullVideoRequested,
      footage,
      clipMode,
      duration,
      // Narration is priced per engine: built-in Gemini narrators vs ElevenLabs voices.
      voiceEngine: voiceId && !voiceId.startsWith("gemini:") ? "elevenlabs" : "gemini",
      // Talking presenter: one of the chosen characters speaks to camera in a few scenes.
      presenter:
        fullVideoRequested &&
        body.presenter === true &&
        typeof body.presenterId === "string" &&
        Array.isArray(body.characterIds) &&
        body.characterIds.includes(body.presenterId),
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
        // Creators' cloned voices: only the owner may use one; never evicted.
        const { cloneOwners } = await import("@/lib/voice/clones");
        const owners = await cloneOwners(supabaseAdmin).catch(() => new Map<string, string>());
        const cloneOwner = owners.get(voiceId);
        if (cloneOwner && cloneOwner !== user.id) {
          return NextResponse.json({ success: false, error: "Selected voice is not available." }, { status: 400 });
        }
        if (voicePublicOwnerId && !cloneOwner) {
          // A Voice Library pick: make it usable for TTS before charging anything.
          try {
            voiceId = await addLibraryVoice(voicePublicOwnerId, voiceId, voiceName || "Norveko voice", new Set(owners.keys()));
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
        // A Norveko clone that isn't in voice_clones for this user (defence in depth).
        if (chosen && !cloneOwner && chosen.name.startsWith("Norveko · ")) {
          return NextResponse.json({ success: false, error: "Selected voice is not available." }, { status: 400 });
        }
        if (!chosen) {
          return NextResponse.json(
            { success: false, error: "Selected voice is not available." },
            { status: 400 }
          );
        }
        // Library-origin voices (anything not "premade") fail at TTS time on the
        // ElevenLabs free tier (402 paid_plan_required). Refuse BEFORE charging
        // credits rather than failing the job later.
        if (chosen.category !== "premade" && !cloneOwner) {
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

    // 3) One generation at a time (series episodes run on their own schedule).
    const { data: inFlight } = await supabaseAdmin
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
        {
          success: false,
          code: "job_in_progress",
          jobId: inFlight.id,
          error: "Your video is still being made. You can start the next one when it finishes.",
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

    // 4) Free accounts (no pack bought yet): abuse checks before any free
    //    credit or the free trial video is spent (lib/pipeline/abuse.ts).
    const { isFreeAccount, trialVideoAvailable } = await import("@/lib/pipeline/trial");
    const freeAccount = await isFreeAccount(supabaseAdmin, user.id);
    let freeMarkers: { freeIp?: string; freeEmail?: string } = {};
    if (freeAccount) {
      const { clientIp, freeJobMarkers, freeUsageBlock } = await import("@/lib/pipeline/abuse");
      const abuseCtx = { email: user.email, ip: clientIp(req.headers) };
      const blocked = await freeUsageBlock(supabaseAdmin, user.id, abuseCtx);
      if (blocked) {
        return NextResponse.json({ success: false, error: blocked, code: "free_tier_blocked" }, { status: 403 });
      }
      freeMarkers = freeJobMarkers(abuseCtx);
      // Free-trial video: one 30 s video per person before any purchase.
      if (resolved.fullVideo && isTrialVideoShape(options) && (await trialVideoAvailable(supabaseAdmin, user.id, abuseCtx))) {
        options.trialVideo = true;
      }
    }

    // Charge credits (nothing for the free-trial video). Team members spend the owner's pool.
    const { payerFor } = await import("@/lib/teams");
    const payer = await payerFor(supabaseAdmin, user.id);
    const cost = totalPipelineCredits(options);
    const { data: deducted, error: deductError } = cost === 0
      ? { data: true, error: null }
      : await supabaseAdmin.rpc(
      "deduct_credits",
      {
        p_user_id: payer,
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

    // Brand kit: copied onto the job so re-renders keep this look.
    let brand: BrandSnapshot | null = null;
    if (body.useBrandKit !== false) {
      const { data: kitRow } = await supabaseAdmin.from("brand_kits").select("*").eq("user_id", user.id).maybeSingle();
      brand = brandSnapshot(rowToKit(kitRow as Record<string, unknown> | null));
      // The end card ("Follow for more…") is its own choice, off unless asked for (6 Nov 2026).
      if (brand && body.endCard !== true) {
        delete brand.outroText;
        if (!Object.keys(brand).length) brand = null;
      }
    }

    // Recurring characters: the chosen ones (the user's own, ≤ 3) are copied onto the job.
    let cast: Awaited<ReturnType<typeof castSnapshot>> = [];
    if (Array.isArray(body.characterIds) && body.characterIds.length) {
      try {
        cast = await castSnapshot(supabaseAdmin, user.id, body.characterIds);
      } catch (err) {
        console.warn("[pipeline/start] cast lookup failed:", err);
      }
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
        options: { orientation, template, notes, sourceUrl: sourceUrl ?? undefined, billedTo: payer !== user.id ? payer : undefined, visualStyle, captionStyle, brand: brand ?? undefined, cast: cast.length ? cast : undefined, presenter: resolved.presenter ? cast.find((c) => c.id === body.presenterId)?.name ?? undefined : undefined, review: resolved.fullVideo && body.review === true ? true : undefined, ...freeMarkers, trialVideo: options.trialVideo === true || undefined, fullVideo: resolved.fullVideo, footage: resolved.fullVideo ? footage : undefined, clipMode: resolved.fullVideo ? clipMode : undefined },
        status: "running",
        current_step: firstStep.id,
        steps,
        credits_charged: cost,
      })
      .select("id")
      .single();

    if (jobError || !job) {
      await supabaseAdmin.rpc("add_credits", {
        p_user_id: payer,
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
