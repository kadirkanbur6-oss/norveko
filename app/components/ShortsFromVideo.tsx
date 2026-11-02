"use client";

// Project page → Publish: cut a finished long video into vertical Shorts.
// AI picks the moments that stand on their own; each one renders as its own
// project with a hook card and subtitles, reusing the narration and visuals.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Scissors, Sparkles } from "lucide-react";

type Pick = { from: number; to: number; title: string; hook: string; credits: number };
type Short = { jobId: string; status: string; from: number; to: number; title: string; projectId: string | null };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function ShortsFromVideo({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<{ available: boolean; suggestionsLeft: number; picks: Pick[]; shorts: Short[] } | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const d = await fetch(`/api/projects/${projectId}/shorts`).then((r) => r.json()).catch(() => null);
    if (d?.success && Array.isArray(d.picks)) setInfo(d);
  }, [projectId]);

  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  const running = info?.shorts.some((s) => s.status === "running");
  useEffect(() => {
    if (!running) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [running, load]);

  if (!info || (!info.available && !info.shorts.length)) return null;

  async function post(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setError("");
    try {
      const d = await fetch(`/api/projects/${projectId}/shorts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Something went wrong.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }

  const shortFor = (p: Pick) => info.shorts.find((s) => s.status !== "failed" && Math.abs(s.from - p.from) < 0.5 && Math.abs(s.to - p.to) < 0.5);

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Scissors size={17} className="text-pink-300" aria-hidden />
            <h3 className="text-sm font-semibold text-white">Cut into Shorts</h3>
          </div>
          <p className="mt-1 text-xs text-gray-400">
            We find the moments that work on their own and turn each into a vertical Short with its own hook and subtitles.
          </p>
        </div>
        {info.available && info.suggestionsLeft > 0 && (
          <button
            type="button"
            onClick={() => post({ action: "suggest" }, "suggest")}
            disabled={busy !== ""}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-gray-200 transition hover:border-white/25 disabled:opacity-50"
          >
            {busy === "suggest" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy === "suggest" ? "Finding moments…" : info.picks.length ? "Find other moments" : "Find Short moments"}
          </button>
        )}
      </div>

      {info.picks.length > 0 && (
        <ul className="mt-4 space-y-2">
          {info.picks.map((p, i) => {
            const made = shortFor(p);
            return (
              <li key={`${p.from}-${p.to}`} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[#0d0d16] p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{p.title || `Moment ${i + 1}`}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {clock(p.from)}–{clock(p.to)} · {Math.round(p.to - p.from)} s{p.hook ? ` · “${p.hook}”` : ""}
                  </p>
                </div>
                {made ? (
                  made.status === "running" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-sky-300">
                      <Loader2 size={13} className="animate-spin" /> Rendering…
                    </span>
                  ) : made.projectId ? (
                    <Link href={`/projects/${made.projectId}`} className="text-xs font-semibold text-sky-300 hover:text-white">
                      Open Short
                    </Link>
                  ) : null
                ) : (
                  info.available && (
                    <button
                      type="button"
                      onClick={() => post({ action: "make", index: i }, `make-${i}`)}
                      disabled={busy !== ""}
                      className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-purple-600 px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === `make-${i}` ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                      Make Short · {p.credits} credits
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(() => {
        const others = info.shorts.filter(
          (s) => s.status !== "failed" && !info.picks.some((p) => Math.abs(s.from - p.from) < 0.5 && Math.abs(s.to - p.to) < 0.5)
        );
        if (!others.length) return null;
        return (
          <div className="mt-4">
            <p className="mb-2 text-xs text-gray-500">Shorts made earlier</p>
            <ul className="space-y-1.5">
              {others.map((s) => (
                <li key={s.jobId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-gray-300">
                    {s.title || "Short"} <span className="text-xs text-gray-500">{clock(s.from)}–{clock(s.to)}</span>
                  </span>
                  {s.status === "running" ? (
                    <Loader2 size={13} className="animate-spin text-sky-300" />
                  ) : s.projectId ? (
                    <Link href={`/projects/${s.projectId}`} className="shrink-0 text-xs font-semibold text-sky-300 hover:text-white">
                      Open
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })()}
      {info.shorts.some((s) => s.status === "failed") && (
        <p className="mt-3 text-xs text-gray-500">A Short that failed was refunded — you can make it again.</p>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
