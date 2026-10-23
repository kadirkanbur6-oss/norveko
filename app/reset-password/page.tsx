"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

// Reached from the recovery email via /auth/callback?next=/reset-password.
// The callback has already exchanged the code, so the user holds a recovery
// session here and can set a new password.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsLoading(false);

    if (error) {
      setErrorMessage(
        /session/i.test(error.message)
          ? "This reset link has expired. Please request a new one."
          : error.message
      );
      return;
    }

    setDone(true);
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  return (
    <div className="min-h-screen bg-[#090b16] px-4 py-12 text-white">
      <div className="mx-auto w-full max-w-md rounded-[32px] border border-white/10 bg-white/5 p-6 sm:p-10 shadow-[0_25px_100px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <div className="mb-8 space-y-3">
          <p className="text-sm uppercase tracking-[0.24em] text-violet-300/80">
            Account recovery
          </p>
          <h1 className="text-4xl font-semibold">Choose a new password</h1>
        </div>

        {done ? (
          <div className="rounded-3xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-200">
            Password updated. Taking you to your dashboard…
          </div>
        ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-gray-300">
              New password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="mt-2 w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                placeholder="At least 8 characters"
              />
            </label>

            <label className="block text-sm font-medium text-gray-300">
              Confirm password
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                autoComplete="new-password"
                className="mt-2 w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
                placeholder="Repeat the new password"
              />
            </label>

            {errorMessage ? (
              <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
                {errorMessage}
                {/expired/i.test(errorMessage) ? (
                  <a href="/forgot-password" className="mt-2 block font-semibold underline">
                    Request a new link
                  </a>
                ) : null}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-3xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
