"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Captions, CheckCircle2, Film, Globe, ChevronDown, Clapperboard, Coins, LayoutTemplate, Loader2, Mic, Play, Search, Sparkles, Square, Wand2 } from "lucide-react";
import Link from "next/link";
import Sidebar from "../components/Sidebar";
import PipelineProgress from "../components/PipelineProgress";

import { DURATIONS, LANGUAGE_OPTIONS, LANGUAGES, ORIENTATIONS, PLATFORMS, STYLES, defaultOrientation, languageOption, type OrientationId } from "@/lib/pipeline/options";
import { NICHE_TEMPLATES } from "@/lib/pipeline/templates";
import {
  fullVideoPlan,
  FULL_VIDEO_DURATIONS,
  RESEARCH_CREDITS,
  SUBTITLES_CREDITS,
  totalPipelineCredits,
  type FootageMode,
  VIDEO_CLIP_CREDITS,
  VIDEO_CLIP_SECONDS,
  VIDEO_MAX_CLIPS,
} from "@/lib/pipeline/steps";

interface VoiceOption {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  preview_url: string | null;
  languages?: string[];
  source?: "account" | "library";
  public_owner_id?: string;
}


function voiceDisplayName(name: string) {
  // ElevenLabs names look like "Roger - Laid-Back, Casual, Resonant".
  const [first, ...rest] = name.split(" - ");
  return { short: first.trim(), tagline: rest.join(" - ").trim() };
}

function humanLabel(value: string) {
  return value.replace(/_/g, " ");
}

const DRAFT_KEY = "norveko:chat-draft";

