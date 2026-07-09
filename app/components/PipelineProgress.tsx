// app/components/PipelineProgress.tsx
// Pipeline ilerleme kartı: job durumunu poll eder, adım adım gösterir.

"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, XCircle, Copy } from "lucide-react";
import { PIPELINE_STEP_ORDER } from "@/lib/pipeline/steps";

interface StepInfo {
  status: "pending" | "running" | "completed" | "failed";
  error?: string | null;
  hook?: string;
  script?: string;
  image_url?: string;
  audio_url?: string;
  voice_id?: string;
  storage_path?: string;
}

interface JobData {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  current_step: string | null;
  steps: Record<string, StepInfo>;
  error: string | null;
}

const STEP_ORDER = PIPELINE_STEP_ORDER.map(({ id, label }) => ({ id, label }));

export default function PipelineProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/pipeline/${jobId}`);
        const data = await res.json();
        if (active && data.success) {
          setJob(data.job);
          // Bitti veya hata → poll'u durdur
          if (data.job.status === "completed" || data.job.status === "failed") {
            return;
          }
        }
      } catch {
        // Geçici ağ hatası — sonraki poll'da tekrar dener
      }
      if (active) {
        setTimeout(poll, 2000);
      }
    }

    poll();
    return () => {
      active = false;
    };
  }, [jobId]);

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!job) {
    return (
      <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <Loader2 size={20} className="animate-spin text-blue-300" />
      </div>
    );
  }

  const scriptStep = job.steps?.script;
  const thumbStep = job.steps?.thumbnail;

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      {/* Adım listesi */}
      <div className="flex flex-col gap-3">
        {STEP_ORDER.map(({ id, label }) => {
          const step = job.steps?.[id];
          if (!step) return null;
          const status = step?.status ?? "pending";
          return (
            <div key={id} className="flex items-center gap-3">
              {status === "completed" && (
                <CheckCircle2 size={18} className="text-green-400" />
              )}
              {status === "running" && (
                <Loader2 size={18} className="animate-spin text-blue-300" />
              )}
              {status === "failed" && (
                <XCircle size={18} className="text-red-400" />
              )}
              {status === "pending" && (
                <Circle size={18} className="text-gray-600" />
              )}
              <span
                className={
                  status === "completed"
                    ? "text-white"
                    : status === "running"
                    ? "text-blue-300"
                    : "text-gray-500"
                }
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Hata durumu */}
      {job.status === "failed" && (
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">
          Something went wrong: {job.error ?? "Unknown error"}. Your credits
          have been refunded.
        </div>
      )}

      {/* Sonuçlar */}
      {scriptStep?.status === "completed" && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-300">Hook</h4>
              <button
                onClick={() => copyText(scriptStep.hook ?? "", "hook")}
                className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
              >
                <Copy size={12} />
                {copied === "hook" ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-sm text-gray-200">{scriptStep.hook}</p>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-300">Script</h4>
              <button
                onClick={() => copyText(scriptStep.script ?? "", "script")}
                className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
              >
                <Copy size={12} />
                {copied === "script" ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-200">
              {scriptStep.script}
            </p>
          </div>
        </div>
      )}

      {job.steps?.voiceover?.status === "completed" && job.steps.voiceover.audio_url && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-gray-300">Voiceover</h4>
            <a
              href={job.steps.voiceover.audio_url}
              download
              className="text-xs text-blue-300 transition hover:text-blue-200"
            >
              Download MP3
            </a>
          </div>
          <audio
            controls
            src={job.steps.voiceover.audio_url}
            className="mt-3 w-full"
          />
        </div>
      )}

      {thumbStep?.status === "completed" && thumbStep.image_url && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h4 className="text-sm font-semibold text-gray-300">Thumbnail</h4>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumbStep.image_url}
            alt="Generated thumbnail"
            className="mt-3 w-full max-w-xl rounded-lg border border-white/10"
          />
        </div>
      )}
    </div>
  );
}