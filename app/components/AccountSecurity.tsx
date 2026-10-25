"use client";

// app/components/AccountSecurity.tsx
// Settings sections: change password, and the danger zone (delete account).

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, KeyRound, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function AccountSecurity() {
  const router = useRouter();

  // --- password ---
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.length < 8) return setPwMsg({ ok: false, text: "Use at least 8 characters." });
    if (pw !== pw2) return setPwMsg({ ok: false, text: "Passwords do not match." });
    setPwBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not update password.");
      setPw("");
      setPw2("");
      setPwMsg({ ok: true, text: "Password updated." });
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : "Unknown error" });
    } finally {
      setPwBusy(false);
    }
  }

  // --- delete ---
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState("");

  async function deleteAccount() {
    setDelMsg("");
    setDelBusy(true);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not delete the account.");
      try {
        await supabase.auth.signOut();
      } catch {
        // user no longer exists; local state is cleared anyway
      }
      router.replace("/?deleted=1");
      router.refresh();
    } catch (err) {
      setDelMsg(err instanceof Error ? err.message : "Unknown error");
      setDelBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-blue-400/50";

  return (
    <>
      {/* Password */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-blue-300" />
          <h2 className="font-semibold">Password</h2>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          Signed up with Google? You can still set a password to sign in with email.
        </p>
        <form onSubmit={changePassword} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClass}
          />
          <input
            type="password"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            placeholder="Repeat new password"
            autoComplete="new-password"
            required
            className={inputClass}
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={pwBusy}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {pwBusy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              Update password
            </button>
            {pwMsg && (
              <span className={`text-sm ${pwMsg.ok ? "text-green-300" : "text-red-300"}`}>{pwMsg.text}</span>
            )}
          </div>
        </form>
      </div>

      {/* Danger zone */}
      <div className="rounded-2xl border border-red-400/20 bg-red-500/[0.04] p-6">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-300" />
          <h2 className="font-semibold text-red-100">Delete account</h2>
        </div>
        <p className="mt-1 text-sm text-gray-400">
          Permanently removes your projects, generated media, credit history and sign-in. Unused credits are
          not refundable. This cannot be undone.
        </p>

        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200 transition hover:bg-red-500/20"
          >
            Delete my account…
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-sm text-gray-300">
              Type <span className="font-mono font-semibold text-red-200">DELETE</span> to confirm
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                className={`${inputClass} mt-2 max-w-xs`}
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={deleteAccount}
                disabled={confirm !== "DELETE" || delBusy}
                className="flex items-center gap-2 rounded-xl bg-red-500/90 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-40"
              >
                {delBusy && <Loader2 size={16} className="animate-spin" />}
                Permanently delete
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirm("");
                  setDelMsg("");
                }}
                disabled={delBusy}
                className="text-sm text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              {delMsg && <span className="text-sm text-red-300">{delMsg}</span>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
