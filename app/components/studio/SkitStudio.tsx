"use client";

// Skit studio (AI Workspace): the joke or scene with its lines → a planned cast
// and shot list with a price → a finished short with voices, lip-sync and
// sound effects.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, Loader2, Sparkles, Volume2 } from "lucide-react";

type Skit = {
  id: string;
  status: "draft" | "running" | "completed" | "failed";
  phase: string;
  title: string;
  vertical: boolean;
  credits: number;
  seconds: number;
  characters: Array<{ id: string; name: string; look: string; voice: string }>;
  shots: Array<{ id: string; camera: string; speaker: string | null; line: string; action: string; sfx: string; imageUrl: string | null; ready: boolean }>;
  outputUrl: string | null;
  projectId: string | null;
  error: string | null;
  createdAt: string;
};

const PHASE_LABEL: Record<string, string> = {
  cast: "Drawing the characters…",
  shots: "Drawing the shots and recording the voices…",
  animate: "Bringing the shots to life…",
  render: "Cutting it together…",
};

const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${on ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"}`;

export default function SkitStudio({ text }: { text: string }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [skits, setSkits] = useState<Skit[]>([]);
  const [draft, setDraft] = useState<Skit | null>(null);
  const [draftFor, setDraftFor] = useState("");
  const [vertical, setVertical] = useState(true);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState<"" | "plan" | "start">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const d = await fetch("/api/skit").then((r) => r.json()).catch(() => null);
    if (d?.success) {
      setAllowed(Boolean(d.allowed));
      setSkits(d.skits ?? []);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // Running skits: each poll also does the next step of the work.
  const running = skits.filter((s) => s.status === "running").map((s) => s.id).join(",");
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const tick = async () => {
      await Promise.all(running.split(",").map((id) => fetch(`/api/skit?id=${id}`).catch(() => undefined)));
      if (alive) await load();
    };
    const t = setInterval(tick, 12000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [running, load]);

  async function post(body: Record<string, unknown>) {
    const d = await fetch("/api/skit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (!d.success) throw new Error(d.error || "Something went wrong.");
    return d;
  }

  async function plan() {
    setBusy("plan");
    setError("");
    try {
      const d = await post({ action: "plan", script: text, orientation: vertical ? "vertical" : "horizontal" });
      setDraft(d.skit);
      setDraftFor(text + (vertical ? "|v" : "|h"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The scene couldn't be planned.");
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!draft) return;
    setBusy("start");
    setError("");
    try {
      await post({ action: "start", id: draft.id, rights });
      setDraft(null);
      setRights(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "It couldn't be started.");
    } finally {
      setBusy("");
    }
  }

  const stale = draft && draftFor !== text + (vertical ? "|v" : "|h");
  const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";

  if (allowed === false) {
    return (
      <div className={card}>
        <p className="text-sm text-gray-300">
          Skits are available on any plan or pack.{" "}
          <Link href="/billing" className="text-sky-300 hover:text-white">
            See plans
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={card}>
        <p className="text-sm text-gray-300">
          Write the joke or scene above with the lines each character says. Add a style if you like — e.g. <span className="text-white">“make it like the viral cockroach videos”</span>. We cast it, voice every character, sync their lips and add the crowd sounds.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setVertical(true)} aria-pressed={vertical} className={chip(vertical)}>
            Vertical 9:16
          </button>
          <button type="button" onClick={() => setVertical(false)} aria-pressed={!vertical} className={chip(!vertical)}>
            Horizontal 16:9
          </button>
          <button
            type="button"
            onClick={plan}
            disabled={busy !== "" || text.trim().length < 10}
            className="ml-auto inline-flex items-center gap-2 rounded-xl border border-sky-400/40 px-4 py-2 text-sm font-semibold text-sky-100 transition hover:bg-sky-500/10 disabled:opacity-40"
          >
            {busy === "plan" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {busy === "plan" ? "Planning the scene…" : draft ? "Plan again" : "Plan the scene"}
          </button>
        </div>

        {draft && (
          <div className={`mt-5 space-y-4 border-t border-white/10 pt-5 ${stale ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-base font-semibold">{draft.title}</p>
              <p className="text-xs text-gray-500">
                {draft.shots.length} shots · about {draft.seconds} s{stale ? " · the text changed — plan again to update" : ""}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.characters.map((c) => (
                <div key={c.id} className="max-w-xs rounded-xl border border-white/10 bg-[#0d0d16] px-3 py-2">
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{c.look}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-400">
                    <Volume2 size={11} /> {c.voice}
                  </p>
                </div>
              ))}
            </div>
            <ol className="space-y-1.5">
              {draft.shots.map((s, i) => (
                <li key={s.id} className="flex gap-3 rounded-lg bg-[#0d0d16] px-3 py-2 text-sm">
                  <span className="w-5 shrink-0 text-xs text-gray-500">{i + 1}</span>
                  <span className="min-w-0">
                    {s.speaker ? (
                      <>
                        <span className="font-medium text-white">{s.speaker}:</span> <span className="text-gray-200">{s.line}</span>
                      </>
                    ) : (
                      <span className="italic text-gray-400">{s.action}</span>
                    )}
                    <span className="mt-0.5 block text-[11px] text-gray-500">
                      {s.camera} shot{s.sfx ? ` · sound: ${s.sfx}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <label className="flex items-start gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
              <span>This is comedy/fiction, and I won&apos;t present it as something a real person actually said or did.</span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={start}
                disabled={busy !== "" || !rights || Boolean(stale)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
              >
                {busy === "start" ? <Loader2 size={16} className="animate-spin" /> : <Clapperboard size={16} />}
                Make the video · {draft.credits} credits
              </button>
              <span className="text-xs text-gray-500">about 5–10 minutes</span>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </div>

      {skits.length > 0 && (
        <div className={card}>
          <p className="text-sm font-semibold">Your skits</p>
          <ul className="mt-3 space-y-3">
            {skits.map((s) => (
              <li key={s.id} className="rounded-xl border border-white/10 bg-[#0d0d16] px-4 py-3">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium">{s.title}</span>
                  <span className="text-xs text-gray-500">{new Date(s.createdAt).toLocaleString()}</span>
                  <span className="ml-auto">
                    {s.status === "running" ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-sky-300">
                        <Loader2 size={13} className="animate-spin" /> {PHASE_LABEL[s.phase] ?? "Working…"}
                      </span>
                    ) : s.status === "completed" && s.projectId ? (
                      <Link href={`/projects/${s.projectId}`} className="text-xs font-semibold text-sky-300 hover:text-white">
                        Open video
                      </Link>
                    ) : (
                      <span className="text-xs text-red-300">{s.error ?? "Failed"} · refunded</span>
                    )}
                  </span>
                </div>
                {s.status === "running" && s.shots.some((x) => x.imageUrl) && (
                  <div className="mt-3 flex gap-1.5 overflow-x-auto nv-no-scrollbar">
                    {s.shots.map((x) =>
                      x.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={x.id} src={x.imageUrl} alt="" className={`h-20 shrink-0 rounded-md object-cover ${x.ready ? "" : "opacity-60"}`} />
                      ) : (
                        <span key={x.id} className="h-20 w-12 shrink-0 animate-pulse rounded-md bg-white/5" />
                      )
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
