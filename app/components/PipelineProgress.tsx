// app/components/PipelineProgress.tsx
// Pipeline ilerleme kartı: job durumunu poll eder, adım adım gösterir.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Clapperboard, Download, Loader2, XCircle, Copy } from "lucide-react";
import { PIPELINE_STEP_ORDER, type PipelineStepId } from "@/lib/pipeline/steps";
import AudioPlayer from "./AudioPlayer";
import VideoPlayer from "./VideoPlayer";
import VoiceoverDownloads from "./VoiceoverDownloads";
import GenerationStage, { type StageStep } from "./GenerationStage";

interface StepInfo {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  error?: string | null;
  started_at?: string;
  hook?: string;
  script?: string;
  scenes?: Array<{
    sceneNumber: number;
    description: string;
    videoPrompt: string;
  }>;
  titles?: string[];
  description?: string;
  tags?: string[];
  thumbnailIdea?: string;
  image_url?: string;
  audio_url?: string;
  voice_id?: string;
  storage_path?: string;
  captions?: Array<{ start: number; end: number; text: string }>;
  clips?: Array<{
    sceneNumber: number;
    status: "pending" | "processing" | "succeed" | "failed";
    video_url?: string;
    error?: string;
  }>;
  /** Full video: timeline slots (visuals step) */
  slots?: Array<{
    index: number;
    sceneNumber: number;
    kind: "kling" | "still";
    status: "pending" | "processing" | "succeed" | "failed";
    url?: string;
    error?: string;
  }>;
  /** Full video: render step */
  video_url?: string;
  provider_status?: string;
  total_seconds?: number;
  hosted_by?: "supabase" | "shotstack";
  /** Research step */
  brief?: string;
  sources?: Array<{ title: string; url: string }>;
}

interface JobData {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  current_step: string | null;
  steps: Record<string, StepInfo>;
  error: string | null;
  created_at?: string;
  credits_charged?: number | null;
  credits_refunded?: number | null;
  options?: { orientation?: "vertical" | "horizontal" } | null;
}

interface PipelineResultStep {
  status?: string;
  project_id?: string;
}

const STEP_ORDER = PIPELINE_STEP_ORDER.map(({ id, label }) => ({ id, label }));

// Stop polling after this long; the server reaper will settle the job.
const POLL_TIMEOUT_MS = 15 * 60 * 1000;

