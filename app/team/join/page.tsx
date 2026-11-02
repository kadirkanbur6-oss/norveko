"use client";

// Accept a team invite link: /team/join?token=…

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, Users } from "lucide-react";

function Join() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    try {
      const d = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).then((r) => r.json());
      setState(d.success ? { ok: true, text: `You joined ${d.team.name}. Your videos now use the team's credits.` } : { ok: false, text: d.error });
    } catch {
      setState({ ok: false, text: "Something went wrong. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-[#07070c] px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <Users size={28} className="mx-auto text-sky-300" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">Join a team on Norveko</h1>
        <p className="mt-2 text-sm text-gray-400">
          Team members make videos with their own account; the credits come from the team&apos;s shared balance.
        </p>
        {state ? (
          <>
            <p className={`mt-6 text-sm ${state.ok ? "text-emerald-300" : "text-red-300"}`}>{state.text}</p>
            <Link href={state.ok ? "/chat" : "/dashboard"} className="mt-6 inline-block rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold">
              {state.ok ? "Make a video" : "Go to dashboard"}
            </Link>
          </>
        ) : (
          <button
            type="button"
            onClick={join}
            disabled={busy || !token}
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />} Join the team
          </button>
        )}
      </div>
    </main>
  );
}

export default function TeamJoinPage() {
  return (
    <Suspense>
      <Join />
    </Suspense>
  );
}
