"use client";

// app/components/AudioPlayer.tsx
// Custom voiceover player: real waveform (decoded from the MP3 in the browser),
// click-to-seek, play/pause, elapsed/total time, playback speed, mute, and an
// actions slot (download MP3, subtitles). Replaces the native <audio controls>.
//
// Waveform: the file is fetched once, decoded with the Web Audio API and
// reduced to ~96 peak bars. Until decoding finishes (or if it fails, e.g. CORS)
// a flat placeholder is shown, so the player always works.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play, Volume2, VolumeX } from "lucide-react";

const BAR_COUNT = 96;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function decodePeaks(url: string, bars: number, signal: AbortSignal): Promise<number[]> {
  const res = await fetch(url, { signal, mode: "cors" });
  if (!res.ok) throw new Error(`audio fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  type AC = typeof AudioContext;
  const Ctx: AC | undefined =
    (window as unknown as { AudioContext?: AC }).AudioContext ??
    (window as unknown as { webkitAudioContext?: AC }).webkitAudioContext;
  if (!Ctx) throw new Error("no AudioContext");
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(buf);
    const data = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let max = 0;
      const start = i * block;
      const end = Math.min(data.length, start + block);
      for (let j = start; j < end; j += 4) {
        const v = Math.abs(data[j]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const top = Math.max(...peaks, 0.01);
    return peaks.map((p) => Math.max(0.08, p / top));
  } finally {
    void ctx.close();
  }
}

export default function AudioPlayer({
  src,
  title = "Voiceover",
  subtitle,
  actions,
  className = "",
}: {
  src: string;
  title?: string;
  /** Small line under the title (e.g. "Liam · 0:51"). */
  subtitle?: string;
  /** Buttons rendered on the right (download, subtitles…). */
  actions?: React.ReactNode;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barsRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [scrubbing, setScrubbing] = useState(false);

  // Decode the waveform once per src. State is keyed by src so a new file
  // falls back to the placeholder without a synchronous reset in the effect.
  const [peaksFor, setPeaksFor] = useState<{ src: string; peaks: number[] } | null>(null);
  const peaks = peaksFor?.src === src ? peaksFor.peaks : null;
  useEffect(() => {
    const ctrl = new AbortController();
    decodePeaks(src, BAR_COUNT, ctrl.signal)
      .then((p) => setPeaksFor({ src, peaks: p }))
      .catch(() => {
        /* keep the placeholder bars */
      });
    return () => ctrl.abort();
  }, [src]);

  // Wire up the hidden <audio>.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => !scrubbing && setTime(a.currentTime);
    const onMeta = () => {
      setDuration(a.duration || 0);
      setReady(true);
    };
    const onEnd = () => setPlaying(false);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onMeta);
    a.addEventListener("durationchange", onMeta);
    a.addEventListener("ended", onEnd);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onMeta);
      a.removeEventListener("durationchange", onMeta);
      a.removeEventListener("ended", onEnd);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
    };
  }, [scrubbing]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }, []);

  const seekToClientX = useCallback(
    (clientX: number) => {
      const el = barsRef.current;
      const a = audioRef.current;
      if (!el || !a || !duration) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const t = ratio * duration;
      setTime(t);
      a.currentTime = t;
    },
    [duration]
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekToClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing) seekToClientX(e.clientX);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    seekToClientX(e.clientX);
    setScrubbing(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const a = audioRef.current;
    if (!a) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      a.currentTime = Math.min(duration, a.currentTime + 5);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      a.currentTime = Math.max(0, a.currentTime - 5);
    }
  };

  const progress = duration ? time / duration : 0;
  const bars = useMemo(() => peaks ?? Array.from({ length: BAR_COUNT }, () => 0.35), [peaks]);

  return (
    <div
      className={`nv-player rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-4 ${className}`}
    >
      <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" />

      <div className="flex items-center gap-4">
        {/* Play / pause */}
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          disabled={!ready}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/25 transition hover:scale-105 hover:shadow-blue-500/40 disabled:opacity-50 disabled:hover:scale-100"
        >
          {!ready ? (
            <Loader2 size={18} className="animate-spin" />
          ) : playing ? (
            <Pause size={18} fill="currentColor" />
          ) : (
            <Play size={18} fill="currentColor" className="ml-0.5" />
          )}
        </button>

        {/* Title + waveform */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{title}</p>
              {subtitle && <p className="truncate text-xs text-gray-500">{subtitle}</p>}
            </div>
            <p className="font-mono text-xs tabular-nums text-gray-400">
              <span className="text-white">{fmt(time)}</span> / {fmt(duration)}
            </p>
          </div>

          <div
            ref={barsRef}
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${fmt(time)} of ${fmt(duration)}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setScrubbing(false)}
            onKeyDown={onKeyDown}
            className="nv-player-wave mt-2 flex h-12 w-full cursor-pointer touch-none items-center gap-[2px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
          >
            {bars.map((h, i) => {
              const played = i / bars.length < progress;
              return (
                <span
                  key={i}
                  aria-hidden
                  className={`block min-w-0 flex-1 rounded-full transition-colors ${
                    played ? "bg-gradient-to-t from-blue-500 to-purple-400" : "bg-white/15"
                  } ${peaks ? "" : "animate-pulse"}`}
                  style={{ height: `${Math.round(h * 100)}%` }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Controls row */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? "Unmute" : "Mute"}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-gray-300 transition hover:text-white"
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
          <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.03] p-0.5" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  speed === s ? "bg-white/10 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
