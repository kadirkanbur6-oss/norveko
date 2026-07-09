// app/api/pipeline/start/route.ts
// Pipeline'ı başlatır: kredi düşer, job açar, adımları sırayla çalıştırır.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  buildPipelineSteps,
  totalPipelineCredits,
  initialStepsState,
} from "@/lib/pipeline/steps";
import { generateScript } from "@/lib/pipeline/openai";
import { generateThumbnail } from "@/lib/pipeline/gemini-image";
import { generateSpeech, listVoices } from "@/lib/pipeline/elevenlabs";

// Adımlar toplamda ~30 sn sürebilir; varsayılan limiti yükselt
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    // 1) Kullanıcıyı doğrula (mevcut @supabase/ssr desenimiz)
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll() {
            // Route handler'da cookie yazmıyoruz
          },
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

    // 2) Girdiyi al ve doğrula
    const body = await req.json();
    const {
      idea,
      platform,
      style,
      duration,
      outputLanguage,
      includeVoiceover,
      voiceId,
    } = body ?? {};

    if (!idea || typeof idea !== "string" || idea.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: "Please provide a video idea." },
        { status: 400 }
      );
    }

    const voiceoverEnabled = includeVoiceover === true;
    const pipelineSteps = buildPipelineSteps(voiceoverEnabled);

    if (voiceoverEnabled && (typeof voiceId !== "string" || !voiceId.trim())) {
      return NextResponse.json(
        { success: false, error: "Please select a voice for the voiceover." },
        { status: 400 }
      );
    }

    if (voiceoverEnabled) {
      const voices = await listVoices();
      const isValidVoice = voices.some((voice) => voice.voice_id === voiceId);

      if (!isValidVoice) {
        return NextResponse.json(
          { success: false, error: "Selected voice is not available." },
          { status: 400 }
        );
      }
    }

    const cost = totalPipelineCredits(voiceoverEnabled);

    // 3) Krediyi düş — generate-content ile aynı RPC deseni
    // deduct_credits(p_user_id, p_amount, p_reason)
    const { data: deducted, error: deductError } = await supabaseAdmin.rpc(
      "deduct_credits",
      {
        p_user_id: user.id,
        p_amount: cost,
        p_reason: `AI pipeline generation (script + thumbnail${voiceoverEnabled ? " + voiceover" : ""})`,
      }
    );

    console.error("[pipeline] deduct result:", {
      deducted,
      deductError,
      userId: user.id,
      cost,
    });

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

    // 4) Job kaydını aç
    const { data: job, error: jobError } = await supabaseAdmin
      .from("pipeline_jobs")
      .insert({
        user_id: user.id,
        idea: idea.trim(),
        platform: platform ?? "youtube",
        style: style ?? null,
        duration: duration ?? null,
        output_language: outputLanguage ?? "EN",
        status: "running",
        current_step: pipelineSteps[0].id,
        steps: initialStepsState(voiceoverEnabled),
        credits_charged: cost,
      })
      .select()
      .single();

    if (jobError || !job) {
      // Job açılamadıysa krediyi geri ver
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

    // 5) Adımları sırayla çalıştır
    try {
      // --- ADIM 1: SCRIPT ---
      await updateStep(job.id, "script", { status: "running" });

      const scriptDef = pipelineSteps.find((s) => s.id === "script")!;
      const scriptModel = scriptDef.provider.split(":")[1] ?? "gpt-5-mini";

      const scriptResult = await generateScript({
        idea: idea.trim(),
        platform: platform ?? "youtube",
        style,
        duration,
        outputLanguage: outputLanguage ?? "EN",
        model: scriptModel,
      });

      await updateStep(job.id, "script", {
        status: "completed",
        hook: scriptResult.hook,
        script: scriptResult.script,
        thumbnailPrompt: scriptResult.thumbnailPrompt,
      });

      if (voiceoverEnabled) {
        await supabaseAdmin
          .from("pipeline_jobs")
          .update({ current_step: "voiceover" })
          .eq("id", job.id);

        await updateStep(job.id, "voiceover", { status: "running" });

        try {
          const speechBuffer = await generateSpeech(
            scriptResult.script,
            voiceId.trim()
          );
          const storagePath = `${user.id}/${job.id}.mp3`;

          const { error: uploadError } = await supabaseAdmin.storage
            .from("voiceovers")
            .upload(storagePath, speechBuffer, {
              contentType: "audio/mpeg",
              upsert: true,
            });

          if (uploadError) {
            throw new Error(
              `Voiceover upload failed: ${uploadError.message}`
            );
          }

          const { data: urlData } = supabaseAdmin.storage
            .from("voiceovers")
            .getPublicUrl(storagePath);

          await updateStep(job.id, "voiceover", {
            status: "completed",
            audio_url: urlData.publicUrl,
            voice_id: voiceId.trim(),
            storage_path: storagePath,
          });
        } catch (voiceError) {
          const message =
            voiceError instanceof Error ? voiceError.message : "Unknown error";

          await updateStep(job.id, "voiceover", {
            status: "failed",
            error: message,
          });

          throw voiceError;
        }
      }

      await supabaseAdmin
        .from("pipeline_jobs")
        .update({ current_step: "thumbnail" })
        .eq("id", job.id);

      // --- ADIM 2: THUMBNAIL ---
      await updateStep(job.id, "thumbnail", { status: "running" });

      const thumbResult = await generateThumbnail(
        scriptResult.thumbnailPrompt,
        job.id
      );

      await updateStep(job.id, "thumbnail", {
        status: "completed",
        image_url: thumbResult.imageUrl,
      });

      // --- PIPELINE TAMAM ---
      await supabaseAdmin
        .from("pipeline_jobs")
        .update({ status: "completed", current_step: null })
        .eq("id", job.id);

      return NextResponse.json({ success: true, jobId: job.id });
    } catch (stepError) {
      // Herhangi bir adım patlarsa: job'ı failed yap + krediyi iade et
      const message =
        stepError instanceof Error ? stepError.message : "Unknown error";

      await supabaseAdmin
        .from("pipeline_jobs")
        .update({
          status: "failed",
          error: message,
          credits_refunded: cost,
        })
        .eq("id", job.id);

      await supabaseAdmin.rpc("add_credits", {
        p_user_id: user.id,
        p_amount: cost,
        p_type: "refund",
        p_reason: "Refund: pipeline step failed",
      });

      return NextResponse.json({ success: true, jobId: job.id });
      // Not: success:true dönüyoruz çünkü job oluştu; hata detayını UI job durumundan okuyacak.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[pipeline] fatal:", err);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// Yardımcı: steps JSON'unda tek bir adımı güncelle
async function updateStep(
  jobId: string,
  stepId: string,
  patch: Record<string, unknown>
) {
  const { data: current } = await supabaseAdmin
    .from("pipeline_jobs")
    .select("steps")
    .eq("id", jobId)
    .single();

  const steps = (current?.steps as Record<string, unknown>) ?? {};
  steps[stepId] = { ...(steps[stepId] as object), ...patch };

  await supabaseAdmin
    .from("pipeline_jobs")
    .update({ steps })
    .eq("id", jobId);
}