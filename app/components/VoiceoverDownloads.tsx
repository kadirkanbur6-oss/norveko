"use client";

// app/components/VoiceoverDownloads.tsx
// Action buttons for a finished voiceover: "Download MP3" and, when the job
// paid for subtitles, a "Subtitles" dropdown (.srt / .vtt). Used by the
// generation progress card and the project page via <AudioPlayer actions>.

import { useEffect, useRef, useState } from "react";
import { Captions, Check, ChevronDown, Download } from "lucide-react";
import { cuesToSrt, cuesToVtt, type CaptionCue } from "@/lib/pipeline/captions";

export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-gray-200 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white";

export default function VoiceoverDownloads({
  audioUrl,
  captions,
  baseName,
}: {
  audioUrl: string;
  captions?: CaptionCue[] | null;
  /** File name without extension. */
  baseName: string;
}) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<"srt" | "vtt" | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasCaptions = Array.isArray(captions) && captions.length > 0;

  function grab(kind: "srt" | "vtt") {
    if (!hasCaptions) return;
    if (kind === "srt") downloadText(`${baseName}.srt`, cuesToSrt(captions!), "application/x-subrip");
    else downloadText(`${baseName}.vtt`, cuesToVtt(captions!), "text/vtt");
    setDone(kind);
    setOpen(false);
    setTimeout(() => setDone(null), 1800);
  }

  return (
    <>
      {hasCaptions && (
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className={`${btn} border-blue-400/30 bg-blue-500/10 text-blue-200 hover:bg-blue-500/20`}
          >
            {done ? <Check size={14} /> : <Captions size={14} />}
            {done ? `Saved .${done}` : "Subtitles"}
            <ChevronDown size={12} className={`transition ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl"
            >
              <button type="button" role="menuitem" onClick={() => grab("srt")} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition hover:bg-white/5 hover:text-white">
                <span>SubRip <span className="text-gray-500">.srt</span></span>
                <span className="text-[10px] text-gray-500">YouTube · CapCut · Premiere</span>
              </button>
              <button type="button" role="menuitem" onClick={() => grab("vtt")} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition hover:bg-white/5 hover:text-white">
                <span>WebVTT <span className="text-gray-500">.vtt</span></span>
                <span className="text-[10px] text-gray-500">Web players</span>
              </button>
              <p className="px-3 pb-1 pt-2 text-[11px] text-gray-500">{captions!.length} cues, word-timed to the narration.</p>
            </div>
          )}
        </div>
      )}
      <a href={audioUrl} download={`${baseName}.mp3`} className={btn}>
        <Download size={14} />
        MP3
      </a>
    </>
  );
}
