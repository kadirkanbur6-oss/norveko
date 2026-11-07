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
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="mode-guide-panel"
        className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-gray-300 transition hover:text-white"
      >
        <span className="inline-flex items-center gap-2">
          <PlayCircle size={16} className="text-blue-300" aria-hidden />
          How the modes work
          <span className="text-xs text-gray-400">50 s video</span>
        </span>
        {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
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
