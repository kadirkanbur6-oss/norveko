"use client";

// app/components/PaymentsSoonCard.tsx
// Shown on /billing (and /chat's upgrade prompt) while PAYMENTS_LIVE is false:
// explains that plans open soon and offers a one-click waitlist.
import { useEffect, useState } from "react";
import { BellRing, CheckCircle2, Loader2 } from "lucide-react";
import { PAYMENTS_SOON_BODY, PAYMENTS_SOON_TITLE } from "@/lib/payments";

export default function PaymentsSoonCard({ compact = false }: { compact?: boolean }) {
  const [joined, setJoined] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/waitlist", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setJoined(Boolean(d?.joined)))
      .catch(() => alive && setJoined(false));
    return () => {
      alive = false;
    };
  }, []);

  async function join() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/waitlist", { method: "POST" });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "Could not save that right now.");
      setJoined(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-500/10 to-orange-500/5 ${compact ? "p-4" : "p-5"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <BellRing size={20} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-white">{PAYMENTS_SOON_TITLE}</p>
            <p className="mt-0.5 text-xs text-gray-300">{PAYMENTS_SOON_BODY}</p>
            {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
          </div>
        </div>
        {joined ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200">
            <CheckCircle2 size={14} aria-hidden /> You&apos;re on the list
          </span>
        ) : (
          <button
            type="button"
            onClick={join}
            disabled={busy || joined === null}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
            Notify me
          </button>
        )}
      </div>
    </div>
  );
}
