"use client";

// app/components/VideoPlayer.tsx
// Custom MP4 player in the same visual language as AudioPlayer: glass control
// bar with gradient progress (buffered + played), big centre play button,
// play/pause, ±5 s, elapsed/total, mute, speed, fullscreen. Controls hide
// while playing and reappear on hover/touch. Keyboard: space/k play, ←/→ seek,
// m mute, f fullscreen. Replaces the browser's native <video controls>.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function VideoPlayer({
  src,
  poster,
  className = "",
  aspect = "auto",
}: {
  src: string;
  poster?: string;
  className?: string;
  /** "vertical" caps the player to a 9:16 column; "auto" uses the file's size. */
  aspect?: "auto" | "vertical" | "horizontal";
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);

  // Wire the <video> events.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      setDuration(v.duration || 0);
      setReady(true);
    };
    const onTime = () => {
      if (!scrubbing) setTime(v.currentTime);
      try {
        const b = v.buffered;
        if (b.length) setBuffered(b.end(b.length - 1));
      } catch {
        /* ignore */
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => {
      setPlaying(false);
      setControlsVisible(true);
    };
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => setWaiting(false);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("durationchange", onMeta);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("progress", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnd);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("playing", onPlaying);
    v.addEventListener("canplay", onPlaying);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("durationchange", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("progress", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("playing", onPlaying);
      v.removeEventListener("canplay", onPlaying);
    };
  }, [scrubbing]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  // Auto-hide the control bar while playing.
  const poke = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false);
    }, 2200);
  }, []);
  useEffect(() => {
    if (playing) poke();
    else setControlsVisible(true);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [playing, poke]);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.min(duration || v.duration || 0, Math.max(0, v.currentTime + delta));
      setTime(v.currentTime);
      poke();
    },
    [duration, poke]
  );

  const seekToClientX = useCallback(
    (clientX: number) => {
      const el = barRef.current;
      const v = videoRef.current;
      if (!el || !v || !duration) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const t = ratio * duration;
      setTime(t);
      v.currentTime = t;
    },
    [duration]
  );

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case " ":
      case "k":
        e.preventDefault();
        toggle();
        break;
      case "ArrowRight":
        e.preventDefault();
        seekBy(5);
        break;
      case "ArrowLeft":
        e.preventDefault();
        seekBy(-5);
        break;
      case "m":
        setMuted((m) => !m);
        break;
      case "f":
        toggleFullscreen();
        break;
    }
  };

  const progress = duration ? time / duration : 0;
  const buffer = duration ? Math.min(1, buffered / duration) : 0;
  const aspectClass =
    aspect === "vertical" ? "aspect-[9/16] max-h-[70vh]" : aspect === "horizontal" ? "aspect-video" : "max-h-[70vh]";
  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-400/60";

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      role="region"
      aria-label="Video player"
      onKeyDown={onKeyDown}
      onMouseMove={poke}
      onTouchStart={poke}
      onMouseLeave={() => playing && setControlsVisible(false)}
      className={`nv-video group relative mx-auto overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_20px_60px_rgba(0,0,0,0.45)] outline-none ${fullscreen ? "flex h-full w-full items-center justify-center rounded-none border-0" : aspectClass} ${className}`}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        playsInline
        preload="metadata"
        onClick={toggle}
        className={`block ${fullscreen ? "max-h-full max-w-full" : "h-full w-auto max-w-full"} mx-auto cursor-pointer bg-black`}
      />

      {/* Centre play / buffering badge */}
      {(!playing || waiting) && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/70 via-transparent to-black/10"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-xl shadow-blue-500/30 ring-4 ring-white/10 transition group-hover:scale-105">
            {waiting && playing ? (
              <Loader2 size={24} className="animate-spin" />
            ) : !ready ? (
              <Loader2 size={24} className="animate-spin" />
            ) : (
              <Play size={26} fill="currentColor" className="ml-1" />
            )}
          </span>
        </button>
      )}

      {/* Control bar */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-2.5 pt-10 transition-opacity duration-300 ${
          controlsVisible || !playing ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Scrub bar */}
        <div
          ref={barRef}
          role="slider"
          tabIndex={-1}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${fmt(time)} of ${fmt(duration)}`}
          onPointerDown={(e) => {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            setScrubbing(true);
            seekToClientX(e.clientX);
          }}
          onPointerMove={(e) => scrubbing && seekToClientX(e.clientX)}
          onPointerUp={(e) => {
            if (!scrubbing) return;
            seekToClientX(e.clientX);
            setScrubbing(false);
          }}
          onPointerCancel={() => setScrubbing(false)}
          className="group/bar relative h-5 cursor-pointer touch-none"
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/15 transition-all group-hover/bar:h-1.5">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${buffer * 100}%` }} />
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-400 to-purple-400"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_4px_rgba(99,102,241,0.35)] transition-transform group-hover/bar:scale-110"
            style={{ left: `${progress * 100}%` }}
          />
        </div>

        <div className="mt-1 flex items-center gap-1">
          <button type="button" onClick={toggle} aria-label={playing ? "Pause" : "Play"} className={btn}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
          </button>
          <button type="button" onClick={() => seekBy(-5)} aria-label="Back 5 seconds" className={`${btn} hidden sm:flex`}>
            <RotateCcw size={16} />
          </button>
          <button type="button" onClick={() => seekBy(5)} aria-label="Forward 5 seconds" className={`${btn} hidden sm:flex`}>
            <RotateCw size={16} />
          </button>
          <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} className={btn}>
            {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <span className="ml-1 font-mono text-xs tabular-nums text-gray-300">
            <span className="text-white">{fmt(time)}</span> / {fmt(duration)}
          </span>

          <span className="flex-1" />

          <div className="hidden items-center rounded-full bg-white/10 p-0.5 sm:flex" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                aria-pressed={speed === s}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                  speed === s ? "bg-white text-black" : "text-gray-300 hover:text-white"
                }`}
              >
                {s}×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className={btn}
          >
            {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
