"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard, Loader2, Sparkles, Wand2 } from "lucide-react";
import Sidebar from "../components/Sidebar";
import PipelineProgress from "../components/PipelineProgress";

import { DURATIONS, LANGUAGES, PLATFORMS, STYLES } from "@/lib/pipeline/options";
import {
  totalPipelineCredits,
  VIDEO_CLIP_CREDITS,
  VIDEO_CLIP_SECONDS,
  VIDEO_MAX_CLIPS,
} from "@/lib/pipeline/steps";

interface VoiceOption {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  preview_url: string | null;
}

export default function ChatPage() {
  const [idea, setIdea] = useState("");
  const [platform, setPlatform] = useState<string>(PLATFORMS[0]);
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [duration, setDuration] = useState<string>(DURATIONS[1]);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [includeVoiceover, setIncludeVoiceover] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [generationAvailable, setGenerationAvailable] = useState(true);
  const [launchLockMessage, setLaunchLockMessage] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const totalCost = totalPipelineCredits({
    voiceover: includeVoiceover,
    video: includeVideo && videoAvailable,
  });
  const videoCost = VIDEO_CLIP_CREDITS * VIDEO_MAX_CLIPS;

  // Which optional features this account may use (video is gated server-side).
  useEffect(() => {
    let active = true;
    fetch("/api/features", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (active && data?.success) {
          setVideoAvailable(Boolean(data.features?.videoGeneration));
          setGenerationAvailable(data.features?.generation !== false);
          setLaunchLockMessage(data.launchLockMessage ?? null);
        }
      })
      .catch(() => {
        // Feature stays unavailable
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!includeVoiceover || voices.length > 0) {
      return;
    }

    let active = true;

    async function loadVoices() {
      setVoicesLoading(true);
      setVoicesError("");

      try {
        const res = await fetch("/api/voices");
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to load voices.");
        }

        if (active) {
          const loadedVoices: VoiceOption[] = data.voices ?? [];
          setVoices(loadedVoices);
          setVoiceId((current) => current || loadedVoices[0]?.voice_id || "");
        }
      } catch (err) {
        if (active) {
          setVoicesError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (active) {
          setVoicesLoading(false);
        }
      }
    }

    loadVoices();

    return () => {
      active = false;
    };
  }, [includeVoiceover, voices.length]);

  useEffect(() => {
    if (!includeVoiceover) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute("src");
        audio.load();
      }
      setPlayingVoiceId(null);
    }
  }, [includeVoiceover]);

  useEffect(() => {
    if (!includeVoiceover || !voices.length || voiceId) {
      return;
    }

    setVoiceId(voices[0].voice_id);
  }, [includeVoiceover, voiceId, voices]);

  function stopPreview() {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute("src");
    audio.load();
    setPlayingVoiceId(null);
  }

  function handlePreviewVoice(voice: VoiceOption) {
    if (!voice.preview_url) return;

    if (playingVoiceId === voice.voice_id) {
      stopPreview();
      return;
    }

    stopPreview();

    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.onended = () => setPlayingVoiceId(null);
    audio.src = voice.preview_url;
    audio
      .play()
      .then(() => setPlayingVoiceId(voice.voice_id))
      .catch(() => setPlayingVoiceId(null));
  }

  function formatVoiceLabels(labels: Record<string, string>) {
    const values = Object.values(labels).filter(Boolean);
    return values.length > 0 ? values.join(" · ") : "No labels";
  }

  async function handleGenerate() {
    if (idea.trim().length < 5) {
      setError("Please describe your video idea in a bit more detail.");
      return;
    }

    if (includeVoiceover && !voiceId) {
      setError("Please select a voice for the voiceover.");
      return;
    }

    setStarting(true);
    setError("");
    setJobId(null);

    try {
      const res = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          platform,
          style,
          duration,
          outputLanguage: language,
          includeVoiceover,
          voiceId: includeVoiceover ? voiceId : null,
          includeVideo: includeVideo && videoAvailable,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Pipeline could not start.");
      }

      setJobId(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setStarting(false);
    }
  }

  const selectClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-white outline-none focus:border-blue-400/50";

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
              <Wand2 className="text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">AI Workspace</h1>
              <p className="text-sm text-gray-400">
                Generate a full content package with thumbnail and optional voiceover
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <label className="text-sm text-gray-400">Video Idea</label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. The mystery of planes lost in the Bermuda Triangle..."
              rows={3}
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white placeholder-gray-500 outline-none focus:border-blue-400/50"
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm text-gray-400">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className={selectClass}
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Style</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className={selectClass}
                >
                  {STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Duration</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className={selectClass}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Output Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className={selectClass}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-[#0d0d16] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={includeVoiceover}
                    onChange={(e) => setIncludeVoiceover(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent text-blue-500 focus:ring-0"
                  />
                  <span className="text-sm font-semibold text-white">
                    Generate voiceover (+15 credits)
                  </span>
                </label>

                <span className="text-sm text-gray-400">
                  Total cost: {totalCost} credits
                </span>
              </div>

              {includeVoiceover && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="text-sm text-gray-400">Voice</label>
                    <select
                      value={voiceId}
                      onChange={(e) => setVoiceId(e.target.value)}
                      className={selectClass}
                      disabled={voicesLoading}
                    >
                      <option value="">Select a voice</option>
                      {voices.map((voice) => (
                        <option key={voice.voice_id} value={voice.voice_id}>
                          {voice.name}
                        </option>
                      ))}
                    </select>
                    {voicesLoading && (
                      <p className="mt-2 text-xs text-gray-500">Loading voices...</p>
                    )}
                    {voicesError && (
                      <p className="mt-2 text-xs text-red-300">{voicesError}</p>
                    )}
                  </div>

                  {voices.length > 0 && (
                    <div className="grid gap-3 md:grid-cols-2">
                      {voices.map((voice) => {
                        const isSelected = voiceId === voice.voice_id;
                        const isPlaying = playingVoiceId === voice.voice_id;

                        return (
                          <div
                            key={voice.voice_id}
                            className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${
                              isSelected
                                ? "border-blue-400/40 bg-blue-500/10"
                                : "border-white/10 bg-white/[0.02]"
                            }`}
                          >
                            <div>
                              <p className="text-sm font-semibold text-white">
                                {voice.name}
                              </p>
                              <p className="mt-1 text-xs text-gray-500">
                                {formatVoiceLabels(voice.labels)}
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handlePreviewVoice(voice)}
                                disabled={!voice.preview_url}
                                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-300 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {isPlaying ? "Stop" : "Play"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setVoiceId(voice.voice_id)}
                                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                                  isSelected
                                    ? "bg-blue-500/20 text-blue-200"
                                    : "border border-white/10 bg-white/[0.03] text-gray-300 hover:text-white"
                                }`}
                              >
                                {isSelected ? "Selected" : "Use"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Video clips (Kling) — gated until launch */}
            <div
              className={`mt-4 rounded-2xl border p-4 ${
                videoAvailable
                  ? "border-white/10 bg-[#0d0d16]"
                  : "border-white/5 bg-white/[0.02] opacity-70"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className={`flex items-center gap-3 ${videoAvailable ? "" : "cursor-not-allowed"}`}>
                  <input
                    type="checkbox"
                    checked={includeVideo && videoAvailable}
                    disabled={!videoAvailable}
                    onChange={(e) => setIncludeVideo(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-transparent text-blue-500 focus:ring-0 disabled:opacity-50"
                  />
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Clapperboard size={16} className="text-purple-300" />
                    Generate video clips (+{videoCost} credits)
                  </span>
                  {!videoAvailable && (
                    <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-0.5 text-xs text-purple-200">
                      Coming soon
                    </span>
                  )}
                </label>
                <span className="text-xs text-gray-500">
                  Up to {VIDEO_MAX_CLIPS} × {VIDEO_CLIP_SECONDS}s AI clips, one per scene. Unused clips are refunded.
                </span>
              </div>
            </div>

            {!generationAvailable && (
              <p className="mt-6 rounded-xl border border-yellow-400/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                {launchLockMessage ?? "Content generation is temporarily closed."}
              </p>
            )}

            <button
              onClick={handleGenerate}
              disabled={
                starting ||
                !generationAvailable ||
                (jobId !== null && !error) ||
                (includeVoiceover && (!voiceId || voicesLoading))
              }
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 py-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {starting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Starting pipeline...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Generate (Pipeline) — {totalCost} credits
                </>
              )}
            </button>

            {error && (
              <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>

          {jobId && <PipelineProgress jobId={jobId} />}

          {jobId && (
            <button
              onClick={() => {
                setJobId(null);
                setIdea("");
              }}
              className="mt-4 text-sm text-gray-500 transition hover:text-white"
            >
              Start a new generation
            </button>
          )}
        </div>
      </main>
    </div>
  );
}