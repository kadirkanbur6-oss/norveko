'use client';

import { FormEvent, useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { callbackUrl, safeNext } from "@/lib/safe-next";
import { supabase } from "../lib/supabase";
import { INTRO_FLAG } from "../components/WelcomeIntro";
import AuthShell from "../components/auth/AuthShell";
import AuthAlert from "../components/auth/AuthAlert";
import GoogleButton from "../components/auth/GoogleButton";
import PasswordField, { AUTH_INPUT_CLASS } from "../components/auth/PasswordField";

const ERROR_TEXT: Record<string, string> = {
  no_code: "The sign-in link was incomplete. Please try again.",
  callback_failed: "We couldn't complete the sign-in. Please try again.",
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);

  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    const decoded = decodeURIComponent(error);
    // Deferred so the effect does not set state synchronously.
    const id = setTimeout(() => setErrorMessage(ERROR_TEXT[decoded] ?? decoded), 0);
    return () => clearTimeout(id);
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setIsLoading(false);

    if (error) {
      setNeedsVerification(/not confirmed/i.test(error.message));
      setErrorMessage(error.message);
      return;
    }

    try {
      sessionStorage.setItem(INTRO_FLAG, "1");
    } catch {
      // storage unavailable — the dashboard simply opens without the intro
    }
    router.push(next ?? "/dashboard");
  }

  async function handleResendVerification() {
    setErrorMessage("");
    setInfoMessage("");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: callbackUrl(next),
      },
    });
    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setNeedsVerification(false);
    setInfoMessage("Verification email sent. Check your inbox and spam folder.");
  }

  async function handleGoogleSignIn() {
    setErrorMessage("");
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callbackUrl(next),
      },
    });

    if (error) {
      setErrorMessage(error.message);
      setIsLoading(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to Norveko"
      description="Use Google or your email and password. You'll land right where you were headed."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link
            href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
            className="font-semibold text-violet-300 hover:text-violet-100"
          >
            Sign up
          </Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading} />

      {/* method="post": JS yüklenmeden gönderilirse e-posta/şifre URL'e düşmesin. */}
      <form className="space-y-6" method="post" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-300">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            className={AUTH_INPUT_CLASS}
            placeholder="you@example.com"
          />
        </div>

        <PasswordField
          id="password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          placeholder="Enter your password"
        />

        <div className="-mt-2 text-right">
          <Link href="/forgot-password" className="text-xs text-violet-300 hover:text-violet-100">
            Forgot password?
          </Link>
        </div>

        {errorMessage ? (
          <AuthAlert tone="error">
            {errorMessage}
            {needsVerification && email ? (
              <button
                type="button"
                onClick={handleResendVerification}
                className="mt-2 block font-semibold text-red-100 underline"
              >
                Resend verification email
              </button>
            ) : null}
          </AuthAlert>
        ) : null}

        {infoMessage ? <AuthAlert tone="success">{infoMessage}</AuthAlert> : null}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-3xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--nv-bg)] flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
