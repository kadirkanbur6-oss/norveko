"use client";

// app/components/TutorialButton.tsx
// "How it works" video (the same 52 s walkthrough as the AI Workspace guide) in a modal,
// so the landing page and the dashboard can show it without sending people to /chat.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PlayCircle, X } from "lucide-react";

export const TUTORIAL_VIDEO = "/tutorial/norveko-modes.mp4";
export const TUTORIAL_POSTER = "/tutorial/norveko-modes-poster.jpg";

export default function TutorialButton({
  className = "",
  label = "Watch how it works",
  variant = "button",
}: {
  className?: string;
  label?: string;
  /** "button": text button with an icon. "card": poster thumbnail with title and length. */
  variant?: "button" | "card";
}) {
  const [open, setOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    void videoRef.current?.play().catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {variant === "card" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-white/20 hover:bg-white/[0.05] ${className}`}
        >
          <span className="nv-dark relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl bg-black sm:w-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={TUTORIAL_POSTER} alt="" className="h-full w-full object-cover opacity-90 transition group-hover:opacity-100" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition group-hover:scale-105">
                <PlayCircle size={22} aria-hidden />
              </span>
            </span>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-white">{label}</span>
            <span className="mt-0.5 block text-xs text-gray-400">
              A 52-second tour: narrated videos, skits, talking characters and character swaps.
            </span>
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex items-center gap-2 text-sm text-gray-300 transition hover:text-white ${className}`}
        >
          <PlayCircle size={18} className="text-blue-300" aria-hidden />
          {label}
          <span className="text-xs text-gray-500">52 s</span>
        </button>
      )}

      {/* Portal: an animated (transformed) parent would otherwise trap the fixed overlay. */}
      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="How Norveko works"
          className="nv-dark fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close video"
              className="absolute -top-11 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
            >
              <X size={18} aria-hidden />
            </button>
            <video
              ref={videoRef}
              src={TUTORIAL_VIDEO}
              poster={TUTORIAL_POSTER}
              controls
              playsInline
              preload="metadata"
              className="aspect-video w-full rounded-2xl bg-black shadow-2xl"
            >
              Your browser cannot play this video.
            </video>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
