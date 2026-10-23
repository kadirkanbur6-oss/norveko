"use client";

import { FormEvent, useState } from "react";
import { supabase } from "../lib/supabase";

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
    <div className="min-h-screen bg-[#090b16] px-4 py-12 text-white">
      <div className="mx-auto w-full max-w-md rounded-[32px] border border-white/10 bg-white/5 p-6 sm:p-10 shadow-[0_25px_100px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <div className="mb-8 space-y-3">
          <p className="text-sm uppercase tracking-[0.24em] text-violet-300/80">
            Account recovery
          </p>
          <h1 className="text-4xl font-semibold">Reset your password</h1>
          <p className="text-sm text-gray-400">
            Enter the email you signed up with and we&apos;ll send you a link to
            choose a new password.
          </p>
        </div>

        {sent ? (
          <div className="rounded-3xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            If an account exists for <span className="font-semibold">{email}</span>,
            a reset link is on its way. Check your inbox and spam folder.
          </div>
        ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-gray-300">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="mt-2 w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                placeholder="example@example.com"
              />
            </label>

            {errorMessage ? (
              <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                {errorMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-3xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-gray-400">
          Remembered it?{" "}
          <a href="/login" className="font-semibold text-violet-300 hover:text-violet-100">
            Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
