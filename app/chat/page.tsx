"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Captions, CheckCircle2, Film, Globe, ChevronDown, ChevronUp, Clapperboard, Coins, LayoutTemplate, Palette, Loader2, Mic, Play, Search, Sparkles, Square, MessageCircle, Shuffle, Drama, Lock } from "lucide-react";
import Link from "next/link";
import Disclosure from "../components/Disclosure";
import { PageHeader } from "../components/PageTabs";
import Sidebar from "../components/Sidebar";
import PipelineProgress from "../components/PipelineProgress";
import CastPicker from "../components/CastPicker";
import ModeGuide from "../components/ModeGuide";
import SkitStudio from "../components/studio/SkitStudio";
import TalkStudio from "../components/studio/TalkStudio";
import SwapStudio from "../components/studio/SwapStudio";
import { FREE_PLAN, FREE_PLAN_UPGRADE_MESSAGE, JOB_COSTS } from "@/lib/plans";

/** Cheapest finished video (30 s, Stock + AI): what free credits are pointed at. */
const starterVideoCredits = JOB_COSTS.video30Stock;
import type { CharacterItem } from "../components/CharactersCard";

import { DURATIONS, LANGUAGE_OPTIONS, LANGUAGES, ORIENTATIONS, PLATFORMS, STYLES, defaultOrientation, languageOption, type OrientationId } from "@/lib/pipeline/options";
import { NICHE_TEMPLATES } from "@/lib/pipeline/templates";
import { CaptionStylePicker, VisualStylePicker } from "../components/StylePickers";
import { DEFAULT_CAPTION_STYLE, DEFAULT_VISUAL_STYLE, isCaptionStyle, isVisualStyle, VISUAL_STYLES, CAPTION_STYLES } from "@/lib/pipeline/visual-styles";
import {
  fullVideoPlan,
  footageModesFor,
  FULL_VIDEO_DURATIONS,
  SHORT_FORM_MAX_SECONDS,
  RESEARCH_CREDITS,
  subtitlesCredits,
  isTrialVideoShape,
  TRIAL_VIDEO,
  voiceoverCredits,
  totalPipelineCredits,
  type FootageMode,
  type ClipMode,
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
  source?: "account" | "library" | "gemini" | "clone";
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
  notes?: string;
  platform: string;
  style: string;
  duration: string;
  language: string;
  includeVoiceover: boolean;
  includeResearch?: boolean;
  includeSubtitles?: boolean;
  includeFullVideo?: boolean;
  footage?: FootageMode;
  clipMode?: ClipMode;
  voiceId: string;
  orientation?: OrientationId;
  template?: string | null;
  visualStyle?: string;
  captionStyle?: string;
}

function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Partial<Draft>;
  } catch {
    return {};
  }
}

type WorkspaceMode = "video" | "skit" | "talk" | "swap";

const MODES: Array<{ id: WorkspaceMode; label: string; hint: string; placeholder: string }> = [
  { id: "video", label: "Narrated video", hint: "Story, documentary or explainer with a narrator", placeholder: "e.g. The mystery of planes lost in the Bermuda Triangle…" },
  { id: "skit", label: "Skit with dialogue", hint: "A joke or scene: characters talk to each other", placeholder: "Paste the joke with its lines, e.g.\n- Boss: In 10 years we'll land a man on the sun!\n- Reporter: But the sun is too hot?\n- Boss: We'll land at night!\nMake it like the viral cockroach videos." },
  { id: "talk", label: "Talking character", hint: "One character says your line to the camera", placeholder: "Write what the character says, e.g. \"Ladies and gentlemen, I am the best coach in this barn!\"" },
  { id: "swap", label: "Character swap", hint: "Put a character into a clip you upload", placeholder: "Describe the clip or how the character should look (optional)" },
];

