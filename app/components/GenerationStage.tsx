"use client";

// app/components/GenerationStage.tsx
// Üretim sürerken gösterilen "sahne": animasyonlu Norveko işareti, adım
// segmentli ilerleme çubuğu, dönen durum mesajları ve geçen süre. Amaç,
// bekleyen kullanıcıya işin gerçekten ilerlediğini hissettirmek. Yüzde
// tahminidir (adım başına beklenen süreye göre asimptotik), gerçek durum
// adım listesinden gelir.

import { useEffect, useState } from "react";
import BrandMark from "./BrandMark";
import type { PipelineStepId } from "@/lib/pipeline/steps";

export interface StageStep {
  id: PipelineStepId;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
}

// Typical wall-clock per step; only used for the progress estimate.
const EXPECTED_SECONDS: Record<PipelineStepId, number> = {
  research: 30,
  script: 45,
  voiceover: 35,
  thumbnail: 40,
  video: 360,
  render: 150,
};

const MESSAGES: Record<PipelineStepId, string[]> = {
  research: [
    "Searching the web for the latest facts…",
    "Reading sources and checking dates…",
    "Writing the research brief…",
  ],
  script: [
    "Researching your topic…",
    "Finding the strongest hook…",
    "Writing the script beat by beat…",
    "Planning scenes and visual prompts…",
    "Drafting titles, description and tags…",
  ],
  voiceover: [
    "Warming up the narrator…",
    "Recording the voiceover…",
    "Balancing pacing and pauses…",
  ],
  thumbnail: [
    "Sketching thumbnail concepts…",
    "Rendering the thumbnail…",
    "Tuning colours and contrast…",
  ],
  render: [
    "Laying clips on the timeline…",
    "Syncing narration and subtitles…",
    "Rendering the final MP4…",
    "Almost there — encoding…",
  ],
  video: [
    "Sending scenes to the video model…",
    "Rendering clips — this is the slow part…",
    "Still rendering, hang tight…",
    "Checking finished clips…",
  ],
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function GenerationStage({
  steps,
  createdAt,
}: {
  steps: StageStep[];
  createdAt?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);

  // 1 s clock for the timer / estimate; 3.5 s for message rotation.
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const rotate = setInterval(() => setTick((t) => t + 1), 3500);
    return () => {
      clearInterval(clock);
      clearInterval(rotate);
    };
  }, []);

  // Tab title shows progress while the user is on another tab.
  useEffect(() => {
    const previous = document.title;
    document.title = "Generating… · Norveko";
    return () => {
      document.title = previous;
    };
  }, []);

  const running = steps.find((s) => s.status === "running");
  const activeId: PipelineStepId = running?.id ?? steps.find((s) => s.status === "pending")?.id ?? "script";
  const messages = MESSAGES[activeId];
  const message = messages[tick % messages.length];

  const totalWeight = steps.reduce((sum, s) => sum + EXPECTED_SECONDS[s.id], 0) || 1;
  let done = 0;
  for (const s of steps) {
    const w = EXPECTED_SECONDS[s.id];
    if (s.status === "completed" || s.status === "skipped") done += w;
    else if (s.status === "running") {
      const started = s.startedAt ? Date.parse(s.startedAt) : now;
      const elapsed = Math.max(0, (now - started) / 1000);
      // Asymptotic: approaches 95 % of the step, never claims "done".
      done += w * 0.95 * (1 - Math.exp(-elapsed / w));
    }
  }
  const percent = Math.min(99, Math.max(2, Math.round((done / totalWeight) * 100)));
  const elapsedMs = createdAt ? now - Date.parse(createdAt) : 0;

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-blue-400/20 bg-[#0b0d1c] p-5 sm:p-6"
      role="status"
      aria-live="polite"
    >
      {/* Ambient glow */}
      <div className="nv-stage-glow pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
      <div className="nv-stage-glow pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-purple-500/20 blur-3xl [animation-delay:-2s]" />

      <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
        {/* Animated mark */}
        <div className="relative flex h-28 w-28 shrink-0 items-center justify-center">
          <span className="nv-stage-ring absolute inset-0 rounded-full" aria-hidden />
          <span className="nv-stage-ring-rev absolute inset-3 rounded-full" aria-hidden />
          <span className="nv-stage-orbit absolute inset-0" aria-hidden>
            <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-300 shadow-[0_0_12px_2px_rgba(125,211,252,0.8)]" />
          </span>
          <span className="nv-stage-breathe relative block">
            <BrandMark size={56} />
          </span>
        </div>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300/80">
            Generating
          </p>
          <h3 className="mt-1 text-lg font-bold text-white sm:text-xl">
            {running?.label ?? "Preparing your job"}
          </h3>
          <p key={message} className="nv-stage-message mt-1 text-sm text-gray-400">
            {message}
          </p>

          {/* Segmented progress */}
          <div className="mt-4 flex gap-1.5" aria-hidden>
            {steps.map((s) => (
              <span
                key={s.id}
                className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${
                  s.status === "completed"
                    ? "bg-gradient-to-r from-blue-400 to-purple-400"
                    : s.status === "skipped"
                    ? "bg-amber-300/60"
                    : s.status === "failed"
                    ? "bg-red-400/70"
                    : "bg-white/10"
                }`}
              >
                {s.status === "running" && (
                  <span className="nv-stage-shimmer absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-blue-300 to-transparent" />
                )}
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span className="tabular-nums">~{percent}%</span>
            <span className="tabular-nums">{formatElapsed(elapsedMs)} elapsed</span>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            You can leave this page — the job keeps running and the result lands in{" "}
            <span className="text-gray-300">Projects</span>. Credits are refunded automatically if a step fails.
          </p>
        </div>
      </div>
    </div>
  );
}
