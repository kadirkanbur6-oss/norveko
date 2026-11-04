'use client';

import { FormEvent, useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { callbackUrl, safeNext } from "@/lib/safe-next";
import { supabase } from "../lib/supabase";
import AuthShell from "../components/auth/AuthShell";
import AuthAlert from "../components/auth/AuthAlert";
import GoogleButton from "../components/auth/GoogleButton";
import PasswordField, { AUTH_INPUT_CLASS } from "../components/auth/PasswordField";

function SignupContent() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    const id = setTimeout(() => setErrorMessage(decodeURIComponent(error)), 0);
    return () => clearTimeout(id);
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsLoading(true);

    // Throwaway inboxes get no free credits — say so before creating the account.
    const check = await fetch("/api/signup-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: true }));
    if (check && check.ok === false) {
      setIsLoading(false);
      setErrorMessage(String(check.error));
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      // The verification link comes back to where they were going (e.g. a team invite).
      options: next ? { emailRedirectTo: callbackUrl(next) } : undefined,
    });

    setIsLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setSuccessMessage(
      "Check your inbox and click the verification link to activate your account."
    );
  }

  async function handleGoogleSignUp() {
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
      eyebrow="Create account"
      title="Join Norveko"
      description="Sign up with Google or your email. We'll send a verification link to activate your account."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
            className="font-semibold text-violet-300 hover:text-violet-100"
          >
            Sign in
          </Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogleSignUp} disabled={isLoading} />

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
          id="new-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={6}
          placeholder="At least 6 characters"
        />

        {errorMessage ? <AuthAlert tone="error">{errorMessage}</AuthAlert> : null}
        {successMessage ? <AuthAlert tone="success">{successMessage}</AuthAlert> : null}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-3xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? "Creating account..." : "Create account"}
        </button>
      </form>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#090b16]">
          <div className="text-gray-400">Loading...</div>
        </div>
      }
    >
      <SignupContent />
    </Suspense>
  );
}