/** Best guess of what the creator wants to make, from what they wrote. */
function suggestMode(text: string): WorkspaceMode | null {
  const t = text.trim();
  if (t.length < 8) return null;
  if (/\b(swap|face ?swap|deepfake)\b|yüz(ümü|ünü)? (değiştir|koy)|yerine (beni|kendimi)|videoya (beni|kendimi)|klib(e|in)/i.test(t)) return "swap";
  const dialogue = t.split(/\n/).filter((l) => /^\s*[-–—•]\s*\S/.test(l) || /^\s*[\p{L} .]{2,25}:\s*\S/u.test(l)).length;
  const quoted = (t.match(/["“”«»„][^"“”«»„\n]{3,}["“”«»„]/g) ?? []).length;
  if (dialogue >= 2 || quoted >= 2 || /skeç|skit|diyalog|dialogue|sketch|videolarına uyarla|videolarına benzet|videosu gibi|videoları gibi|şaka|fıkra|joke/i.test(t)) return "skit";
  if (/(söylesin|desin|konuşsun|konuşan|talking (character|head)|says?:|lip ?sync)/i.test(t)) return "talk";
  return "video";
}

function ChatContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [idea, setIdea] = useState("");
  const [mode, setModeState] = useState<WorkspaceMode>("video");
  const [modeLocked, setModeLocked] = useState(false);
  const setMode = (m: WorkspaceMode) => {
    setModeState(m);
    setModeLocked(true);
  };
  const suggested = suggestMode(idea);
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  // "Make it from a link": an article/blog page becomes the research brief.
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [platform, setPlatform] = useState<string>(PLATFORMS[0]);
  const [style, setStyle] = useState<string>(STYLES[0]);
  const [durationPick, setDuration] = useState<string>(DURATIONS[1]);
  const [language, setLanguage] = useState<string>(LANGUAGES[0]);
  const [orientationPick, setOrientation] = useState<OrientationId>(defaultOrientation(PLATFORMS[0]));
  const [orientationTouched, setOrientationTouched] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [includeVoiceover, setIncludeVoiceover] = useState(false);
  const [includeResearch, setIncludeResearch] = useState(true);
  const [includeSubtitles, setIncludeSubtitles] = useState(true);
  const [includeVideo, setIncludeVideo] = useState(false);
  const [videoAvailable, setVideoAvailable] = useState(false);
  const [includeFullVideo, setIncludeFullVideo] = useState(false);
  const [footagePick, setFootage] = useState<FootageMode>("hybrid");
  // Accounts that haven't paid yet start on the cheapest finished video (Stock + AI), 6 Nov 2026.
  const [freeAccount, setFreeAccount] = useState(false);
  /** Shown after a free account taps a locked option. */
  const [upgradeHint, setUpgradeHint] = useState(false);
  const upgradeRef = useRef<HTMLDivElement>(null);
  function askUpgrade() {
    setUpgradeHint(true);
    setTimeout(() => upgradeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }
  const footageFromDraft = useRef(false);
  const [clipMode, setClipMode] = useState<ClipMode>("image");
  const [visualStyle, setVisualStyle] = useState<string>(DEFAULT_VISUAL_STYLE);
  const [captionStyleId, setCaptionStyleId] = useState<string>(DEFAULT_CAPTION_STYLE);
  const [brandKit, setBrandKit] = useState<{ logoUrl: string | null; color: string | null; outroText: string | null } | null>(null);
  const [useBrandKit, setUseBrandKit] = useState(true);
  /** Brand kit end card ("Follow for more…"): a separate choice, off by default (6 Nov 2026). */
  const [useEndCard, setUseEndCard] = useState(false);
  useEffect(() => {
    fetch("/api/brand")
      .then((r) => r.json())
      .then((d) => {
        const k = d?.kit;
        if (k && (k.logoUrl || k.color || k.outroText)) setBrandKit(k);
      })
      .catch(() => undefined);
  }, []);
  // Recurring characters (picked and created right here, also in Settings): up to 3 per video.
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [charactersAllowed, setCharactersAllowed] = useState(false);
  const [castIds, setCastIds] = useState<string[]>([]);
  // Talking presenter: one chosen character speaks to camera (lip-synced) in a few scenes.
  const [presenterId, setPresenterId] = useState<string | null>(null);
  // Storyboard review: pause after the script so the creator can approve it.
  const [reviewFirst, setReviewFirst] = useState(true);
  useEffect(() => {
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => {
        setCharacters(d?.characters ?? []);
        setCharactersAllowed(Boolean(d?.allowed));
      })
      .catch(() => undefined);
  }, []);
  const [fullVideoAvailable, setFullVideoAvailable] = useState(false);
  const [trialVideoAvailable, setTrialVideoAvailable] = useState(false);
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
  // Status of the shown job (from PipelineProgress); a running job locks "new video".
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  // A job we just started (or know is running) counts as running before its first status arrives;
  // one restored from ?job= after a reload stays quiet until we know (no flash of the stage).
  const [jobKnownRunning, setJobKnownRunning] = useState(false);
  const jobRunning =
    jobId !== null && (jobStatus === "running" || jobStatus === "queued" || (jobStatus === null && jobKnownRunning));
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceQuery, setVoiceQuery] = useState("");
  const [voiceListOpen, setVoiceListOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(true);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Free plan (never paid): one fixed setup, everything else leads to buying (lib/plans.ts FREE_PLAN).
  const freeDurations: readonly string[] = fullVideoAvailable ? [FREE_PLAN.videoDuration] : FREE_PLAN.packageDurations;
  const duration = freeAccount && !freeDurations.includes(durationPick) ? freeDurations[0] : durationPick;
  // Long-form (> 60 s) offers stock / hybrid / stills only and renders 16:9.
  const footageModes = footageModesFor(duration);
  const footage: FootageMode = freeAccount ? "stock" : footageModes.includes(footagePick) ? footagePick : "stock";
  const fullVideoOn = includeFullVideo && fullVideoAvailable && Boolean(fullVideoPlan(duration, footage));
  const longFullVideo = fullVideoOn && (FULL_VIDEO_DURATIONS[duration] ?? 0) > SHORT_FORM_MAX_SECONDS;
  const orientation: OrientationId = longFullVideo ? "horizontal" : orientationPick;
  const costOptions = {
    research: includeResearch || Boolean(sourceUrl.trim()),
    voiceover: includeVoiceover || fullVideoOn,
    subtitles: (includeVoiceover || fullVideoOn) && includeSubtitles,
    video: !fullVideoOn && includeVideo && videoAvailable,
    fullVideo: fullVideoOn,
    footage,
    clipMode,
    duration,
    // An ElevenLabs voice costs more per minute than a built-in Gemini narrator.
    voiceEngine: (voiceId && !voiceId.startsWith("gemini:") ? "elevenlabs" : "gemini") as "elevenlabs" | "gemini",
    presenter: fullVideoOn && Boolean(presenterId && castIds.includes(presenterId)),
  };
  // The free-trial video (one 30 s hybrid video per account) costs nothing.
  const isTrialVideo = trialVideoAvailable && fullVideoOn && isTrialVideoShape(costOptions);
  const totalCost = isTrialVideo ? 0 : totalPipelineCredits(costOptions);

  const fullVideoSupported = Boolean(FULL_VIDEO_DURATIONS[duration]);
  const videoCost = VIDEO_CLIP_CREDITS * VIDEO_MAX_CLIPS;

  // Restore an in-progress job from the URL and the last settings from sessionStorage.
  useEffect(() => {
    const job = searchParams.get("job");
    const draft = readDraft();
    const id = setTimeout(() => {
      // The idea box starts empty on every load; only the settings come back (7 Nov 2026, Yağmur).
      if (typeof draft.platform === "string") setPlatform(draft.platform);
      if (typeof draft.style === "string") setStyle(draft.style);
      if (typeof draft.duration === "string") setDuration(draft.duration);
      if (typeof draft.language === "string") setLanguage(draft.language);
      if (typeof draft.includeVoiceover === "boolean") setIncludeVoiceover(draft.includeVoiceover);
      if (typeof draft.includeSubtitles === "boolean") setIncludeSubtitles(draft.includeSubtitles);
      if (typeof draft.includeResearch === "boolean") setIncludeResearch(draft.includeResearch);
      if (typeof draft.includeFullVideo === "boolean") setIncludeFullVideo(draft.includeFullVideo);
      if (draft.footage === "hybrid" || draft.footage === "cinematic" || draft.footage === "stills" || draft.footage === "stock") {
        setFootage(draft.footage);
        footageFromDraft.current = true;
      }
      if (draft.clipMode === "image" || draft.clipMode === "text") setClipMode(draft.clipMode);
      if (typeof draft.voiceId === "string") setVoiceId(draft.voiceId);
      if (draft.orientation === "vertical" || draft.orientation === "horizontal") {
        setOrientation(draft.orientation);
        setOrientationTouched(true);
      }
      if (typeof draft.template === "string") setTemplateId(draft.template);
      if (isVisualStyle(draft.visualStyle)) setVisualStyle(draft.visualStyle);
      if (isCaptionStyle(draft.captionStyle)) setCaptionStyleId(draft.captionStyle);
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
        setJobKnownRunning(false);
        setJobId(job);
      } else {
        // Came back from another page while something is still being made: open
        // that studio and show its progress again (narrated video, skit, talking
        // character or swap). An explicit ?mode= wins.
        const wantedMode = searchParams.get("mode");
        fetch("/api/pipeline/active", { cache: "no-store" })
          .then((r) => r.json())
          .then((d) => {
            const active = d?.active as { mode: string; id: string } | null | undefined;
            if (active?.mode === "video" && typeof active.id === "string") {
              setJobKnownRunning(true);
              setJobId(active.id);
              setFormOpen(false);
              setModeState("video");
              router.replace(`${pathname}?job=${active.id}`, { scroll: false });
            } else if ((active?.mode === "skit" || active?.mode === "talk" || active?.mode === "swap") && !wantedMode) {
              setModeState(active.mode);
              setModeLocked(true);
            }
          })
          .catch(() => undefined);
      }
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const draft: Draft = { idea: "", notes: "", platform, style, duration, language, includeVoiceover, includeResearch, includeSubtitles, includeFullVideo, footage: footagePick, clipMode, voiceId, orientation: orientationPick, template: templateId, visualStyle, captionStyle: captionStyleId };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // storage unavailable
    }
  }, [platform, style, duration, language, includeVoiceover, includeResearch, includeSubtitles, includeFullVideo, footagePick, clipMode, voiceId, orientationPick, templateId, visualStyle, captionStyleId]);

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
        if (active && data?.success) {
          setBalance(Number(data.credits ?? 0));
          if (data.freeTrial) {
            setFreeAccount(true);
            if (!footageFromDraft.current) setFootage("stock");
          }
        }
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
          setTrialVideoAvailable(Boolean(data.features?.trialVideo));
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
          // Gemini narrators (the default engine) come first for every
          // language; ElevenLabs voices stay available below them.
          const mine: VoiceOption[] = data.mine ?? [];
          const gemini: VoiceOption[] = data.gemini ?? [];
          const account: VoiceOption[] = data.voices ?? [];
          const library: VoiceOption[] = data.library ?? [];
          const loaded: VoiceOption[] = [
            ...gemini,
            ...mine,
            ...(data.languageCode === "en" ? [...account, ...library] : [...library, ...account]),
          ];
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
  const firstGemini = voices.find((v) => v.voice_id.startsWith("gemini:"))?.voice_id;
  const effectiveVoiceId =
    freeAccount && !(voiceId || "").startsWith("gemini:") ? firstGemini || "" : voiceId || voices[0]?.voice_id || "";
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
    if (freeAccount && !id.startsWith("gemini:")) {
      askUpgrade();
      return;
    }
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
    if (idea.trim().length < 5 && !sourceUrl.trim()) {
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
          notes: notes.trim() || null,
          sourceUrl: sourceUrl.trim() || undefined,
          platform,
          style,
          duration,
          outputLanguage: language,
          includeVoiceover: includeVoiceover || fullVideoOn,
          includeResearch,
          includeSubtitles: (includeVoiceover || fullVideoOn) && includeSubtitles,
          voiceId: includeVoiceover || fullVideoOn ? effectiveVoiceId : null,
          voicePublicOwnerId: includeVoiceover || fullVideoOn ? selectedVoice?.public_owner_id ?? null : null,
          voiceName: includeVoiceover || fullVideoOn ? selectedVoice?.name ?? null : null,
          includeVideo: !fullVideoOn && includeVideo && videoAvailable,
          includeFullVideo: fullVideoOn,
          footage,
          clipMode,
          orientation,
          template: templateId,
          visualStyle,
          captionStyle: captionStyleId,
          useBrandKit: Boolean(brandKit) && useBrandKit,
          endCard: Boolean(brandKit?.outroText) && useBrandKit && useEndCard,
          characterIds: castIds.filter((id) => characters.some((c) => c.id === id)),
          presenter: costOptions.presenter,
          presenterId: costOptions.presenter ? presenterId : undefined,
          review: fullVideoOn && reviewFirst,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        // Another video is still running: bring its progress back instead.
        if (data.code === "job_in_progress" && typeof data.jobId === "string") {
          setJobStatus(null);
          setJobKnownRunning(true);
          setJobId(data.jobId);
          setFormOpen(false);
          router.replace(`${pathname}?job=${data.jobId}`, { scroll: false });
        }
        if (data.code === "upgrade_required") askUpgrade();
        throw new Error(data.error || "Pipeline could not start.");
      }

      setJobStatus(null);
      setJobKnownRunning(true);
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

  // ?mode=skit|talk|swap opens that tool; otherwise follow what the creator writes
  // until they pick a mode themselves (a running video keeps the video mode).
  const modeParam = searchParams.get("mode");
  useEffect(() => {
    if (modeParam === "skit" || modeParam === "talk" || modeParam === "swap" || modeParam === "video") {
      const t = setTimeout(() => setMode(modeParam), 0);
      return () => clearTimeout(t);
    }
  }, [modeParam]);
  useEffect(() => {
    if (modeLocked || jobId || !suggested) return;
    const t = setTimeout(() => setModeState(suggested), 600);
    return () => clearTimeout(t);
  }, [suggested, modeLocked, jobId]);
  const modeInfo = MODES.find((m) => m.id === mode)!;

  const selectClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-[var(--nv-field)] p-3 text-white outline-none focus:border-blue-400/50";

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[var(--nv-bg)] text-white">
      <Sidebar />

      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <PageHeader title="AI Workspace" subtitle="Write what you want to make: narrated videos, skits, talking characters or swaps" />

          {/* While a narrated video is being made or waits for approval, only its progress shows. */}
          <div className={`mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 ${mode === "video" && jobId && (jobRunning || !formOpen) ? "hidden" : ""}`}>
            <div className="flex items-center justify-between">
              <label htmlFor="workspace-idea" className="text-sm text-gray-400">
                What do you want to make?
              </label>
              {idea && !jobRunning && (
                <button type="button" onClick={() => setIdea("")} className="text-xs text-gray-500 transition hover:text-white">
                  Clear
                </button>
              )}
            </div>
            <textarea
              id="workspace-idea"
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder={modeInfo.placeholder}
              rows={mode === "skit" ? 6 : 3}
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white placeholder-gray-500 outline-none focus:border-blue-400/50"
            />
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="What to make">
              {MODES.map((m) => {
                const on = mode === m.id;
                const Icon = m.id === "video" ? Film : m.id === "skit" ? Drama : m.id === "talk" ? MessageCircle : Shuffle;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMode(m.id)}
                    className={`relative rounded-xl border p-3 text-left transition ${on ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 hover:border-white/25"}`}
                  >
                    <Icon size={16} className={on ? "text-blue-300" : "text-gray-400"} aria-hidden />
                    <span className="mt-1.5 block text-sm font-semibold text-white">{m.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-gray-400">{m.hint}</span>
                    {freeAccount && m.id !== "video" && (
                      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] text-gray-300">
                        <Lock size={10} aria-hidden /> Paid
                      </span>
                    )}
                    {suggested === m.id && !on && !(freeAccount && m.id !== "video") && (
                      <span className="absolute right-2 top-2 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">Suggested</span>
                    )}
                  </button>
                );
              })}
            </div>
            <ModeGuide mode={mode} onSelectMode={setMode} />
          </div>

          {mode === "skit" && (
            <div className="mt-5">
              {freeAccount ? <UpgradeCard /> : <SkitStudio text={idea} onStarted={() => setIdea("")} />}
            </div>
          )}
          {mode === "talk" && (
            <div className="mt-5">
              {freeAccount ? <UpgradeCard /> : <TalkStudio text={idea} onStarted={() => setIdea("")} />}
            </div>
          )}
          {mode === "swap" && (
            <div className="mt-5">
              {freeAccount ? <UpgradeCard /> : <SwapStudio />}
            </div>
          )}

          {mode === "video" && upgradeHint && freeAccount && (
            <div ref={upgradeRef} className="mt-5">
              <UpgradeCard onClose={() => setUpgradeHint(false)} />
            </div>
          )}

          {mode === "video" && (<>
          <div ref={progressRef} className="scroll-mt-20">
            {jobId && <PipelineProgress
                jobId={jobId}
                quietUntilLoaded={!jobKnownRunning}
                onStatus={(st) => {
                  setJobStatus(st);
                  // Finished or failed: the result stays first on the page (7 Nov 2026, Yağmur: "en üstte
                  // gözüksün"); the form stays folded under it and the buttons below start the next one.
                  if (st && st !== "running" && st !== "queued") {
                    setFormOpen(false);
                    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
                  }
                }}
              />}
          </div>

          {jobId && jobRunning && (
            <p className="mt-4 text-sm text-gray-400">
              You can start your next video when this one finishes. It keeps going if you leave this page. Come back here or check Projects.
            </p>
          )}

          {jobId && !jobRunning && (
            <div className="mt-4 flex flex-wrap gap-4">
              <button
                onClick={() => {
                  setJobId(null);
                  setJobStatus(null);
                  setError("");
                  setFormOpen(true);
                  router.replace(pathname, { scroll: false });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:border-white/30"
              >
                Run again with the same idea &amp; settings
              </button>
              <button
                onClick={() => {
                  setJobId(null);
                  setJobStatus(null);
                  setIdea("");
                  setNotes("");
                  setNotesOpen(false);
                  setError("");
                  setFormOpen(true);
                  router.replace(pathname, { scroll: false });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Make a new video
              </button>
            </div>
          )}

          {jobId && !formOpen && !jobRunning && (
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
                  {fullVideoOn ? ` · full video (${footage}${footage === "stills" || footage === "stock" ? "" : clipMode === "text" ? ", text→video" : ", image→video"})` : ""}
                  {templateId ? ` · ${NICHE_TEMPLATES.find((t) => t.id === templateId)?.name}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-gray-400">
                Edit settings <ChevronDown size={14} />
              </span>
            </button>
          )}

          <div className={`mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 ${(jobId && !formOpen) || jobRunning ? "hidden" : ""}`}>
            {jobId && (
              <div className="-mt-1 mb-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-400 transition hover:bg-white/[0.05] hover:text-white"
                >
                  Hide settings <ChevronUp size={14} />
                </button>
              </div>
            )}

            {sourceOpen ? (
              <div className="mt-3">
                <label htmlFor="source-url" className="text-sm text-gray-400">
                  Make it from a link <span className="text-gray-500">(article, blog post, Wikipedia page)</span>
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id="source-url"
                    type="url"
                    inputMode="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value.slice(0, 2000))}
                    placeholder="https://…"
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-400/50"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setSourceUrl("");
                      setSourceOpen(false);
                    }}
                    className="shrink-0 rounded-xl px-3 text-xs text-gray-400 hover:text-white"
                  >
                    Remove
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-gray-500">
                  The script tells what the page says (research is included). The idea above is optional. Use it for your angle.
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSourceOpen(true)}
                className="mr-4 mt-2 text-xs text-blue-300 transition hover:text-blue-200"
              >
                + Make it from a link
              </button>
            )}

            {notesOpen ? (
              <div className="mt-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="creator-notes" className="text-sm text-gray-400">
                    Angle &amp; notes <span className="text-gray-500">(optional)</span>
                  </label>
                  <span className="text-[11px] text-gray-500">{notes.length}/500</span>
                </div>
                <textarea
                  id="creator-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                  placeholder="e.g. Focus on Flight 19, keep the scientific explanation for the end, avoid aliens."
                  rows={2}
                  className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white placeholder-gray-500 outline-none focus:border-blue-400/50"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setNotesOpen(true)}
                className="mt-2 text-xs text-blue-300 transition hover:text-blue-200"
              >
                + Add an angle or notes for the writer
              </button>
            )}

            {/* Niche templates (optional) */}
            <Disclosure
              className="mt-3"
              title="Start from a template"
              icon={<LayoutTemplate size={15} />}
              summary={templateId ? NICHE_TEMPLATES.find((t) => t.id === templateId)?.name : "Optional: ready-made settings and idea examples for popular niches"}
            >
              <div className="mt-3 flex flex-wrap gap-2">
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
                    {NICHE_TEMPLATES.find((t) => t.id === templateId)?.tagline}. Try one of these:
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {NICHE_TEMPLATES.find((t) => t.id === templateId)?.examples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        onClick={() => setIdea(ex)}
                        className="rounded-lg border border-white/10 bg-[var(--nv-panel)] px-2.5 py-1.5 text-left text-xs text-gray-200 transition hover:border-purple-400/40"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Disclosure>

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
                  onChange={(e) => {
                    if (freeAccount && !freeDurations.includes(e.target.value)) {
                      askUpgrade();
                      return;
                    }
                    setDuration(e.target.value);
                  }}
                  className={selectClass}
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>
                      {freeAccount && !freeDurations.includes(d)
                        ? `${d} · 🔒 paid plans`
                        : fullVideoAvailable && !FULL_VIDEO_DURATIONS[d]
                          ? `${d} · script & voice only`
                          : d}
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

            {/* Look: format, visual style, brand kit */}
            <Disclosure
              className="mt-4"
              title="Look"
              icon={<Palette size={15} />}
              summary={`${orientation === "vertical" ? "Vertical 9:16" : "Horizontal 16:9"} · ${VISUAL_STYLES.find((v) => v.id === visualStyle)?.label ?? "Cinematic"}${brandKit ? (useBrandKit ? " · brand kit on" : " · brand kit off") : ""}`}
            >
            {/* Orientation */}
            <div className="mt-3">
              <label className="text-sm text-gray-400">Output format</label>
              {longFullVideo && <p className="mt-0.5 text-xs text-gray-500">Full videos longer than 60 seconds are made for YouTube in 16:9.</p>}
              <div className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Output format">
                {ORIENTATIONS.map((o) => {
                  const active = orientation === o.id;
                  const locked = longFullVideo && o.id === "vertical";
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={locked}
                      title={locked ? "Videos longer than 60 seconds are 16:9" : undefined}
                      onClick={() => {
                        setOrientation(o.id);
                        setOrientationTouched(true);
                      }}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        active
                          ? "border-blue-400/50 bg-blue-500/10"
                          : "border-white/10 bg-[var(--nv-field)] hover:border-white/20"
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

            <VisualStylePicker value={visualStyle} onChange={setVisualStyle} />

            {brandKit && (
              <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-[var(--nv-panel)] p-4">
                <input type="checkbox" checked={useBrandKit} onChange={(e) => setUseBrandKit(e.target.checked)} className="h-4 w-4 accent-purple-500" />
                {brandKit.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brandKit.logoUrl} alt="" className="h-8 w-8 rounded object-contain" />
                ) : (
                  <span className="h-6 w-6 rounded-full border border-white/20" style={{ background: brandKit.color ?? "transparent" }} />
                )}
                <span className="text-sm">
                  <span className="font-semibold text-white">Apply my brand kit</span>
                  <span className="block text-xs text-gray-400">
                    Logo and brand colour from{" "}
                    <Link href="/settings" className="text-purple-300 hover:text-white">
                      Settings
                    </Link>
                    . Free.
                  </span>
                </span>
              </label>
            )}
            {brandKit?.outroText && useBrandKit && (
              <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-[var(--nv-panel)] p-4">
                <input type="checkbox" checked={useEndCard} onChange={(e) => setUseEndCard(e.target.checked)} className="h-4 w-4 accent-purple-500" />
                <span className="text-sm">
                  <span className="font-semibold text-white">Add an end card</span>
                  <span className="block text-xs text-gray-400">Shows &ldquo;{brandKit.outroText}&rdquo; for the last 2.5 seconds. Free.</span>
                </span>
              </label>
            )}

            </Disclosure>

            {charactersAllowed && (
              <CastPicker
                className="mt-4"
                idea={idea}
                characters={characters}
                setCharacters={setCharacters}
                castIds={castIds}
                setCastIds={setCastIds}
                presenter={
                  fullVideoOn
                    ? {
                        id: presenterId && castIds.includes(presenterId) ? presenterId : null,
                        set: setPresenterId,
                        credits: (() => {
                          const p = fullVideoPlan(duration, footage, clipMode, true);
                          return p?.credits.avatar ?? 0;
                        })(),
                        scenes: fullVideoPlan(duration, footage, clipMode, true)?.avatarSlots ?? 0,
                      }
                    : null
                }
              />
            )}

            {/* Web research before the script */}
            <div
              className={`mt-4 rounded-2xl border p-4 transition ${
                includeResearch ? "border-blue-400/30 bg-[var(--nv-panel)]" : "border-white/10 bg-[var(--nv-panel)]"
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
                    Searches the web for current, sourced facts before writing, essential for news, sports and recent events
                  </span>
                </span>
              </label>
            </div>

            {/* Voiceover */}
            <div
              className={`mt-4 rounded-2xl border p-4 transition ${
                includeVoiceover ? "border-blue-400/30 bg-[var(--nv-panel)]" : "border-white/10 bg-[var(--nv-panel)]"
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
                        +{voiceoverCredits(voiceId && !voiceId.startsWith("gemini:") ? "elevenlabs" : "gemini", duration)} credits
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      Narration of the full script, delivered as an audio file
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
                              Native
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
                      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-[var(--nv-field)] px-2.5 py-1.5">
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
                      No narrators tagged for {language} yet. These voices still speak {language} fluently with the multilingual model.
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
                      {filteredVoices.map((voice, index) => {
                        const groupOf = (v: VoiceOption) => (v.source === "gemini" ? "gemini" : v.source === "clone" ? "mine" : "native");
                        const group = groupOf(voice);
                        const prevGroup = index > 0 ? groupOf(filteredVoices[index - 1]) : null;
                        const groupHeader =
                          group !== prevGroup ? (
                            <p
                              key={`h-${group}`}
                              className={`px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 sm:col-span-2 lg:col-span-3 ${
                                index > 0 ? "mt-2" : ""
                              }`}
                            >
                              {group === "gemini"
                                ? "Norveko narrators · speak every language"
                                : group === "mine"
                                ? "Your voice"
                                : nativeMatch
                                ? `Native ${language} voice artists`
                                : "More voices · multilingual"}
                              {freeAccount && group !== "gemini" && " · paid plans"}
                            </p>
                          ) : null;
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
                          <Fragment key={voice.voice_id}>
                          {groupHeader}
                          <div
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
                                    Native
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
                          </Fragment>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Subtitles — optional add-on to the voiceover (also for full videos) */}
            {(includeVoiceover || fullVideoOn) && (
              <div
                className={`mt-4 rounded-2xl border p-4 transition ${
                  includeSubtitles ? "border-blue-400/30 bg-[var(--nv-panel)]" : "border-white/10 bg-[var(--nv-panel)]"
                }`}
              >
                <label className="flex cursor-pointer items-center gap-3">
                  <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                    <input
                      type="checkbox"
                      checked={includeSubtitles}
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
                        +{subtitlesCredits(duration)} credits
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {fullVideoOn
                        ? "Word-timed captions burned into the video · also downloadable as .srt or .vtt"
                        : "Word-timed captions synced to the narration · download as .srt or .vtt for YouTube, CapCut, Premiere"}
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* Full video (private beta): one sentence → finished MP4 */}
            {fullVideoAvailable && (
              <div
                className={`mt-4 rounded-2xl border p-4 transition ${
                  fullVideoOn ? "border-purple-400/40 bg-gradient-to-br from-purple-500/10 to-blue-500/5" : "border-white/10 bg-[var(--nv-panel)]"
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
                          ? "Finished MP4 with narration, AI visuals and optional subtitles, ready to upload."
                          : "Full videos are 30 or 60 seconds for now. Longer durations give you the script, voiceover and thumbnail."}
                      </span>
                    </span>
                  </label>
                </div>

                {trialVideoAvailable && (
                  <div className="mt-4 flex flex-col gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-emerald-100">
                      <span className="font-semibold">Your free trial includes one 30-second video.</span>{" "}
                      Hybrid footage, image → video clips, with a small Norveko watermark.
                    </p>
                    {!isTrialVideo && (
                      <button
                        type="button"
                        onClick={() => {
                          setDuration(TRIAL_VIDEO.duration);
                          setFootage(TRIAL_VIDEO.footage);
                          setClipMode(TRIAL_VIDEO.clipMode);
                          setIncludeFullVideo(true);
                          setIncludeVoiceover(true);
                        }}
                        className="shrink-0 rounded-lg bg-emerald-500/80 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                      >
                        Use my free video
                      </button>
                    )}
                  </div>
                )}

                {fullVideoOn && freeAccount && !trialVideoAvailable && (
                  <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-100">
                    <span className="font-semibold">Your free video: 30 seconds, Stock + AI, a Norveko narrator.</span>{" "}
                    It costs {starterVideoCredits} credits, so your free credits cover it. Other lengths, footage styles and voices unlock with any pack or plan.
                  </div>
                )}

                {fullVideoOn && (
                  <div className={`mt-4 grid gap-2 ${footageModes.length > 3 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                    {(
                      [
                        { id: "stock", name: "Stock + AI", hint: "Real stock video and archive photos of real places for most scenes, AI stills for the key moments. Lowest cost." },
                        { id: "hybrid", name: "Hybrid", hint: "AI video clips for key moments, cinematic stills in between" },
                        { id: "cinematic", name: "Cinematic", hint: "Every scene is an AI video clip" },
                        { id: "stills", name: "Stills", hint: "Cinematic AI stills with camera motion, no video clips" },
                      ] as Array<{ id: FootageMode; name: string; hint: string }>
                    ).filter((m) => footageModes.includes(m.id)).map((m) => {
                      const plan = fullVideoPlan(duration, m.id, clipMode);
                      const active = footage === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => (freeAccount && m.id !== "stock" ? askUpgrade() : setFootage(m.id))}
                          aria-pressed={active}
                          aria-disabled={freeAccount && m.id !== "stock"}
                          className={`rounded-xl border p-3 text-left transition ${
                            active ? "border-purple-400/60 bg-purple-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                          } ${freeAccount && m.id !== "stock" ? "opacity-60" : ""}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-white">{m.name}</span>
                            {freeAccount && m.id !== "stock" ? (
                              <span className="flex items-center gap-1 rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-gray-300">
                                <Lock size={11} aria-hidden /> Paid plans
                              </span>
                            ) : plan && (
                              <span className="rounded-full border border-yellow-400/20 bg-yellow-500/5 px-2 py-0.5 text-[11px] font-medium text-yellow-300">
                                +{plan.credits.total}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block text-xs text-gray-500">{m.hint}</span>
                          {plan && (
                            <span className="mt-1 block text-[11px] text-gray-500">
                              {plan.stockSlots > 0 ? `${plan.stockSlots} stock clips` : plan.klingSlots > 0 ? `${plan.klingSlots} AI clips` : "no AI clips"}
                              {plan.stillSlots > 0 ? ` · ${plan.stillSlots} stills` : ""} · {plan.seconds >= 120 ? `${plan.seconds / 60} min` : `${plan.seconds}s`} render
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {fullVideoOn && (
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-[var(--nv-panel)] p-3">
                    <input type="checkbox" checked={reviewFirst} onChange={(e) => setReviewFirst(e.target.checked)} className="mt-0.5 h-4 w-4 accent-sky-500" />
                    <span className="text-sm">
                      <span className="font-semibold text-white">Let me review the script first</span>
                      <span className="block text-xs text-gray-400">
                        The video pauses after the script so you can fix names, facts and scenes before the voice and visuals are made.
                      </span>
                    </span>
                  </label>
                )}

                {fullVideoOn && (
                <Disclosure
                  className="mt-3"
                  title="Clips & subtitles"
                  summary={`${footage === "stills" ? "No AI clips" : footage === "stock" ? "Stock clips" : clipMode === "text" ? "Text → video clips" : "Image → video clips"} · ${includeSubtitles ? `${CAPTION_STYLES.find((c) => c.id === captionStyleId)?.label ?? "Bold pop"} subtitles` : "No subtitles"}`}
                >
                {footage !== "stills" && footage !== "stock" && (
                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium text-gray-400">How AI clips are made</p>
                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Clip type">
                      {(
                        [
                          {
                            id: "image",
                            name: "Image → video",
                            hint: "Each clip animates its own AI scene image, so clips match the stills. Faster and cheaper.",
                          },
                          {
                            id: "text",
                            name: "Text → video",
                            hint: "Clips are generated straight from the scene prompt with free composition.",
                          },
                        ] as Array<{ id: ClipMode; name: string; hint: string }>
                      ).map((m) => {
                        const active = clipMode === m.id;
                        const plan = fullVideoPlan(duration, footage, m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setClipMode(m.id)}
                            className={`rounded-xl border p-3 text-left transition ${
                              active ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-white">{m.name}</span>
                              {plan && (
                                <span className="text-[11px] text-gray-400">
                                  {plan.clipCredits} credits / clip
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-xs text-gray-500">{m.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {includeSubtitles && <CaptionStylePicker value={captionStyleId} onChange={setCaptionStyleId} />}
                </Disclosure>
                )}
              </div>
            )}

            {/* Video clips (Kling) — only shown when the feature is on (a "coming soon" card was just clutter). */}
            {!fullVideoOn && videoAvailable && (
            <div
              className={`mt-4 rounded-2xl border p-4 ${
                videoAvailable
                  ? "border-white/10 bg-[var(--nv-panel)]"
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
            <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-6 rounded-b-2xl border-t border-white/10 bg-[var(--nv-bg)]/90 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gray-400">
                    Total{" "}
                    <span className="font-semibold text-white">
                      {isTrialVideo ? (
                        <span className="text-emerald-300">Free trial video</span>
                      ) : (
                        `${totalCost} credits`
                      )}
                    </span>
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
                    jobRunning ||
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

          </>)}
        </div>
      </main>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[var(--nv-bg)]">
          <Loader2 size={24} className="animate-spin text-blue-300" />
        </div>
      }
    >
      <ChatContent />
    </Suspense>
  );
}

/** Free accounts: one fixed setup; everything else points to a pack or a plan. */
function UpgradeCard({ onClose }: { onClose?: () => void }) {
  return (
    <div className="rounded-2xl border border-purple-400/30 bg-purple-500/10 p-5">
      <div className="flex items-start gap-3">
        <Lock size={18} className="mt-0.5 shrink-0 text-purple-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">This is part of the paid plans</p>
          <p className="mt-1 text-sm text-gray-300">{FREE_PLAN_UPGRADE_MESSAGE}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Link
              href="/billing"
              className="rounded-lg bg-purple-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple-400"
            >
              See plans and packs
            </Link>
            {onClose && (
              <button type="button" onClick={onClose} className="text-sm text-gray-400 transition hover:text-white">
                Keep the free setup
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
