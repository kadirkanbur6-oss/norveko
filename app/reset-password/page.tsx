"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../lib/supabase";
import AuthShell from "../components/auth/AuthShell";
import AuthAlert from "../components/auth/AuthAlert";
import PasswordField from "../components/auth/PasswordField";

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
    <AuthShell eyebrow="Account recovery" title="Choose a new password">
      {done ? (
        <AuthAlert tone="success">Password updated. Taking you to your dashboard…</AuthAlert>
      ) : (
        <form className="space-y-6" method="post" onSubmit={handleSubmit}>
          <PasswordField
            id="new-password"
            label="New password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
            placeholder="At least 8 characters"
          />

          <PasswordField
            id="confirm-password"
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            minLength={8}
            placeholder="Repeat the new password"
          />

          {errorMessage ? (
            <AuthAlert tone="error">
              {errorMessage}
              {/expired/i.test(errorMessage) ? (
                <Link href="/forgot-password" className="mt-2 block font-semibold underline">
                  Request a new link
                </Link>
              ) : null}
            </AuthAlert>
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
    </AuthShell>
  );
}
