"use client";

// app/components/ShortsDemo.tsx
// Landing demo of "long video → Shorts": one real 3-minute video, the moments the
// AI picked for it, and the Short that was rendered from one of them
// (data: SHORTS_DEMO in lib/showcase.ts, all real pipeline output).

import { useState } from "react";
import { ArrowRight, Play, Scissors } from "lucide-react";
import { SHORTS_DEMO } from "@/lib/showcase";

function mmss(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function poster(p: { bucket: string; path: string }): string | undefined {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/${p.bucket}/${p.path}` : undefined;
}

function Player({ src, posterUrl, label, aspect }: { src: string; posterUrl?: string; label: string; aspect: string }) {
  const [on, setOn] = useState(false);
  return (
    <div className={`nv-dark relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black ${aspect}`}>
      <video
        src={src}
        poster={posterUrl}
        preload="none"
        playsInline
        controls={on}
        onPlay={() => setOn(true)}
        className="h-full w-full object-cover"
      />
      {!on && (
        <button
          type="button"
          aria-label={`Play ${label}`}
          onClick={(e) => {
            const v = (e.currentTarget.parentElement as HTMLElement).querySelector("video");
            void v?.play();
          }}
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/70 via-black/10 to-transparent"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-black shadow-xl">
            <Play size={22} fill="currentColor" className="ml-0.5" />
          </span>
        </button>
      )}
    </div>
  );
}

export default function ShortsDemo() {
  const { long, picks, chosen, short } = SHORTS_DEMO;
  return (
    <div className="grid items-center gap-6 lg:grid-cols-[1.4fr_1fr_0.6fr]">
      <div className="space-y-3">
        <Player src={`/media/videos/r2/${long.videoPath}`} posterUrl={poster(long.poster)} label={long.title} aspect="aspect-video" />
        <p className="text-sm font-semibold">{long.title}</p>
        <p className="text-xs text-gray-400">
          One finished {mmss(long.seconds)} video, narrated, with subtitles. This is the source.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-[var(--nv-panel)] p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Scissors size={16} className="text-blue-300" /> The AI picks moments that work on their own
        </p>
        <ol className="space-y-2">
          {picks.map((p, i) => (
            <li
              key={p.from}
              className={`rounded-xl border px-3 py-2 text-xs ${
                i === chosen ? "border-blue-400/60 bg-blue-500/10" : "border-white/10"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{p.title}</span>
                <span className="shrink-0 text-gray-400">
                  {mmss(p.from)}–{mmss(p.to)}
                </span>
              </div>
              <p className="mt-0.5 text-gray-400">Hook: “{p.hook}”</p>
              {i === chosen && (
                <p className="mt-1 inline-flex items-center gap-1 font-semibold text-blue-300">
                  <ArrowRight size={12} /> Rendered as a Short
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[11px] text-gray-400">Picking is free. You only pay the render for the Shorts you make.</p>
      </div>

      <div className="mx-auto w-full max-w-[220px] space-y-3">
        <Player
          src={`/media/videos/r2/${short.videoPath}`}
          posterUrl={poster(short.poster)}
          label="the Short"
          aspect="aspect-[9/16]"
        />
        <p className="text-center text-xs text-gray-400">{short.seconds}s vertical Short, own cover and hook</p>
      </div>
    </div>
  );
}
