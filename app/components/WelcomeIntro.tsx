"use client";

// app/components/WelcomeIntro.tsx
// 2.5 s premium intro shown once right after a successful sign-in.
//
// Trigger: login/signup set sessionStorage["norveko:intro"]="1" before
// navigating to /dashboard; the OAuth callback lands on /dashboard?welcome=1.
// This component consumes either signal and clears it, so a reload or any
// in-app navigation never replays it. A fresh sign-in sets it again.
//
// Timeline (ms):   0–500  logo blur → sharp
//                500–1300 light sweep + ring pulse, logo scales up slightly
//               1300–2000 "Create Beyond Limits" fades in
//               2000–2500 whole overlay fades out
// Pure CSS keyframes (see globals.css); prefers-reduced-motion gets a short
// static fade instead.

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import BrandMark from "./BrandMark";

export const INTRO_FLAG = "norveko:intro";
const INTRO_MS = 2500;
const REDUCED_MS = 900;

export default function WelcomeIntro() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<"idle" | "playing" | "done">("idle");
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let flagged = false;
    try {
      flagged = sessionStorage.getItem(INTRO_FLAG) === "1";
      if (flagged) sessionStorage.removeItem(INTRO_FLAG);
    } catch {
      // storage unavailable (private mode etc.) — fall back to the URL signal
    }
    const fromOAuth = searchParams.get("welcome") === "1";
    if (fromOAuth) {
      // Drop the query so a reload does not replay the intro.
      router.replace(pathname, { scroll: false });
    }
    if (!flagged && !fromOAuth) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Deferred so state is not set synchronously inside the effect.
    const start = setTimeout(() => {
      setReduced(prefersReduced);
      setPhase("playing");
    }, 0);
    const end = setTimeout(
      () => setPhase("done"),
      prefersReduced ? REDUCED_MS : INTRO_MS
    );
    return () => {
      clearTimeout(start);
      clearTimeout(end);
    };
    // Run once on mount; the signals are consumed immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase !== "playing") return null;

  return (
    <div
      aria-hidden="true"
      className={`nv-intro fixed inset-0 z-[100] flex items-center justify-center bg-[#070B17] ${
        reduced ? "nv-intro--reduced" : ""
      }`}
    >
      {/* soft radial glow behind everything */}
      <div className="nv-intro__glow pointer-events-none absolute left-1/2 top-1/2 h-[60vmin] w-[60vmin] rounded-full" />

      <div className="relative flex flex-col items-center">
        <div className="nv-intro__logo relative">
          {/* rotating light sweep */}
          <div className="nv-intro__ring pointer-events-none absolute -inset-5 rounded-[36%]" />
          {/* expanding pulse */}
          <div className="nv-intro__pulse pointer-events-none absolute -inset-3 rounded-[34%] border border-indigo-300/40" />
          <BrandMark size={112} className="relative drop-shadow-[0_18px_48px_rgba(99,102,241,0.45)]" />
        </div>

        <p className="nv-intro__tagline mt-7 text-center text-base font-medium tracking-[0.32em] text-transparent sm:text-lg">
          <span className="bg-gradient-to-r from-sky-200 via-blue-200 to-purple-200 bg-clip-text">
            CREATE BEYOND LIMITS
          </span>
        </p>
      </div>
    </div>
  );
}
