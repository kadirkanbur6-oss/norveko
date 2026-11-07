"use client";

// app/components/HeroBackground.tsx
// Muted, looping "wall of Shorts" behind the landing hero, made of real
// AI clips from Norveko runs (lib/showcase.ts HERO_LOOP_CLIPS). Desktop
// shows every clip as a column, phones only the first; nothing loads for visitors who ask for
// reduced motion or data saving. Purely decorative (aria-hidden).

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { HERO_LOOP_CLIPS, heroClipUrl, heroFeaturePosterUrl, heroFeatureUrl } from "@/lib/showcase";

export default function HeroBackground() {
  const [count, setCount] = useState(0);
  const feature = heroFeatureUrl();
  const poster = heroFeaturePosterUrl();
  // The poster is in the first HTML response, so the scene is there before the video arrives.
  if (feature && poster) preload(poster, { as: "image", fetchPriority: "high" });
  const featureRef = useRef<HTMLVideoElement | null>(null);

  // Phones (iOS Safari above all) only autoplay a video that is muted *as an attribute* and
  // inline; React sets `muted` as a property, so set both by hand and start it ourselves.
  // Low Power Mode refuses autoplay: try again on the first touch or scroll.
  useEffect(() => {
    const v = featureRef.current;
    if (!v) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (saveData) {
      v.removeAttribute("src");
      v.load();
      return;
    }
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
  }, []);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    if (reduce || saveData || heroFeatureUrl()) return;
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

  if (feature) {
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Rendered with the page (not after hydration) so the download starts at once; the poster
            covers the wait. Reduced motion hides it in CSS. */}
        <div className="nv-hero-wall nv-hero-feature absolute inset-x-0 top-0 h-[440px] sm:h-[520px] lg:inset-0 lg:h-auto">
          <video
            ref={featureRef}
            src={feature}
            poster={poster ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            className="h-full w-full object-cover object-[68%_50%] lg:object-[80%_50%]"
          />
        </div>
        {/* Readability: the headline sits on the left, so the scene stays bright on the right. */}
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--nv-bg)]/85 via-[var(--nv-bg)]/30 to-transparent" />
        <div className="absolute inset-x-0 top-[300px] h-[140px] bg-gradient-to-t from-[var(--nv-page)] to-transparent sm:top-[380px] lg:hidden" />
        <div className="absolute inset-x-0 bottom-0 hidden h-40 bg-gradient-to-t from-[var(--nv-page)] to-transparent lg:block" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--nv-page)] to-transparent" />
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
      <div className="absolute inset-0 bg-[var(--nv-bg)]/45" />
      <div className="absolute inset-0 bg-gradient-to-r from-[var(--nv-bg)]/95 via-[var(--nv-bg)]/55 to-[var(--nv-bg)]/20" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--nv-page)] to-transparent" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--nv-page)] to-transparent" />
    </div>
  );
}
