"use client";

// app/components/BrandMark.tsx
// The Norveko logo mark: deep-navy rounded square, blue→violet "N" monogram,
// white spark. Inline SVG so it stays crisp at any size and needs no asset.
// Matches public/brand/norveko-logo.png used for OAuth / social.

import { useId } from "react";

export default function BrandMark({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  // Several marks render on one page (sidebar + mobile bar + drawer); SVG
  // gradient ids are document-global, so make them unique per instance.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (name: string) => `nv-${name}-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="Norveko"
      className={`shrink-0 ${className}`}
    >
      <defs>
        <linearGradient id={id("bg")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#141a3a" />
          <stop offset="1" stopColor="#070a1c" />
        </linearGradient>
        <linearGradient id={id("n")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dd3fc" />
          <stop offset="0.5" stopColor="#60a5fa" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
        <linearGradient id={id("ring")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.05" />
        </linearGradient>
        <radialGradient id={id("glow")} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#6366f1" stopOpacity="0.45" />
          <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="120" height="120" rx="27" fill={`url(#${id("bg")})`} />
      <rect width="120" height="120" rx="27" fill={`url(#${id("glow")})`} />
      <rect
        x="1"
        y="1"
        width="118"
        height="118"
        rx="26"
        fill="none"
        stroke={`url(#${id("ring")})`}
        strokeWidth="1.5"
      />
      <path d="M34 86V34h11l30 36V34h11v52H75L45 50v36z" fill={`url(#${id("n")})`} />
      <path
        d="M90 22l2.2 5.8L98 30l-5.8 2.2L90 38l-2.2-5.8L82 30l5.8-2.2z"
        fill="#ffffff"
        opacity="0.95"
      />
    </svg>
  );
}
