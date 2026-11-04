"use client";

// Project page → Video: edit a finished skit. Make any single shot again (with
// an optional note), or re-cut it with subtitles / music on or off. The new
// cut replaces the video in the same project.

import { useCallback, useEffect, useState } from "react";
import { Captions, Loader2, Music, RefreshCw, Scissors } from "lucide-react";
import GenerationStage from "../GenerationStage";

type Shot = { id: string; camera: string; speaker: string | null; line: string; action: string; imageUrl: string | null; redoCredits: number };
type Skit = {
  id: string;
  status: string;
  phase: string;
  title: string;
  vertical: boolean;
  captions: boolean;
  music: boolean;
  editsLeft: number;
  shots: Shot[];
  phaseAt?: Record<string, string>;
  createdAt: string;
  error: string | null;
};

export default function SkitEditor({ projectId }: { projectId: string }) {
  const [skit, setSkit] = useState<Skit | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const d = await fetch(`/api/skit?project=${projectId}`).then((r) => r.json()).catch(() => null);
    if (d?.success) setSkit(d.skit);
    return d?.skit as Skit | null;
  }, [projectId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  // While an edit runs, each poll also moves it along; when it's done, show the new cut.
  const running = skit?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      const s = await load();
      if (s && s.status !== "running") window.location.reload();
    }, 12000);
    return () => clearInterval(t);
  }, [running, load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const d = await fetch("/api/skit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "The edit couldn't be started.");
      setOpen(null);
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The edit couldn't be started.");
    } finally {
      setBusy(false);
    }
  }

  if (!skit) return null;

  if (running) {
    const phases = ["shots", "animate", "render"];
    const at = Math.max(0, phases.indexOf(skit.phase));
    return (
      <div className="mt-6">
        <GenerationStage
          title={skit.title}
          createdAt={skit.phaseAt?.[phases[0]] ?? skit.phaseAt?.animate ?? skit.createdAt}
          steps={[
            { id: "shots", label: "Drawing the new shot", expected: 30, messages: ["Redrawing the shot…"] },
            { id: "animate", label: "Bringing it to life", expected: 150, messages: ["Syncing the lips…", "Animating the shot…"] },
            { id: "render", label: "Cutting it together again", expected: 60, messages: ["Mixing voices, music and subtitles…", "Rendering the new MP4…"] },
          ].map((x, i) => ({ ...x, status: i < at ? "completed" : i === at ? "running" : "pending", startedAt: skit.phaseAt?.[x.id] }))}
        />
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Scissors size={15} /> Edit this skit
          </p>
          <p className="mt-0.5 text-xs text-gray-500">Make any shot again, or switch subtitles and music. {skit.editsLeft} edits left.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || skit.editsLeft < 1}
            onClick={() => post({ action: "recut", id: skit.id, captions: !skit.captions })}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-gray-200 hover:border-white/25 disabled:opacity-40"
          >
            <Captions size={13} /> {skit.captions ? "Remove subtitles" : "Add subtitles"} · free
          </button>
          <button
            type="button"
            disabled={busy || skit.editsLeft < 1}
            onClick={() => post({ action: "recut", id: skit.id, music: !skit.music })}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-gray-200 hover:border-white/25 disabled:opacity-40"
          >
            <Music size={13} /> {skit.music ? "Remove music" : "Add music"} · free
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {skit.shots.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setOpen(open === i ? null : i)}
            aria-pressed={open === i}
            className={`overflow-hidden rounded-lg border text-left transition ${open === i ? "border-sky-400/60" : "border-white/10 hover:border-white/25"}`}
          >
            {s.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.imageUrl} alt="" className={`w-full object-cover ${skit.vertical ? "aspect-[9/16]" : "aspect-video"}`} />
            ) : (
              <span className={`block w-full bg-white/5 ${skit.vertical ? "aspect-[9/16]" : "aspect-video"}`} />
            )}
            <span className="block truncate px-2 py-1 text-[11px] text-gray-400">
              {i + 1}. {s.speaker ?? "Silent"}
            </span>
          </button>
        ))}
      </div>

      {open !== null && skit.shots[open] && (
        <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0d16] p-4">
          <p className="text-sm text-gray-200">
            {skit.shots[open].speaker ? (
              <>
                <span className="font-medium text-white">{skit.shots[open].speaker}:</span> {skit.shots[open].line}
              </>
            ) : (
              <span className="italic text-gray-400">{skit.shots[open].action}</span>
            )}
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="What should change? e.g. closer on his face, he looks angrier, put him on the left"
            className="mt-3 w-full rounded-xl border border-white/10 bg-[#12121c] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400/50"
          />
          <button
            type="button"
            disabled={busy || skit.editsLeft < 1}
            onClick={() => post({ action: "redoShot", id: skit.id, index: open, note })}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Make this shot again · {skit.shots[open].redoCredits} credits
          </button>
          <p className="mt-2 text-xs text-gray-500">The voice stays the same; the picture and its movement are made again, then the skit is re-cut.</p>
        </div>
      )}
      {skit.status === "failed" && skit.error && <p className="mt-3 text-xs text-red-300">Last edit failed: {skit.error} · refunded</p>}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
