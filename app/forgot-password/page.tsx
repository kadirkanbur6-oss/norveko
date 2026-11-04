"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import AuthShell from "../components/auth/AuthShell";
import AuthAlert from "../components/auth/AuthAlert";
import { AUTH_INPUT_CLASS } from "../components/auth/PasswordField";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsLoading(true);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });

    setIsLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      description={
        <>Enter the email you signed up with and we&apos;ll send you a link to choose a new password.</>
      }
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-violet-300 hover:text-violet-100">
            Back to sign in
          </Link>
        </>
      }
    >
      {sent ? (
        <AuthAlert tone="success">
          If an account exists for <span className="font-semibold">{email}</span>, a reset link is on
          its way. Check your inbox and spam folder.
        </AuthAlert>
      ) : (
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

          {errorMessage ? <AuthAlert tone="error">{errorMessage}</AuthAlert> : null}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-3xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
