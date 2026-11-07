"use client";

// A short silent walkthrough of the four AI Workspace modes, shown under the mode cards.
// The video is a static file (public/tutorial/norveko-modes.mp4, ~0.5 MB) loaded only when the
// person opens the panel: preload="none" plus a poster, so it costs nothing until then.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, PlayCircle } from "lucide-react";

export type GuideMode = "video" | "skit" | "talk" | "swap";

const CHAPTERS: Array<{ mode: GuideMode; label: string; at: number }> = [
  { mode: "video", label: "Narrated video", at: 4 },
  { mode: "skit", label: "Skit", at: 16 },
  { mode: "talk", label: "Talking character", at: 28 },
  { mode: "swap", label: "Character swap", at: 40 },
];

const SEEN_KEY = "nv_mode_guide_seen";

export default function ModeGuide({
  mode,
  onSelectMode,
}: {
  mode: GuideMode;
  onSelectMode: (m: GuideMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  // Open once for people who have never seen it; remember that in this browser only.
  useEffect(() => {
    let timer: number | undefined;
    try {
      if (!window.localStorage.getItem(SEEN_KEY)) {
        window.localStorage.setItem(SEEN_KEY, "1");
        timer = window.setTimeout(() => setOpen(true), 0);
      }
    } catch {
      /* storage can be blocked; the guide just stays closed */
    }
    return () => window.clearTimeout(timer);
  }, []);

  function jump(c: (typeof CHAPTERS)[number]) {
    onSelectMode(c.mode);
    const el = ref.current;
    if (!el) return;
    el.currentTime = c.at;
    void el.play().catch(() => {});
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          // Opening from the closed card starts the video straight away.
          if (!open) window.setTimeout(() => void ref.current?.play().catch(() => {}), 50);
        }}
        aria-expanded={open}
        aria-controls="mode-guide-panel"
        className="group flex w-full items-center gap-3 p-2.5 text-left transition hover:bg-white/[0.03]"
      >
        {!open && (
          <span className="nv-dark relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-black sm:w-28">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tutorial/norveko-modes-poster.jpg" alt="" className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-black shadow">
                <PlayCircle size={18} aria-hidden />
              </span>
            </span>
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-medium text-gray-100">
            {open && <PlayCircle size={16} className="text-blue-300" aria-hidden />}
            How the modes work
            <span className="text-xs font-normal text-gray-400">52 s video</span>
          </span>
          {!open && (
            <span className="mt-0.5 block text-xs text-gray-400">New here? Watch which mode makes what, then pick one above.</span>
          )}
        </span>
        <span className="shrink-0 text-gray-400">{open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}</span>
      </button>
      {open && (
        <div id="mode-guide-panel" className="border-t border-white/10 p-3">
          <video
            ref={ref}
            src="/tutorial/norveko-modes.mp4"
            poster="/tutorial/norveko-modes-poster.jpg"
            preload="none"
            controls
            playsInline
            className="aspect-video w-full rounded-lg bg-black"
          >
            Your browser cannot play this video.
          </video>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Jump to a mode in the video">
            {CHAPTERS.map((c) => (
              <button
                key={c.mode}
                type="button"
                onClick={() => jump(c)}
                className={`min-h-9 rounded-full border px-3 py-1 text-xs transition ${
                  mode === c.mode
                    ? "border-blue-400/60 bg-blue-500/10 text-white"
                    : "border-white/10 text-gray-300 hover:border-white/25 hover:text-white"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