interface Draft {
  idea: string;
  platform: string;
  style: string;
  duration: string;
  language: string;
  includeVoiceover: boolean;
  includeResearch?: boolean;
  includeSubtitles?: boolean;
  includeFullVideo?: boolean;
  footage?: FootageMode;
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
  const [includeResearch, setIncludeResearch] = useState(true);
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [includeFullVideo, setIncludeFullVideo] = useState(false);
  const [footage, setFootage] = useState<FootageMode>("hybrid");
  const [fullVideoAvailable, setFullVideoAvailable] = useState(false);
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
  const [voiceListOpen, setVoiceListOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fullVideoOn = includeFullVideo && fullVideoAvailable && Boolean(fullVideoPlan(duration, footage));
  const totalCost = totalPipelineCredits({
    research: includeResearch,
    voiceover: includeVoiceover || fullVideoOn,
    subtitles: (includeVoiceover && includeSubtitles) || fullVideoOn,
    video: !fullVideoOn && includeVideo && videoAvailable,
    fullVideo: fullVideoOn,
    footage,
    duration,
  });
  const fullVideoSupported = Boolean(FULL_VIDEO_DURATIONS[duration]);
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
      if (typeof draft.includeSubtitles === "boolean") setIncludeSubtitles(draft.includeSubtitles);
      if (typeof draft.includeResearch === "boolean") setIncludeResearch(draft.includeResearch);
      if (typeof draft.includeFullVideo === "boolean") setIncludeFullVideo(draft.includeFullVideo);
      if (draft.footage === "hybrid" || draft.footage === "cinematic" || draft.footage === "stills") setFootage(draft.footage);
      if (typeof draft.voiceId === "string") setVoiceId(draft.voiceId);
      if (draft.orientation === "vertical" || draft.orientation === "horizontal") {
        setOrientation(draft.orientation);
        setOrientationTouched(true);
      }
      if (typeof draft.template === "string") setTemplateId(draft.template);
      // Landing-page template links: /chat?template=<id> wins over the draft.
      const fromUrl = NICHE_TEMPLATES.find((x) => x.id === searchParams.get("template"));
      if (fromUrl) {
        setTemplateId(fromUrl.id);
        setPlatform(fromUrl.platform);
        setStyle(fromUrl.style);
        setDuration(fromUrl.duration);
        setOrientation(defaultOrientation(fromUrl.platform));
      }
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
      const draft: Draft = { idea, platform, style, duration, language, includeVoiceover, includeResearch, includeSubtitles, includeFullVideo, footage, voiceId, orientation, template: templateId };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // storage unavailable
    }
  }, [idea, platform, style, duration, language, includeVoiceover, includeResearch, includeSubtitles, includeFullVideo, footage, voiceId, orientation, templateId]);

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
          setFullVideoAvailable(Boolean(data.features?.fullVideo));
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

  // Load voices for the selected output language whenever voiceover is on.
  const [nativeMatch, setNativeMatch] = useState(true);
  useEffect(() => {
    if (!includeVoiceover) return;

    let active = true;

    async function loadVoices() {
      setVoicesLoading(true);
      setVoicesError("");

      try {
        const res = await fetch(`/api/voices?language=${encodeURIComponent(language)}`, { cache: "no-store" });
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to load voices.");
        }

        if (active) {
          // Outside English, native Voice Library narrators come first so the
          // default pick sounds local; English keeps the account defaults first.
          const account: VoiceOption[] = data.voices ?? [];
          const library: VoiceOption[] = data.library ?? [];
          const loaded: VoiceOption[] =
            data.languageCode === "en" ? [...account, ...library] : [...library, ...account];
          setVoices(loaded);
          setNativeMatch(data.nativeMatch !== false);
          // Keep the current pick only if it still exists for this language.
          setVoiceId((current) =>
            loaded.some((v) => v.voice_id === current) ? current : loaded[0]?.voice_id || ""
          );
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
  }, [includeVoiceover, language]);

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

  function chooseVoice(id: string) {
    setVoiceId(id);
    setVoiceListOpen(false);
  }

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
          includeVoiceover: includeVoiceover || fullVideoOn,
          includeResearch,
          includeSubtitles: (includeVoiceover && includeSubtitles) || fullVideoOn,
          voiceId: includeVoiceover || fullVideoOn ? effectiveVoiceId : null,
          voicePublicOwnerId: includeVoiceover || fullVideoOn ? selectedVoice?.public_owner_id ?? null : null,
          voiceName: includeVoiceover || fullVideoOn ? selectedVoice?.name ?? null : null,
          includeVideo: !fullVideoOn && includeVideo && videoAvailable,
          includeFullVideo: fullVideoOn,
          footage,
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

      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
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
                  {includeResearch ? " · research" : ""}
                  {includeVoiceover ? " · voiceover" : ""}
                  {includeVoiceover && includeSubtitles ? " · subtitles" : ""}
                  {fullVideoOn ? ` · full video (${footage})` : ""}
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
                Start from a template <span className="text-gray-500">(optional)</span>
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
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.code} value={l.label}>
                      {l.flag} {l.label} · {l.english}
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

            {/* Web research before the script */}
            <div
              className={`mt-4 rounded-2xl border p-4 transition ${
                includeResearch ? "border-blue-400/30 bg-[#0d0d16]" : "border-white/10 bg-[#0d0d16]"
              }`}
            >
              <label className="flex cursor-pointer items-center gap-3">
                <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                  <input
                    type="checkbox"
                    checked={includeResearch}
                    onChange={(e) => setIncludeResearch(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="absolute inset-0 rounded-full bg-white/10 transition peer-checked:bg-gradient-to-r peer-checked:from-blue-500 peer-checked:to-purple-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/60" />
                  <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                </span>
                <span>
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Globe size={15} className="text-blue-300" />
                    Research the topic first
                    <span className="rounded-full border border-yellow-400/20 bg-yellow-500/5 px-2 py-0.5 text-[11px] font-medium text-yellow-300">
                      +{RESEARCH_CREDITS} credits
                    </span>
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-500">
                    Searches the web for current, sourced facts before writing — essential for news, sports and recent events
                  </span>
                </span>
              </label>
            </div>

            {/* Voiceover */}
            <div
              className={`mt-4 rounded-2xl border p-4 transition ${
                includeVoiceover ? "border-blue-400/30 bg-[#0d0d16]" : "border-white/10 bg-[#0d0d16]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                    <input
                      type="checkbox"
                      checked={includeVoiceover || fullVideoOn}
                      disabled={fullVideoOn}
                      onChange={(e) => {
                        setIncludeVoiceover(e.target.checked);
                        if (!e.target.checked) stopPreview();
                      }}
                      className="peer sr-only"
                    />
                    <span className="absolute inset-0 rounded-full bg-white/10 transition peer-checked:bg-gradient-to-r peer-checked:from-blue-500 peer-checked:to-purple-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/60" />
                    <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                  </span>
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Mic size={15} className="text-blue-300" />
                      AI voiceover
                      <span className="rounded-full border border-yellow-400/20 bg-yellow-500/5 px-2 py-0.5 text-[11px] font-medium text-yellow-300">
                        +15 credits
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      Narration of the full script, delivered as MP3
                    </span>
                  </span>
                </label>

                {includeVoiceover && (
                  <span className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-300">
                    <span aria-hidden>{languageOption(language).flag}</span>
                    Voices for {language}
                  </span>
                )}
              </div>

              {includeVoiceover && (
                <div className="mt-4">
                  {selectedVoice && !voicesLoading ? (
                    <div className="flex items-center gap-3 rounded-xl border border-blue-400/40 bg-blue-500/10 p-3">
                      <button
                        type="button"
                        aria-label={playingVoiceId === selectedVoice.voice_id ? "Stop preview" : "Preview voice"}
                        onClick={() => handlePreviewVoice(selectedVoice)}
                        disabled={!selectedVoice.preview_url}
                        className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white disabled:opacity-40 ${
                          selectedVoice.labels.gender === "female"
                            ? "from-pink-400 to-purple-500"
                            : selectedVoice.labels.gender === "male"
                            ? "from-sky-400 to-blue-600"
                            : "from-emerald-400 to-teal-600"
                        }`}
                      >
                        {playingVoiceId === selectedVoice.voice_id ? (
                          <Square size={14} fill="currentColor" />
                        ) : (
                          <Play size={16} fill="currentColor" className="ml-0.5" />
                        )}
                        {playingVoiceId === selectedVoice.voice_id && (
                          <span className="absolute -inset-1 animate-ping rounded-full border border-white/40" aria-hidden />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                          {voiceDisplayName(selectedVoice.name).short}
                          {selectedVoice.source === "library" && (
                            <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-1.5 py-px text-[10px] font-medium text-purple-200">
                              Library
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-gray-400">
                          {voiceDisplayName(selectedVoice.name).tagline || humanLabel(selectedVoice.labels.descriptive ?? "")}
                          {selectedVoice.labels.accent ? ` · ${humanLabel(selectedVoice.labels.accent)}` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVoiceListOpen((o) => !o)}
                        aria-expanded={voiceListOpen}
                        className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-200 transition hover:border-white/20 hover:text-white"
                      >
                        {voiceListOpen ? "Close" : "Change voice"}
                        <ChevronDown size={14} className={`transition ${voiceListOpen ? "rotate-180" : ""}`} />
                      </button>
                    </div>
                  ) : (
                    !voicesLoading && !voicesError && voices.length === 0 && (
                      <p className="text-xs text-gray-500">No voices available for {language} right now.</p>
                    )
                  )}

                  {(voiceListOpen || !selectedVoice) && voices.length > 6 && !voicesLoading && (
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-xs text-gray-500">{voices.length} narrators for {language}</p>
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
                    </div>
                  )}

                  {!voicesLoading && !voicesError && voices.length > 0 && !nativeMatch && (
                    <p className="mt-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-gray-400">
                      No narrators tagged for {language} yet — these voices still speak {language} fluently with the multilingual model.
                    </p>
                  )}

                  {voicesLoading && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-busy>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-[72px] animate-pulse rounded-xl border border-white/5 bg-white/[0.03]" />
                      ))}
                    </div>
                  )}
                  {voicesError && <p className="mt-2 text-xs text-red-300">{voicesError}</p>}

                  {!voicesLoading && voices.length > 0 && (voiceListOpen || !selectedVoice) && (
                    <div
                      role="radiogroup"
                      aria-label="Voice"
                      className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3"
                    >
                      {filteredVoices.length === 0 && (
                        <p className="p-3 text-xs text-gray-500 sm:col-span-2 lg:col-span-3">No voices match “{voiceQuery}”.</p>
                      )}
                      {filteredVoices.map((voice) => {
                        const isSelected = effectiveVoiceId === voice.voice_id;
                        const isPlaying = playingVoiceId === voice.voice_id;
                        const { short, tagline } = voiceDisplayName(voice.name);
                        const gender = voice.labels.gender;
                        const avatar =
                          gender === "female"
                            ? "from-pink-400 to-purple-500"
                            : gender === "male"
                            ? "from-sky-400 to-blue-600"
                            : "from-emerald-400 to-teal-600";
                        const chips = [voice.labels.accent, voice.labels.age, voice.labels.use_case]
                          .filter((v): v is string => Boolean(v))
                          .slice(0, 2);

                        return (
                          <div
                            key={voice.voice_id}
                            role="radio"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onClick={() => chooseVoice(voice.voice_id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                chooseVoice(voice.voice_id);
                              }
                            }}
                            className={`group relative flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition ${
                              isSelected
                                ? "border-blue-400/60 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.35)]"
                                : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
                            }`}
                          >
                            <button
                              type="button"
                              aria-label={isPlaying ? `Stop ${short}` : `Preview ${short}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePreviewVoice(voice);
                              }}
                              disabled={!voice.preview_url}
                              className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white transition disabled:opacity-40 ${avatar} ${
                                isPlaying ? "ring-2 ring-white/70" : ""
                              }`}
                            >
                              <span className={`transition ${isPlaying ? "opacity-0" : "group-hover:opacity-0"}`}>
                                {short.charAt(0).toUpperCase()}
                              </span>
                              <span
                                className={`absolute inset-0 flex items-center justify-center transition ${
                                  isPlaying ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                }`}
                              >
                                {isPlaying ? <Square size={14} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
                              </span>
                              {isPlaying && (
                                <span className="absolute -inset-1 animate-ping rounded-full border border-white/40" aria-hidden />
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
                                {short}
                                {voice.source === "library" && (
                                  <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-1.5 py-px text-[10px] font-medium text-purple-200">
                                    Library
                                  </span>
                                )}
                              </p>
                              <p className="truncate text-xs text-gray-400">{tagline || humanLabel(voice.labels.descriptive ?? "")}</p>
                              {chips.length > 0 && (
                                <p className="mt-1 flex flex-wrap gap-1">
                                  {chips.map((c) => (
                                    <span key={c} className="rounded-md bg-white/5 px-1.5 py-px text-[10px] capitalize text-gray-400">
                                      {humanLabel(c)}
                                    </span>
                                  ))}
                                </p>
                              )}
                            </div>

                            {isSelected && (
                              <CheckCircle2 size={16} className="shrink-0 text-blue-300" aria-hidden />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Subtitles — add-on to the voiceover */}
            {includeVoiceover && (
              <div
                className={`mt-4 rounded-2xl border p-4 transition ${
                  includeSubtitles ? "border-blue-400/30 bg-[#0d0d16]" : "border-white/10 bg-[#0d0d16]"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                    <input
                      type="checkbox"
                      checked={includeSubtitles || fullVideoOn}
                      disabled={fullVideoOn}
                      onChange={(e) => setIncludeSubtitles(e.target.checked)}
                      className="peer sr-only"
                    />
                    <span className="absolute inset-0 rounded-full bg-white/10 transition peer-checked:bg-gradient-to-r peer-checked:from-blue-500 peer-checked:to-purple-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/60" />
                    <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                  </span>
                  <span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Captions size={15} className="text-blue-300" />
                      Auto subtitles
                      <span className="rounded-full border border-yellow-400/20 bg-yellow-500/5 px-2 py-0.5 text-[11px] font-medium text-yellow-300">
                        +{SUBTITLES_CREDITS} credits
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      Word-timed captions synced to the narration · download as .srt or .vtt for YouTube, CapCut, Premiere
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* Full video (private beta): one sentence → finished MP4 */}
            {fullVideoAvailable && (
              <div
                className={`mt-4 rounded-2xl border p-4 transition ${
                  fullVideoOn ? "border-purple-400/40 bg-gradient-to-br from-purple-500/10 to-blue-500/5" : "border-white/10 bg-[#0d0d16]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className={`flex items-center gap-3 ${fullVideoSupported ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
                    <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                      <input
                        type="checkbox"
                        checked={fullVideoOn}
                        disabled={!fullVideoSupported}
                        onChange={(e) => {
                          setIncludeFullVideo(e.target.checked);
                          if (e.target.checked) setIncludeVoiceover(true);
                        }}
                        className="peer sr-only"
                      />
                      <span className="absolute inset-0 rounded-full bg-white/10 transition peer-checked:bg-gradient-to-r peer-checked:from-purple-500 peer-checked:to-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-purple-400/60" />
                      <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                    </span>
                    <span>
                      <span className="flex items-center gap-2 text-sm font-semibold text-white">
                        <Film size={15} className="text-purple-300" />
                        Render the full video
                        <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2 py-0.5 text-[11px] font-medium text-purple-200">
                          Private beta
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">
                        {fullVideoSupported
                          ? "Finished MP4 with narration, burned-in subtitles and AI visuals — ready to upload."
                          : "Available for 30 and 60 second videos for now."}
                      </span>
                    </span>
                  </label>
                </div>

                {fullVideoOn && (
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {(
                      [
                        { id: "hybrid", name: "Hybrid", hint: "AI video clips for key moments, cinematic stills in between" },
                        { id: "cinematic", name: "Cinematic", hint: "Every scene is an AI video clip" },
                        { id: "stills", name: "Stills", hint: "Cinematic AI stills with camera motion, no video clips" },
                      ] as Array<{ id: FootageMode; name: string; hint: string }>
                    ).map((m) => {
                      const plan = fullVideoPlan(duration, m.id);
                      const active = footage === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setFootage(m.id)}
                          aria-pressed={active}
                          className={`rounded-xl border p-3 text-left transition ${
                            active ? "border-purple-400/60 bg-purple-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-white">{m.name}</span>
                            {plan && (
                              <span className="rounded-full border border-yellow-400/20 bg-yellow-500/5 px-2 py-0.5 text-[11px] font-medium text-yellow-300">
                                +{plan.credits.total}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">{m.hint}</span>
                          {plan && (
                            <span className="mt-1 block text-[11px] text-gray-500">
                              {plan.klingSlots > 0 ? `${plan.klingSlots} AI clips` : "no AI clips"}
                              {plan.stillSlots > 0 ? ` · ${plan.stillSlots} stills` : ""} · {plan.seconds}s render
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Video clips (Kling) — gated until launch */}
            {!fullVideoOn && (
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
            )}

            {!generationAvailable && (
              <p className="mt-6 rounded-xl border border-yellow-400/30 bg-yellow-500/10 p-4 text-sm text-yellow-100">
                {launchLockMessage ?? "Content generation is temporarily closed."}
              </p>
            )}

            {error && (
              <p className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </p>
            )}

            {/* Sticky action bar: cost + Generate always within reach */}
            <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 rounded-b-2xl border-t border-white/10 bg-[#0a0a12]/90 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gray-400">
                    Total <span className="font-semibold text-white">{totalCost} credits</span>
                  </span>
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
                  {generationAvailable && balance !== null && balance < totalCost && (
                    <Link href="/billing" className="text-xs font-semibold text-blue-300 underline-offset-2 hover:underline">
                      Top up credits →
                    </Link>
                  )}
                </div>

                <button
                  onClick={handleGenerate}
                  disabled={
                    starting ||
                    !generationAvailable ||
                    (balance !== null && balance < totalCost) ||
                    (jobId !== null && !error) ||
                    (includeVoiceover && (!effectiveVoiceId || voicesLoading))
                  }
                  className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3 font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:opacity-90 disabled:opacity-50 disabled:shadow-none"
                >
                  {starting ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Starting…
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </div>

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
