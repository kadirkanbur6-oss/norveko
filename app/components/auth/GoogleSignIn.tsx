"use client";

// app/components/auth/GoogleSignIn.tsx
// "Continue with Google" via Google Identity Services (8 Nov 2026).
//
// Why not supabase.auth.signInWithOAuth? That flow redirects through
// <project>.supabase.co/auth/v1/callback, and Google's account chooser shows
// the redirect host ("to continue to zpvte….supabase.co") because an
// unverified app can't show its name. With GIS the Google popup is opened
// from our own origin, so it says "to continue to norveko.app", and the ID
// token goes straight to supabase.auth.signInWithIdToken — no redirect, no
// Supabase custom domain ($10/mo) needed.
//
// Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID (the same Web client that Supabase's
// Google provider uses; https://norveko.app must be in its Authorized
// JavaScript origins). Without it we fall back to the old redirect flow.
//
// Nonce: a random value is hashed (SHA-256) for Google and the raw value is
// handed to Supabase, which verifies the token's nonce claim against it.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/app/lib/supabase";
import GoogleButton from "./GoogleButton";

export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

interface GsiCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GsiButtonOptions {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
  locale?: string;
}

interface GsiIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GsiCredentialResponse) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
    itp_support?: boolean;
    context?: "signin" | "signup" | "use";
    ux_mode?: "popup" | "redirect";
  }): void;
  renderButton(parent: HTMLElement, options: GsiButtonOptions): void;
  prompt(): void;
  cancel(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiIdApi } };
  }
}

const GSI_SRC = "https://accounts.google.com/gsi/client";
let gsiLoader: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (gsiLoader) return gsiLoader;
  gsiLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Google script failed to load")));
      return;
    }
    const s = document.createElement("script");
    s.src = GSI_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gsiLoader = null;
      reject(new Error("Google script failed to load"));
    };
    document.head.appendChild(s);
  });
  return gsiLoader;
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function GoogleSignIn({
  context,
  oneTap = false,
  disabled,
  onSignedIn,
  onError,
  onBusy,
  fallback,
}: {
  context: "signin" | "signup";
  /** Also show Google One Tap (the small "Continue as …" card) on this page. */
  oneTap?: boolean;
  disabled?: boolean;
  onSignedIn: () => void;
  onError: (message: string) => void;
  onBusy?: (busy: boolean) => void;
  /** Old redirect flow, used when NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set or GIS can't load. */
  fallback: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  // No client id configured → old redirect flow from the first render.
  const [failed, setFailed] = useState(() => !GOOGLE_CLIENT_ID);
  const nonceRef = useRef<string>("");
  const busyRef = useRef(false);

  const handleCredential = useCallback(
    async (response: GsiCredentialResponse) => {
      if (busyRef.current) return;
      busyRef.current = true;
      onBusy?.(true);
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.credential,
        nonce: nonceRef.current,
      });
      if (error) {
        busyRef.current = false;
        onBusy?.(false);
        onError(error.message);
        return;
      }
      onSignedIn();
    },
    [onBusy, onError, onSignedIn],
  );

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    (async () => {
      try {
        const nonce = randomNonce();
        nonceRef.current = nonce;
        const hashed = await sha256Hex(nonce);
        await loadGsi();
        const id = window.google?.accounts?.id;
        if (cancelled || !id || !host.current) return;
        id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r) => void handleCredential(r),
          nonce: hashed,
          context,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_prompt: true,
        });
        const width = Math.min(400, Math.max(200, Math.round(host.current.getBoundingClientRect().width || 360)));
        id.renderButton(host.current, {
          type: "standard",
          theme: "filled_black",
          size: "large",
          text: context === "signup" ? "signup_with" : "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width,
        });
        setReady(true);
        if (oneTap) id.prompt();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      try {
        window.google?.accounts?.id?.cancel();
      } catch {
        // GIS not loaded
      }
    };
  }, [context, oneTap, handleCredential]);

  if (failed) return <GoogleButton onClick={fallback} disabled={disabled} />;

  return (
    <>
      <div className="mb-6 flex min-h-[44px] justify-center" aria-busy={!ready}>
        <div
          ref={host}
          className={`w-full max-w-[400px] transition-opacity ${ready ? "opacity-100" : "opacity-0"} ${disabled ? "pointer-events-none opacity-60" : ""}`}
        />
      </div>
      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10"></div>
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="bg-[var(--nv-bg)]/50 px-2 text-gray-500">Or continue with email</span>
        </div>
      </div>
    </>
  );
}