export default function PipelineProgress({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let active = true;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await fetch(`/api/pipeline/${jobId}`, { cache: "no-store" });
        const data = await res.json();
        if (active && data.success) {
          setJob(data.job);
          if (data.job.status === "completed" || data.job.status === "failed") {
            return;
          }
        }
      } catch {
        // Transient network error — retried on the next poll
      }
      if (!active) return;
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setTimedOut(true);
        return;
      }
      // Back off a little as the job gets older.
      const elapsed = Date.now() - startedAt;
      timer = setTimeout(poll, elapsed > 60_000 ? 5000 : 2000);
    }

    timer = setTimeout(poll, 0);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  if (!job) {
    return (
      <div className="mt-6">
        <GenerationStage steps={[{ id: "script", label: "Content Package", status: "pending" }]} />
      </div>
    );
  }

  const scriptStep = job.steps?.script;
  const thumbStep = job.steps?.thumbnail;
  const videoStep = job.steps?.video;
  const resultStep = job.steps?.result as unknown as PipelineResultStep | undefined;
  const projectId =
    (resultStep?.project_id && resultStep.project_id.length > 0
      ? resultStep.project_id
      : null) ?? null;

  const stageSteps: StageStep[] = STEP_ORDER.flatMap(({ id, label }) => {
    const step = job.steps?.[id];
    if (!step) return [];
    return [{ id: id as PipelineStepId, label, status: step.status ?? "pending", startedAt: step.started_at }];
  });
  const isRunning = job.status === "running" || job.status === "queued";

  return (
    <div className="mt-6 space-y-4">
      {isRunning && !timedOut && (
        <GenerationStage steps={stageSteps} createdAt={job.created_at} />
      )}

      {job.status === "completed" && projectId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-green-400/20 bg-green-500/10 p-4 text-sm text-green-200">
          <span className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-green-400" />
            Your content package is ready.
          </span>
          <Link
            href={`/projects/${projectId}`}
            className="rounded-lg bg-green-500/20 px-3 py-1.5 font-semibold text-green-50 transition hover:bg-green-500/30"
          >
            Open project →
          </Link>
        </div>
      )}

    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      {/* Step list */}
      <div className="flex flex-wrap gap-2">
        {stageSteps.map(({ id, label, status }) => (
          <div
            key={id}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
              status === "completed"
                ? "border-green-400/30 bg-green-500/10 text-green-100"
                : status === "running"
                ? "border-blue-400/40 bg-blue-500/10 text-blue-100"
                : status === "failed"
                ? "border-red-400/30 bg-red-500/10 text-red-200"
                : "border-white/10 bg-white/[0.02] text-gray-500"
            }`}
          >
            {status === "completed" && <CheckCircle2 size={14} className="text-green-400" />}
            {status === "running" && <Loader2 size={14} className="animate-spin text-blue-300" />}
            {status === "failed" && <XCircle size={14} className="text-red-400" />}
            {status === "pending" && <Circle size={14} className="text-gray-500" />}
            {status === "skipped" && <Circle size={14} className="text-amber-300" />}
            {label}
          </div>
        ))}
      </div>

      {timedOut && job.status === "running" && (
        <div className="mt-4 rounded-xl border border-yellow-400/30 bg-yellow-500/10 p-4 text-sm text-yellow-200">
          This is taking longer than expected. We&apos;ve stopped checking
          automatically — your result will appear under Projects when it
          finishes, and credits are refunded automatically if it fails.
        </div>
      )}

      {/* Error state */}
      {job.status === "failed" && (
        <div className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">
          <p>Something went wrong: {job.error ?? "Unknown error"}.</p>
          <p className="mt-1 text-red-200/80">
            {typeof job.credits_refunded === "number" && job.credits_refunded > 0
              ? `${job.credits_refunded} credits for the unfinished steps were refunded.`
              : "Credits for any unfinished steps are refunded automatically."}
            {projectId ? " What was already produced is saved as a project." : ""}
          </p>
          {projectId && (
            <Link
              href={`/projects/${projectId}`}
              className="mt-3 inline-block rounded-lg bg-red-500/20 px-3 py-1.5 font-semibold text-red-50 transition hover:bg-red-500/30"
            >
              Open the partial project →
            </Link>
          )}
        </div>
      )}

      {/* Full video: final MP4 */}
      {job.steps?.render?.status === "completed" && job.steps.render.video_url && (
        <div className="mt-4 rounded-2xl border border-purple-400/30 bg-gradient-to-br from-purple-500/10 to-blue-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Your video is ready</h4>
              <p className="text-xs text-gray-400">
                {job.steps.render.total_seconds ? `${Math.round(job.steps.render.total_seconds)} s · ` : ""}
                1080p MP4 with narration and subtitles
              </p>
              {job.steps.render.hosted_by === "shotstack" && (
                <p className="mt-1 text-xs text-yellow-300">
                  This file is hosted temporarily — download it within 24 hours.
                </p>
              )}
            </div>
            <a
              href={job.steps.render.video_url}
              download={`norveko-video-${job.id.slice(0, 8)}.mp4`}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:opacity-90"
            >
              <Download size={15} />
              Download MP4
            </a>
          </div>
          <VideoPlayer
            src={job.steps.render.video_url}
            poster={typeof job.steps?.thumbnail?.image_url === "string" ? job.steps.thumbnail.image_url : undefined}
            aspect={job.options?.orientation === "horizontal" ? "horizontal" : "vertical"}
            className="mt-3"
          />
        </div>
      )}

      {/* Full video: visuals progress */}
      {videoStep?.slots && videoStep.slots.length > 0 && job.steps?.render?.status !== "completed" && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-300">Visuals</h4>
            <span className="text-xs text-gray-500">
              {videoStep.slots.filter((s) => s.status === "succeed").length}/{videoStep.slots.length} ready
              {job.steps?.render?.status === "running" ? " · rendering the final video" : ""}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-6 gap-1.5 sm:grid-cols-12">
            {videoStep.slots.map((slot) => (
              <div
                key={slot.index}
                title={`Slot ${slot.index + 1} · scene ${slot.sceneNumber} · ${slot.kind === "kling" ? "AI clip" : "AI still"} · ${slot.status}`}
                className={`flex aspect-[9/16] items-center justify-center overflow-hidden rounded-md border text-[10px] ${
                  slot.status === "succeed"
                    ? "border-green-400/30 bg-green-500/10"
                    : slot.status === "failed"
                    ? "border-red-400/30 bg-red-500/10"
                    : "border-white/10 bg-white/[0.03]"
                }`}
              >
                {slot.status === "succeed" && slot.url && slot.kind === "still" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.url} alt="" className="h-full w-full object-cover" />
                ) : slot.status === "succeed" ? (
                  <Clapperboard size={12} className="text-green-300" />
                ) : slot.status === "failed" ? (
                  <XCircle size={12} className="text-red-300" />
                ) : (
                  <Loader2 size={12} className="animate-spin text-blue-300" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {videoStep?.clips && videoStep.clips.length > 0 && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-300">Video clips</h4>
            {videoStep.status === "running" && (
              <span className="text-xs text-gray-500">
                Rendering — this can take a few minutes per clip
              </span>
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {videoStep.clips.map((clip) => (
              <div
                key={clip.sceneNumber}
                className="min-w-0 rounded-lg border border-white/10 bg-[#0d0d16] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">
                    Scene {clip.sceneNumber}
                  </p>
                  {clip.status === "succeed" && <CheckCircle2 size={14} className="text-green-400" />}
                  {clip.status === "failed" && <XCircle size={14} className="text-red-400" />}
                  {(clip.status === "processing" || clip.status === "pending") && (
                    <Loader2 size={14} className="animate-spin text-blue-300" />
                  )}
                </div>
                {clip.status === "succeed" && clip.video_url && (
                  <VideoPlayer src={clip.video_url} className="mt-2" />
                )}
                {clip.status === "failed" && (
                  <p className="mt-2 text-xs text-red-300">
                    {clip.error ?? "Failed"} — credits for this clip were refunded.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {job.steps?.research?.status === "skipped" && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-3 text-xs text-amber-100">
          Web research was skipped ({String(job.steps.research.error ?? "provider error")}) — its 5 credits were refunded and the script was written from the model&apos;s own knowledge.
        </p>
      )}
      {job.steps?.research?.status === "completed" && job.steps.research.brief && (
        <details className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-gray-300">
            Research brief
            <span className="ml-2 text-xs font-normal text-gray-500">
              {job.steps.research.sources?.length ?? 0} sources · the script is built on these facts
            </span>
          </summary>
          <p className="mt-3 whitespace-pre-line text-sm text-gray-200">{job.steps.research.brief}</p>
          {job.steps.research.sources && job.steps.research.sources.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs">
              {job.steps.research.sources.map((src) => (
                <li key={src.url} className="truncate">
                  <a href={src.url} target="_blank" rel="noreferrer" className="text-blue-300 hover:text-blue-200">
                    {src.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </details>
      )}

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

          {Array.isArray(scriptStep.scenes) && scriptStep.scenes.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-300">Scene Plan</h4>
                <button
                  onClick={() => copyText((scriptStep.scenes ?? []).map((sc) => `Scene ${sc.sceneNumber}: ${sc.description}\n${sc.videoPrompt}`).join("\n\n"), "scenes")}
                  className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
                >
                  <Copy size={12} />
                  {copied === "scenes" ? "Copied!" : "Copy"}
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {scriptStep.scenes.map((scene) => (
                  <div
                    key={`${scene.sceneNumber}-${scene.description.slice(0, 12)}`}
                    className="rounded-lg border border-white/10 bg-[#0d0d16] p-3"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">
                      Scene {scene.sceneNumber}
                    </p>
                    <p className="mt-1 text-sm text-gray-200">{scene.description}</p>
                    <p className="mt-2 whitespace-pre-wrap text-xs text-gray-400">
                      {scene.videoPrompt}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(scriptStep.titles) && scriptStep.titles.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-300">Titles</h4>
                <button
                  onClick={() => copyText((scriptStep.titles ?? []).join("\n"), "titles")}
                  className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
                >
                  <Copy size={12} />
                  {copied === "titles" ? "Copied!" : "Copy"}
                </button>
              </div>
              <ul className="mt-3 space-y-1 text-sm text-gray-200">
                {scriptStep.titles.map((title) => (
                  <li key={title}>• {title}</li>
                ))}
              </ul>
            </div>
          )}

          {scriptStep.description && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-300">Description</h4>
                <button
                  onClick={() => copyText(scriptStep.description ?? "", "description")}
                  className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
                >
                  <Copy size={12} />
                  {copied === "description" ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-200">
                {scriptStep.description}
              </p>
            </div>
          )}

          {Array.isArray(scriptStep.tags) && scriptStep.tags.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-300">Tags</h4>
                <button
                  onClick={() => copyText((scriptStep.tags ?? []).join(", "), "tags")}
                  className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
                >
                  <Copy size={12} />
                  {copied === "tags" ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-200">{scriptStep.tags.join(", ")}</p>
            </div>
          )}

          {scriptStep.thumbnailIdea && (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-300">Thumbnail Idea</h4>
                <button
                  onClick={() => copyText(scriptStep.thumbnailIdea ?? "", "thumbnailIdea")}
                  className="flex items-center gap-1 text-xs text-gray-500 transition hover:text-white"
                >
                  <Copy size={12} />
                  {copied === "thumbnailIdea" ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-gray-200">
                {scriptStep.thumbnailIdea}
              </p>
            </div>
          )}
        </div>
      )}

      {job.steps?.voiceover?.status === "completed" && job.steps.voiceover.audio_url && (
        <div className="mt-4">
          <AudioPlayer
            src={job.steps.voiceover.audio_url}
            title="Voiceover"
            subtitle={
              job.steps.voiceover.captions?.length
                ? `${job.steps.voiceover.captions.length} subtitle cues, word-timed to the narration`
                : "MP3 narration of the full script"
            }
            actions={
              <VoiceoverDownloads
                audioUrl={job.steps.voiceover.audio_url}
                captions={job.steps.voiceover.captions}
                baseName={`norveko-voiceover-${job.id.slice(0, 8)}`}
              />
            }
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
    </div>
  );
}