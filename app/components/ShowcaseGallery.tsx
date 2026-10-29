"use client";

// app/components/ShowcaseGallery.tsx
// Landing-page gallery of real pipeline outputs (lib/showcase.ts). Each card
// shows the generated thumbnail as a poster; the MP4 is only fetched when the
// visitor presses play (files are 20–50 MB). One video plays at a time.

import { useEffect, useRef, useState } from "react";
import { Clock, Globe, Pause, Play, Sparkles } from "lucide-react";
import { SHOWCASE_VIDEOS, showcaseThumbnailUrl, showcaseVideoUrl, type ShowcaseVideo } from "@/lib/showcase";

function ShowcaseCard({
  video,
  active,
  onActivate,
}: {
  video: ShowcaseVideo;
  active: boolean;
  onActivate: (id: string | null) => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const src = showcaseVideoUrl(video);
  const poster = showcaseThumbnailUrl(video);

  // Pause when another card takes over.
  useEffect(() => {
    if (!active && ref.current && !ref.current.paused) ref.current.pause();
  }, [active]);

  function toggle() {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      onActivate(video.id);
      void el.play();
    } else {
      el.pause();
    }
  }

  if (!src) return null;

  return (
    <figure className="group relative overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="relative aspect-[9/16] w-full">
        <video
          ref={ref}
          src={src}
          poster={poster ?? undefined}
          preload="none"
          playsInline
          controls={playing}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            onActivate(null);
          }}
          className="h-full w-full object-cover"
        />
        {!playing && (
          <button
            type="button"
            onClick={toggle}
            aria-label={`Play ${video.title}`}
            className="absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/80 via-black/10 to-transparent transition group-hover:from-black/70"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-black shadow-xl transition group-hover:scale-110">
              <Play size={26} fill="currentColor" className="ml-1" />
            </span>
          </button>
        )}
        {playing && (
          <button
            type="button"
            onClick={toggle}
            aria-label="Pause"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur"
          >
            <Pause size={16} fill="currentColor" />
          </button>
        )}
        <div className="pointer-events-none absolute left-3 top-3 flex gap-1.5">
          <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            {video.seconds}s
          </span>
          <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            {video.style}
          </span>
        </div>
      </div>
      <figcaption className="space-y-2 p-4">
        <p className="text-[11px] uppercase tracking-[2px] text-blue-300">Prompt</p>
        <p className="text-sm font-medium text-white">“{video.idea}”</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Globe size={12} /> {video.language}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} /> {video.seconds} seconds
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles size={12} /> AI visuals · voice · subtitles
          </span>
        </div>
      </figcaption>
    </figure>
  );
}

export default function ShowcaseGallery() {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (!SHOWCASE_VIDEOS.length || !showcaseVideoUrl(SHOWCASE_VIDEOS[0])) return null;

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {SHOWCASE_VIDEOS.map((v) => (
        <ShowcaseCard key={v.id} video={v} active={activeId === v.id} onActivate={setActiveId} />
      ))}
    </div>
  );
}
