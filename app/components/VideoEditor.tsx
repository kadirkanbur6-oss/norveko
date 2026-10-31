"use client";

// "Edit video" on the project page (finished full videos only): swap any
// scene's image, pick another music track or subtitle style, then re-render.
// API: /api/projects/[id]/edit (GET timeline, POST regenerate / rerender).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Clapperboard, Film, ImageIcon, Loader2, Music, RefreshCw, Sparkles, X } from "lucide-react";
import { CaptionStylePicker } from "./StylePickers";

interface SlotView {
  index: number;
  start: number;
  length: number;
  prompt: string;
  kind: "clip" | "image";
  edited: boolean;
  imageUrl: string | null;
  clipUrl: string | null;
}

interface EditState {
  editable: boolean;
  jobId?: string;
  status?: string;
  renderError?: string | null;
  slots?: SlotView[];
  music?: { id: string; title: string; mood: string };
  tracks?: Array<{ id: string; title: string; mood: string }>;
  captionStyle?: string;
  stillCredits?: number;
  rerendersLeft?: number;
  pendingEdits?: boolean;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function VideoEditor({ projectId, vertical }: { projectId: string; vertical: boolean }) {
  const [state, setState] = useState<EditState | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [musicId, setMusicId] = useState("");
  const [captionId, setCaptionId] = useState("");
  const [busy, setBusy] = useState<"image" | "render" | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/edit`);
    const data: EditState & { success?: boolean } = await res.json();
    if (!data.success) return;
    setState(data);
    setMusicId(data.music?.id ?? "");
    setCaptionId(data.captionStyle ?? "bold");
    setRendering(data.status === "running");
  }, [projectId]);

  useEffect(() => {
    // Initial load of the editable timeline.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // While a re-render runs, poll the job (the poll also advances the render).
  useEffect(() => {
    if (!rendering || !state?.jobId) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/pipeline/${state.jobId}`).then((r) => r.json()).catch(() => null);
      const status = res?.job?.status ?? res?.status;
      if (status === "completed") {
        clearInterval(timer);
        window.location.reload();
      } else if (status === "failed") {
        clearInterval(timer);
        setRendering(false);
        setError("The re-render failed. Your previous video is unchanged — please try again.");
        void load();
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [rendering, state?.jobId, load]);

  const slot = useMemo(() => state?.slots?.find((s) => s.index === selected) ?? null, [state, selected]);
  const moods = useMemo(() => {
    const groups: Record<string, Array<{ id: string; title: string }>> = {};
    for (const t of state?.tracks ?? []) (groups[t.mood] ??= []).push({ id: t.id, title: t.title });
    return groups;
  }, [state?.tracks]);

  if (!state?.editable) return null;

  const changed =
    Boolean(state.pendingEdits) || musicId !== (state.music?.id ?? "") || captionId !== (state.captionStyle ?? "bold");

  function choose(s: SlotView) {
    setSelected(s.index);
    setPrompt(s.prompt);
    setError("");
  }

  async function regenerate() {
    if (!slot) return;
    setBusy("image");
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate", index: slot.index, prompt }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not make a new image.");
      setState((prev) =>
        prev
          ? { ...prev, pendingEdits: true, slots: prev.slots?.map((s) => (s.index === data.slot.index ? data.slot : s)) }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not make a new image.");
    } finally {
      setBusy(null);
    }
  }

  async function rerender() {
    setBusy("render");
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "rerender",
          musicId: musicId !== state?.music?.id ? musicId : null,
          captionStyle: captionId !== state?.captionStyle ? captionId : null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not re-render.");
      setRendering(true);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-render.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-blue-400/25 bg-gradient-to-br from-blue-500/[0.07] to-transparent p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15">
            <Clapperboard size={20} className="text-blue-300" aria-hidden />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Edit video</h3>
            <p className="text-xs text-gray-400">Swap any scene&apos;s image, change the music or subtitles, then re-render.</p>
          </div>
        </div>
        {rendering ? (
          <span className="inline-flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-200">
            <Loader2 size={15} className="animate-spin" aria-hidden /> Re-rendering… about 2–4 min
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:border-blue-400/50"
          >
            {open ? <X size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />}
            {open ? "Close editor" : "Open editor"}
          </button>
        )}
      </div>

      {open && !rendering && (
        <div className="mt-5 space-y-5">
          {/* Timeline */}
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Scenes — click one to change its image</p>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {state.slots?.map((s) => (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => choose(s)}
                  aria-pressed={selected === s.index}
                  className={`relative shrink-0 overflow-hidden rounded-lg border transition ${
                    selected === s.index ? "border-blue-400 ring-2 ring-blue-400/40" : "border-white/10 hover:border-white/30"
                  } ${vertical ? "h-28 w-16" : "h-16 w-28"}`}
                >
                  {s.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.imageUrl} alt={`Scene at ${fmt(s.start)}`} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-white/5 text-gray-500">
                      <Film size={16} aria-hidden />
                    </span>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 text-[10px] text-white">{fmt(s.start)}</span>
                  {s.kind === "clip" && (
                    <span className="absolute left-1 top-1 rounded bg-purple-600/90 px-1 text-[9px] font-semibold text-white">CLIP</span>
                  )}
                  {s.edited && (
                    <span className="absolute right-1 top-1 rounded bg-green-600/90 px-1 text-[9px] font-semibold text-white">NEW</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {slot && (
            <div className="grid gap-4 rounded-xl border border-white/10 bg-[#0d0d16] p-4 sm:grid-cols-[auto_1fr]">
              <div className={`overflow-hidden rounded-lg bg-white/5 ${vertical ? "h-56 w-32" : "h-32 w-56"}`}>
                {slot.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.imageUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div>
                <label htmlFor="scene-prompt" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">
                  Scene at {fmt(slot.start)}–{fmt(slot.start + slot.length)} · describe the new image
                </label>
                <textarea
                  id="scene-prompt"
                  rows={4}
                  maxLength={800}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-blue-400/50"
                />
                {slot.kind === "clip" && (
                  <p className="mt-1 text-xs text-gray-500">This scene is an AI clip; the new image replaces it as a still with a slow camera move.</p>
                )}
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={busy !== null || !prompt.trim()}
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {busy === "image" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ImageIcon size={15} aria-hidden />}
                  {busy === "image" ? "Making the image…" : `New image · ${state.stillCredits} credits`}
                </button>
              </div>
            </div>
          )}

          {/* Music */}
          <div>
            <label htmlFor="edit-music" className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
              <Music size={13} aria-hidden /> Background music
            </label>
            <select
              id="edit-music"
              value={musicId}
              onChange={(e) => setMusicId(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-blue-400/50"
            >
              {Object.entries(moods).map(([mood, list]) => (
                <optgroup key={mood} label={mood[0].toUpperCase() + mood.slice(1)}>
                  {list.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.id === state.music?.id ? " (current)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          <CaptionStylePicker value={captionId} onChange={setCaptionId} />

          <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={rerender}
              disabled={busy !== null || !changed || (state.rerendersLeft ?? 0) <= 0}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              {busy === "render" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
              Re-render video
            </button>
            <span className="text-xs text-gray-500">
              Free · {state.rerendersLeft} re-render{state.rerendersLeft === 1 ? "" : "s"} left
              {!changed ? " · make a change first" : ""}
            </span>
          </div>
        </div>
      )}

      {state.renderError && !rendering && !error && (
        <p className="mt-3 text-xs text-yellow-200/90">The last re-render failed; the video shown is the previous version.</p>
      )}
      {error && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
