"use client";

// app/components/HeroBackground.tsx
// Muted, looping "wall of Shorts" behind the landing hero, made of real
// AI clips from Norveko runs (lib/showcase.ts HERO_LOOP_CLIPS). Desktop
// shows every clip as a column, phones only the first; nothing loads for visitors who ask for
// reduced motion or data saving. Purely decorative (aria-hidden).

import { useEffect, useRef, useState } from "react";
import { HERO_LOOP_CLIPS, heroClipUrl, heroFeatureUrl } from "@/lib/showcase";

export default function HeroBackground() {
  const [count, setCount] = useState(0);
  const featureRef = useRef<HTMLVideoElement | null>(null);

  // Phones (iOS Safari above all) only autoplay a video that is muted *as an attribute* and
  // inline; React sets `muted` as a property, so set both by hand and start it ourselves.
  // Low Power Mode refuses autoplay: try again on the first touch or scroll.
  useEffect(() => {
    const v = featureRef.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    const tryPlay = () => {
      void v.play().catch(() => undefined);
    };
    tryPlay();
    const events = ["touchstart", "scroll", "click"] as const;
    const onUser = () => {
      tryPlay();
      if (!v.paused) events.forEach((e) => window.removeEventListener(e, onUser));
    };
    events.forEach((e) => window.addEventListener(e, onUser, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onUser));
  }, [count]);

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

  // Phones show only the lead clip; on desktop it goes to the right-most
  // column, the one least covered by the headline and its dark gradient.
  const ordered = count > 1 ? [...HERO_LOOP_CLIPS.slice(1), HERO_LOOP_CLIPS[0]] : HERO_LOOP_CLIPS;
  const clips = ordered.slice(0, count)
    .map(heroClipUrl)
    .filter((u): u is string => Boolean(u));

  const feature = heroFeatureUrl();
  if (feature) {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {count > 0 && (
          <div className="nv-hero-wall absolute inset-0 opacity-0">
            <video
              ref={featureRef}
              src={feature}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              disablePictureInPicture
              onCanPlay={(e) => e.currentTarget.parentElement?.classList.add("nv-hero-wall-ready")}
              onLoadedData={(e) => e.currentTarget.parentElement?.classList.add("nv-hero-wall-ready")}
              className="h-full w-full object-cover object-[70%_50%] lg:object-[80%_50%]"
            />
          </div>
        )}
        {/* Readability: the headline sits on the left, so the scene stays bright on the right. */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a12]/85 via-[#0a0a12]/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0a0a12] to-transparent" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#0a0a12] to-transparent" />
      </div>
    );
  }

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
                i % 2 === 1 ? "lg:translate-y-10" : "lg:-translate-y-6"
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
