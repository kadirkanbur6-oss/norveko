"use client";

// app/components/HeroBackground.tsx
// Muted, looping "wall of Shorts" behind the landing hero, made of real
// Kling clips from Norveko runs (lib/showcase.ts HERO_LOOP_CLIPS). Desktop
// shows three columns, phones one; nothing loads for visitors who ask for
// reduced motion or data saving. Purely decorative (aria-hidden).

import { useEffect, useState } from "react";
import { HERO_LOOP_CLIPS, heroClipUrl } from "@/lib/showcase";

export default function HeroBackground() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (reduce || saveData) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    const apply = () => setCount(wide.matches ? HERO_LOOP_CLIPS.length : 1);
    // Defer so the hero text paints first.
    const t = window.setTimeout(apply, 300);
    wide.addEventListener("change", apply);
    return () => {
      window.clearTimeout(t);
      wide.removeEventListener("change", apply);
    };
  }, []);

  const clips = HERO_LOOP_CLIPS.slice(0, count)
    .map(heroClipUrl)
    .filter((u): u is string => Boolean(u));

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {clips.length > 0 && (
        <div className="nv-hero-wall absolute inset-0 flex justify-center gap-3 opacity-0 lg:gap-4">
          {clips.map((src, i) => (
            <video
              key={src}
              src={src}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              onCanPlay={(e) => e.currentTarget.parentElement?.classList.add("nv-hero-wall-ready")}
              className={`h-full w-full object-cover lg:w-auto lg:flex-1 lg:aspect-[9/16] lg:rounded-3xl ${
                i === 1 ? "lg:translate-y-10" : "lg:-translate-y-6"
              }`}
            />
          ))}
        </div>
      )}
      {/* Readability: darken, tint and blend into the page */}
      <div className="absolute inset-0 bg-[#0a0a12]/45" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a12]/95 via-[#0a0a12]/55 to-[#0a0a12]/20" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a12] to-transparent" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#0a0a12] to-transparent" />
    </div>
  );
}
