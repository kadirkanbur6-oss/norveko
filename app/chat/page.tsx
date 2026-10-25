"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Clapperboard, Coins, LayoutTemplate, Loader2, Search, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import Sidebar from "../components/Sidebar";
import PipelineProgress from "../components/PipelineProgress";

import { DURATIONS, LANGUAGES, ORIENTATIONS, PLATFORMS, STYLES, defaultOrientation, type OrientationId } from "@/lib/pipeline/options";
import { NICHE_TEMPLATES } from "@/lib/pipeline/templates";
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

const DRAFT_KEY = "norveko:chat-draft";

interface Draft {
  idea: string;
  platform: string;
  style: string;
  duration: string;
  language: string;
  includeVoiceover: boolean;
  voiceId: string;
  orientation?: OrientationId;
  template?: string | null;
}

function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Partial<Draft>;
  } catch {
    return {};
  }
}

function ChatContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [idea, setIdea] = useState("");
  const [platform, setPlatform] = useState<string>(PLATFORMS[0]);
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [duration, setDuration] = useState<string>(DURATIONS[1]);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [orientation, setOrientation] = useState<OrientationId>(defaultOrientation(PLATFORMS[0]));
  const [orientationTouched, setOrientationTouched] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [includeVoiceover, setIncludeVoiceover] = useState(false);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [generationAvailable, setGenerationAvailable] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);
  const [launchLockMessage, setLaunchLockMessage] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [formOpen, setFormOpen] = useState(true);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const totalCost = totalPipelineCredits({
    voiceover: includeVoiceover,
    video: includeVideo && videoAvailable,
  });
  const videoCost = VIDEO_CLIP_CREDITS * VIDEO_MAX_CLIPS;

  // Restore an in-progress job from the URL and the unsent draft from
  // sessionStorage, so a reload never loses the user's work.
  useEffect(() => {
    const job = searchParams.get("job");
    const draft = readDraft();
    const id = setTimeout(() => {
      if (typeof draft.idea === "string") setIdea(draft.idea);
      if (typeof draft.platform === "string") setPlatform(draft.platform);
      if (typeof draft.style === "string") setStyle(draft.style);
      if (typeof draft.duration === "string") setDuration(draft.duration);
      if (typeof draft.language === "string") setLanguage(draft.language);
      if (typeof draft.includeVoiceover === "boolean") setIncludeVoiceover(draft.includeVoiceover);
      if (typeof draft.voiceId === "string") setVoiceId(draft.voiceId);
      if (draft.orientation === "vertical" || draft.orientation === "horizontal") {
        setOrientation(draft.orientation);
        setOrientationTouched(true);
      }
      if (typeof draft.template === "string") setTemplateId(draft.template);
      if (job && /^[0-9a-f-]{36}$/i.test(job)) {
        setJobId(job);
        setFormOpen(false);
      }
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const draft: Draft = { idea, platform, style, duration, language, includeVoiceover, voiceId, orientation, template: templateId };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // storage unavailable
    }
  }, [idea, platform, style, duration, language, includeVoiceover, voiceId, orientation, templateId]);

  // Keep orientation in step with the platform until the user picks one explicitly.
  function choosePlatform(next: string) {
    setPlatform(next);
    if (!orientationTouched) setOrientation(defaultOrientation(next));
  }

  function applyTemplate(id: string) {
    const t = NICHE_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setTemplateId(t.id);
    setPlatform(t.platform);
    setStyle(t.style);
    setDuration(t.duration);
    if (!orientationTouched) setOrientation(defaultOrientation(t.platform));
  }

  // Current credit balance (refreshed after each generation starts).
  useEffect(() => {
    let active = true;
    fetch("/api/credits", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (active && data?.success) setBalance(Number(data.credits ?? 0));
      })
      .catch(() => {
        // Balance stays unknown; the server still enforces it.
      });
    return () => {
      active = false;
    };
  }, [jobId]);

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

  // Fall back to the first voice whenever none is selected.
  const effectiveVoiceId = voiceId || voices[0]?.voice_id || "";
  const selectedVoice = voices.find((v) => v.voice_id === effectiveVoiceId) ?? null;
  const voiceNeedle = voiceQuery.trim().toLowerCase();
  const filteredVoices = voiceNeedle
    ? voices.filter(
        (v) =>
          v.name.toLowerCase().includes(voiceNeedle) ||
          Object.values(v.labels).some((l) => l.toLowerCase().includes(voiceNeedle))
      )
    : voices;

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

    if (includeVoiceover && !effectiveVoiceId) {
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
          voiceId: includeVoiceover ? effectiveVoiceId : null,
          includeVideo: includeVideo && videoAvailable,
          orientation,
          template: templateId,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Pipeline could not start.");
      }

      setJobId(data.jobId);
      setFormOpen(false);
      router.replace(`${pathname}?job=${data.jobId}`, { scroll: false });
      setTimeout(() => {
        progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
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

          {jobId && !formOpen && (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="mt-6 flex w-full items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-white/20"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">{idea || "Untitled idea"}</span>
                <span className="mt-1 block truncate text-xs text-gray-500">
                  {platform} · {style} · {duration} · {language} · {orientation === "vertical" ? "9:16" : "16:9"}
                  {includeVoiceover ? " · voiceover" : ""}
                  {templateId ? ` · ${NICHE_TEMPLATES.find((t) => t.id === templateId)?.name}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-gray-400">
                Edit settings <ChevronDown size={14} />
              </span>
            </button>
          )}

          <div className={`mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 ${jobId && !formOpen ? "hidden" : ""}`}>
            {/* Niche templates */}
            <div className="mb-5">
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <LayoutTemplate size={15} className="text-purple-300" />
                Start from a template <span className="text-gray-600">(optional)</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {NICHE_TEMPLATES.map((t) => {
                  const active = templateId === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => (active ? setTemplateId(null) : applyTemplate(t.id))}
                      title={t.tagline}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${
                        active
                          ? "border-purple-400/50 bg-purple-500/15 text-purple-100"
                          : "border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20 hover:text-white"
                      }`}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
              {templateId && (
                <div className="mt-3 rounded-xl border border-purple-400/20 bg-purple-500/5 p-3">
                  <p className="text-xs text-purple-200">
                    {NICHE_TEMPLATES.find((t) => t.id === templateId)?.tagline} — try one of these:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {NICHE_TEMPLATES.find((t) => t.id === templateId)?.examples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setIdea(ex)}
                        className="rounded-lg border border-white/10 bg-[#0d0d16] px-2.5 py-1.5 text-left text-xs text-gray-200 transition hover:border-purple-400/40"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

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
                  onChange={(e) => choosePlatform(e.target.value)}
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

            {/* Orientation */}
            <div className="mt-4">
              <label className="text-sm text-gray-400">Output format</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Output format">
                {ORIENTATIONS.map((o) => {
                  const active = orientation === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setOrientation(o.id);
                        setOrientationTouched(true);
                      }}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                        active
                          ? "border-blue-400/50 bg-blue-500/10"
                          : "border-white/10 bg-[#12121c] hover:border-white/20"
                      }`}
                    >
                      <span
                        className={`block shrink-0 rounded-sm border ${
                          active ? "border-blue-300 bg-blue-400/30" : "border-gray-500 bg-white/5"
                        } ${o.id === "vertical" ? "h-7 w-4" : "h-4 w-7"}`}
                      />
                      <span>
                        <span className="block text-sm font-semibold text-white">{o.label}</span>
                        <span className="block text-xs text-gray-500">{o.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-[#0d0d16] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={includeVoiceover}
                    onChange={(e) => {
                      setIncludeVoiceover(e.target.checked);
                      if (!e.target.checked) stopPreview();
                    }}
                    className="h-4 w-4 rounded border-white/20 bg-transparent text-blue-500 focus:ring-0"
                  />
                  <span className="text-sm font-semibold text-white">
                    Generate voiceover (+15 credits)
                  </span>
                </label>

                <span className="flex items-center gap-2 text-sm text-gray-400">
                  <span>Total cost: {totalCost} credits</span>
                  {balance !== null && (
                    <span
                      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                        balance >= totalCost
                          ? "border-yellow-400/20 bg-yellow-500/5 text-yellow-300"
                          : "border-red-400/30 bg-red-500/10 text-red-300"
                      }`}
                    >
                      <Coins size={12} />
                      {balance} available
                    </span>
                  )}
                </span>
              </div>

              {includeVoiceover && (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm text-gray-400">
                      Voice
                      {selectedVoice && (
                        <span className="ml-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-2 py-0.5 text-xs text-blue-200">
                          {selectedVoice.name}
                        </span>
                      )}
                    </label>
                    {voices.length > 6 && (
                      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-[#12121c] px-2.5 py-1.5">
                        <Search size={13} className="text-gray-500" />
                        <input
                          value={voiceQuery}
                          onChange={(e) => setVoiceQuery(e.target.value)}
                          placeholder="Search voices…"
                          aria-label="Search voices"
                          className="w-36 bg-transparent text-xs text-white outline-none placeholder:text-gray-500 sm:w-48"
                        />
                      </label>
                    )}
                  </div>
                  {voicesLoading && (
                    <p className="mt-2 text-xs text-gray-500">Loading voices...</p>
                  )}
                  {voicesError && (
                    <p className="mt-2 text-xs text-red-300">{voicesError}</p>
                  )}

                  {voices.length > 0 && (
                    <div
                      role="radiogroup"
                      aria-label="Voice"
                      className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-[#12121c] p-1.5"
                    >
                      {filteredVoices.length === 0 && (
                        <p className="p-3 text-xs text-gray-500">No voices match “{voiceQuery}”.</p>
                      )}
                      {filteredVoices.map((voice) => {
                        const isSelected = effectiveVoiceId === voice.voice_id;
                        const isPlaying = playingVoiceId === voice.voice_id;

                        return (
                          <div
                            key={voice.voice_id}
                            role="radio"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onClick={() => setVoiceId(voice.voice_id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setVoiceId(voice.voice_id);
                              }
                            }}
                            className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition ${
                              isSelected
                                ? "border-blue-400/40 bg-blue-500/10"
                                : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{voice.name}</p>
                              <p className="truncate text-xs text-gray-500">{formatVoiceLabels(voice.labels)}</p>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePreviewVoice(voice);
                              }}
                              disabled={!voice.preview_url}
                              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                isPlaying
                                  ? "border-blue-400/40 bg-blue-500/20 text-blue-100"
                                  : "border-white/10 bg-white/[0.03] text-gray-300 hover:text-white"
                              }`}
                            >
                              {isPlaying ? "Stop" : "Play"}
                            </button>
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

            {generationAvailable && balance !== null && balance < totalCost && (
              <p className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
                <span>
                  You need {totalCost} credits for this generation but have {balance}.
                </span>
                <Link
                  href="/billing"
                  className="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Top up credits
                </Link>
              </p>
            )}

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
                (balance !== null && balance < totalCost) ||
                (jobId !== null && !error) ||
                (includeVoiceover && (!effectiveVoiceId || voicesLoading))
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

          <div ref={progressRef} className="scroll-mt-20">
            {jobId && <PipelineProgress jobId={jobId} />}
          </div>

          {jobId && (
            <div className="mt-4 flex flex-wrap gap-4">
              <button
                onClick={() => {
                  setJobId(null);
                  setError("");
                  setFormOpen(true);
                  router.replace(pathname, { scroll: false });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="text-sm text-blue-300 transition hover:text-blue-200"
              >
                Run again with the same idea &amp; settings
              </button>
              <button
                onClick={() => {
                  setJobId(null);
                  setIdea("");
                  setError("");
                  setFormOpen(true);
                  router.replace(pathname, { scroll: false });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="text-sm text-gray-500 transition hover:text-white"
              >
                Start a new generation
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#0a0a12]">
          <Loader2 size={24} className="animate-spin text-blue-300" />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}
