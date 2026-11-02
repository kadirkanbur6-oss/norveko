"use client";

// Timeline editor on the project page (finished full videos only).
// Scenes sit on a time ruler with the subtitles under them:
//   • drag the line between two scenes to change how long each stays on screen
//   • drag a scene onto another to swap what they show
//   • replace a scene with a new AI image, your own picture/video or a stock clip
//   • fix subtitle words and the on-screen hook
//   • change music / subtitle style, go back to earlier pictures or versions
// Nothing changes in the video until "Re-render video" (free, capped).
// API: /api/projects/[id]/edit.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Captions,
  Clapperboard,
  Film,
  History,
  ImageIcon,
  Loader2,
  Minus,
  Music,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { CaptionStylePicker } from "./StylePickers";

interface SlotView {
  index: number;
  start: number;
  length: number;
  prompt: string;
  kind: "clip" | "image";
  edited: boolean;
  source?: "upload" | "stock";
  imageUrl: string | null;
  clipUrl: string | null;
  /** Earlier pictures, newest first ("original" = the scene as first made). */
  history?: Array<{ url: string; at: string; poster?: string | null; clip?: boolean }>;
}

interface Cue {
  index: number;
  start: number;
  end: number;
  text: string;
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
  videoUrl?: string;
  versions?: Array<{ version: number; url: string; at: string }>;
  totalSeconds?: number;
  hook?: string;
  cues?: Cue[];
}

interface StockResult {
  id: number;
  provider: string;
  preview: string;
  videoUrl: string;
  seconds: number;
  author: string;
  pageUrl: string;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const ZOOMS = [6, 12, 24, 48, 80];

export default function VideoEditor({ projectId, vertical }: { projectId: string; vertical: boolean }) {
  const [state, setState] = useState<EditState | null>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [selectedCue, setSelectedCue] = useState<number | null>(null);
  const [cueText, setCueText] = useState("");
  const [hook, setHook] = useState("");
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState<"ai" | "upload" | "stock">("ai");
  const [musicId, setMusicId] = useState("");
  const [captionId, setCaptionId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(2);
  const [drag, setDrag] = useState<{ cut: number; time: number } | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [stockQuery, setStockQuery] = useState("");
  const [stock, setStock] = useState<StockResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/edit`);
    const data: EditState & { success?: boolean } = await res.json();
    if (!data.success) return;
    setState(data);
    setMusicId(data.music?.id ?? "");
    setCaptionId(data.captionStyle ?? "bold");
    setHook(data.hook ?? "");
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

  const slots = useMemo(() => [...(state?.slots ?? [])].sort((a, b) => a.start - b.start), [state?.slots]);
  const slot = useMemo(() => slots.find((s) => s.index === selected) ?? null, [slots, selected]);
  const moods = useMemo(() => {
    const groups: Record<string, Array<{ id: string; title: string }>> = {};
    for (const t of state?.tracks ?? []) (groups[t.mood] ??= []).push({ id: t.id, title: t.title });
    return groups;
  }, [state?.tracks]);

  if (!state?.editable) return null;

  const total = state.totalSeconds || (slots.length ? slots[slots.length - 1].start + slots[slots.length - 1].length : 0);
  const pps = ZOOMS[zoom];
  const width = Math.max(1, Math.ceil(total * pps));
  const tick = pps >= 48 ? 1 : pps >= 24 ? 2 : pps >= 12 ? 5 : 10;

  // Scene bounds while a cut is being dragged.
  const bounds = slots.map((s, i) => {
    let start = s.start;
    let end = s.start + s.length;
    if (drag) {
      if (i === drag.cut) end = drag.time;
      if (i === drag.cut + 1) start = drag.time;
    }
    return { start, end };
  });

  const changed =
    Boolean(state.pendingEdits) || musicId !== (state.music?.id ?? "") || captionId !== (state.captionStyle ?? "bold");

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/projects/${projectId}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  /** Run an edit that returns the new slots. */
  async function edit(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError("");
    try {
      const data = await post(body);
      setState((prev) => {
        if (!prev) return prev;
        const next: EditState = { ...prev, pendingEdits: true };
        if (Array.isArray(data.slots)) next.slots = data.slots;
        else if (data.slot) next.slots = prev.slots?.map((s) => (s.index === data.slot.index ? data.slot : s));
        return next;
      });
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function choose(s: SlotView) {
    setSelected(s.index);
    setSelectedCue(null);
    setPrompt(s.prompt);
    setStock([]);
    setError("");
  }

  function chooseCue(c: Cue) {
    setSelectedCue(c.index);
    setSelected(null);
    setCueText(c.text);
    setError("");
  }

  // Dragging the line between scene `cut` and `cut + 1`.
  function startCut(e: React.PointerEvent, cut: number) {
    e.preventDefault();
    e.stopPropagation();
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const min = slots[cut].start + 1;
    const max = slots[cut + 1].start + slots[cut + 1].length - 1;
    const at = (clientX: number) => Math.min(max, Math.max(min, Math.round(((clientX - rect.left) / pps) * 10) / 10));
    let time = slots[cut + 1].start;
    setDrag({ cut, time });
    const move = (ev: PointerEvent) => {
      time = at(ev.clientX);
      setDrag({ cut, time });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDrag(null);
      if (Math.abs(time - slots[cut + 1].start) < 0.05) return;
      const cuts = slots.slice(1).map((s, i) => (i === cut ? time : s.start));
      void edit("retime", { action: "retime", cuts });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Keyboard alternative for the cut handles: ←/→ move by 0.5 s.
  function nudgeCut(e: React.KeyboardEvent, cut: number) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowLeft" ? -0.5 : 0.5;
    const next = slots[cut + 1].start + delta;
    if (next < slots[cut].start + 1 || next > slots[cut + 1].start + slots[cut + 1].length - 1) return;
    const cuts = slots.slice(1).map((s, i) => (i === cut ? next : s.start));
    void edit("retime", { action: "retime", cuts });
  }

  async function uploadFile(file: File) {
    if (!slot) return;
    setBusy("upload");
    setError("");
    try {
      const prep = await post({ action: "uploadUrl", type: file.type, size: file.size });
      const { supabase } = await import("@/app/lib/supabase");
      const { error: upErr } = await supabase.storage.from("videos").uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type });
      if (upErr) throw new Error("The upload failed. Please try again.");
      let seconds: number | undefined;
      if (prep.kind === "video") {
        seconds = await new Promise<number | undefined>((resolve) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) ? v.duration : undefined);
          v.onerror = () => resolve(undefined);
          v.src = URL.createObjectURL(file);
        });
      }
      setBusy(null);
      await edit("upload", { action: "useUpload", index: slot.index, path: prep.path, seconds });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
      setBusy(null);
    }
  }

  async function searchStock() {
    setBusy("stock");
    setError("");
    try {
      const data = await post({ action: "stockSearch", query: stockQuery });
      setStock(data.clips ?? []);
      if (!data.clips?.length) setError("No clips found — try other words (in English works best).");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setBusy(null);
    }
  }

  async function switchVersion(url: string) {
    setBusy("version");
    setError("");
    try {
      await post({ action: "useVersion", url });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch versions.");
      setBusy(null);
    }
  }

  async function rerender() {
    setBusy("render");
    setError("");
    try {
      await post({
        action: "rerender",
        musicId: musicId !== state?.music?.id ? musicId : null,
        captionStyle: captionId !== state?.captionStyle ? captionId : null,
      });
      setRendering(true);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not re-render.");
    } finally {
      setBusy(null);
    }
  }

  const label = "mb-2 flex items-center gap-2 text-xs font-medium text-gray-400";
  const field = "w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-blue-400/50";

  return (
    <div className="mt-4 rounded-2xl border border-blue-400/25 bg-gradient-to-br from-blue-500/[0.07] to-transparent p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15">
            <Clapperboard size={20} className="text-blue-300" aria-hidden />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Edit video</h3>
            <p className="text-xs text-gray-400">Timeline: timing, scenes, your own footage, subtitles and music — then re-render.</p>
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
          {/* Hook card text */}
          <div>
            <label htmlFor="edit-hook" className={label}>
              On-screen hook (first 3 seconds)
            </label>
            <div className="flex gap-2">
              <input id="edit-hook" value={hook} maxLength={200} onChange={(e) => setHook(e.target.value)} className={field} />
              <button
                type="button"
                onClick={() => edit("hook", { action: "text", hook })}
                disabled={busy !== null || !hook.trim() || hook === (state.hook ?? "")}
                className="shrink-0 rounded-xl border border-white/15 px-4 text-sm text-white transition hover:border-blue-400/50 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs font-medium text-gray-400">
                Timeline · drag a line between scenes to retime, drag a scene onto another to swap
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => setZoom((z) => Math.max(0, z - 1))}
                  disabled={zoom === 0}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-gray-300 disabled:opacity-30"
                >
                  <Minus size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
                  disabled={zoom === ZOOMS.length - 1}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-gray-300 disabled:opacity-30"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#0a0a12] p-2">
              <div ref={trackRef} className="relative select-none" style={{ width }}>
                {/* Ruler */}
                <div className="relative h-5 border-b border-white/10">
                  {Array.from({ length: Math.floor(total / tick) + 1 }, (_, i) => i * tick).map((t) => (
                    <span key={t} className="absolute top-0 text-[10px] text-gray-500" style={{ left: t * pps }}>
                      <span className="absolute -top-0 left-0 h-1.5 w-px bg-white/20" />
                      <span className="pl-1">{fmt(t)}</span>
                    </span>
                  ))}
                </div>

                {/* Scenes */}
                <div className="relative mt-2 h-20">
                  {slots.map((s, i) => {
                    const b = bounds[i];
                    const on = selected === s.index;
                    return (
                      <button
                        key={s.index}
                        type="button"
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", String(s.index))}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(s.index);
                        }}
                        onDragLeave={() => setDragOver(null)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOver(null);
                          const from = Number(e.dataTransfer.getData("text/plain"));
                          if (Number.isFinite(from) && from !== s.index) void edit("swap", { action: "swap", a: from, b: s.index });
                        }}
                        onClick={() => choose(s)}
                        aria-pressed={on}
                        aria-label={`Scene ${fmt(b.start)} to ${fmt(b.end)}`}
                        className={`absolute top-0 h-full overflow-hidden rounded-md border bg-white/5 transition-[border-color] ${
                          on ? "z-10 border-blue-400 ring-2 ring-blue-400/40" : dragOver === s.index ? "border-yellow-300" : "border-white/10 hover:border-white/30"
                        }`}
                        style={{ left: b.start * pps + 1, width: Math.max(4, (b.end - b.start) * pps - 2) }}
                      >
                        {s.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.imageUrl} alt="" draggable={false} className="h-full w-full object-cover opacity-90" loading="lazy" />
                        ) : s.clipUrl ? (
                          <video src={s.clipUrl} muted preload="metadata" className="h-full w-full object-cover" />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-gray-500">
                            <Film size={14} aria-hidden />
                          </span>
                        )}
                        {s.kind === "clip" && (
                          <span className="absolute left-1 top-1 rounded bg-purple-600/90 px-1 text-[9px] font-semibold text-white">CLIP</span>
                        )}
                        {s.edited && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-green-400" title="Changed" />}
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 text-left text-[10px] text-white">
                          {(b.end - b.start).toFixed(1)}s
                        </span>
                      </button>
                    );
                  })}
                  {/* Cut handles */}
                  {slots.slice(0, -1).map((s, i) => (
                    <span
                      key={`cut-${s.index}`}
                      role="slider"
                      tabIndex={0}
                      aria-label={`Cut between scene ${i + 1} and ${i + 2}`}
                      aria-valuenow={Math.round(bounds[i].end * 10) / 10}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(total)}
                      onPointerDown={(e) => startCut(e, i)}
                      onKeyDown={(e) => nudgeCut(e, i)}
                      className="absolute top-0 z-20 flex h-full w-3 -translate-x-1/2 cursor-col-resize items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      style={{ left: bounds[i].end * pps }}
                    >
                      <span className={`h-3/4 w-1 rounded-full ${drag?.cut === i ? "bg-yellow-300" : "bg-white/60"}`} />
                    </span>
                  ))}
                  {drag && (
                    <span
                      className="pointer-events-none absolute -top-6 z-30 -translate-x-1/2 rounded bg-yellow-300 px-1.5 py-0.5 text-[10px] font-semibold text-black"
                      style={{ left: drag.time * pps }}
                    >
                      {drag.time.toFixed(1)}s
                    </span>
                  )}
                </div>

                {/* Subtitles */}
                {(state.cues?.length ?? 0) > 0 && (
                  <div className="relative mt-2 h-9">
                    {state.cues!.map((c) => (
                      <button
                        key={c.index}
                        type="button"
                        onClick={() => chooseCue(c)}
                        title={c.text}
                        className={`absolute top-0 h-full overflow-hidden rounded border px-1 text-left text-[10px] leading-tight transition ${
                          selectedCue === c.index ? "border-sky-400 bg-sky-500/20 text-white" : "border-white/10 bg-white/[0.04] text-gray-400 hover:text-white"
                        }`}
                        style={{ left: c.start * pps + 1, width: Math.max(3, (c.end - c.start) * pps - 2) }}
                      >
                        {c.text}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Subtitle fix */}
          {selectedCue !== null && state.cues?.[selectedCue] && (
            <div className="rounded-xl border border-white/10 bg-[#0d0d16] p-4">
              <label htmlFor="cue-text" className={label}>
                <Captions size={13} aria-hidden /> Subtitle at {fmt(state.cues[selectedCue].start)} · fix the words (timing stays)
              </label>
              <textarea id="cue-text" rows={2} maxLength={160} value={cueText} onChange={(e) => setCueText(e.target.value)} className={field} />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await edit("cue", { action: "text", cues: [{ index: selectedCue, text: cueText }] });
                    if (ok) setState((prev) => (prev ? { ...prev, cues: prev.cues?.map((c) => (c.index === selectedCue ? { ...c, text: cueText.trim() } : c)) } : prev));
                  }}
                  disabled={busy !== null || !cueText.trim()}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Save subtitle
                </button>
                <button type="button" onClick={() => setSelectedCue(null)} className="rounded-xl px-3 py-2 text-sm text-gray-400 hover:text-white">
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Scene panel */}
          {slot && (
            <div className="grid gap-4 rounded-xl border border-white/10 bg-[#0d0d16] p-4 sm:grid-cols-[auto_1fr]">
              <div className={`overflow-hidden rounded-lg bg-white/5 ${vertical ? "h-56 w-32" : "h-32 w-56"}`}>
                {slot.clipUrl ? (
                  <video src={slot.clipUrl} poster={slot.imageUrl ?? undefined} muted loop autoPlay playsInline className="h-full w-full object-cover" />
                ) : slot.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={slot.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-400">
                  Scene {fmt(slot.start)}–{fmt(slot.start + slot.length)} · {slot.length.toFixed(1)} s
                </p>
                <div className="mt-2 flex gap-1 rounded-xl border border-white/10 p-1" role="tablist">
                  {(
                    [
                      ["ai", "New AI image", Sparkles],
                      ["upload", "Your file", Upload],
                      ["stock", "Stock clip", Search],
                    ] as const
                  ).map(([id, text, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={tab === id}
                      onClick={() => setTab(id)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition ${tab === id ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
                    >
                      <Icon size={13} aria-hidden /> {text}
                    </button>
                  ))}
                </div>

                {tab === "ai" && (
                  <div className="mt-3">
                    <textarea rows={3} maxLength={800} value={prompt} onChange={(e) => setPrompt(e.target.value)} className={field} aria-label="Describe the new image" />
                    <button
                      type="button"
                      onClick={() => edit("image", { action: "regenerate", index: slot.index, prompt })}
                      disabled={busy !== null || !prompt.trim()}
                      className="mt-2 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {busy === "image" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <ImageIcon size={15} aria-hidden />}
                      {busy === "image" ? "Making the image…" : `New image · ${state.stillCredits} credits`}
                    </button>
                  </div>
                )}

                {tab === "upload" && (
                  <div className="mt-3">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void uploadFile(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-white transition hover:border-blue-400/50 disabled:opacity-50"
                    >
                      {busy === "upload" ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                      {busy === "upload" ? "Uploading…" : "Choose a picture or video"}
                    </button>
                    <p className="mt-2 text-xs text-gray-500">Free. Pictures up to 10 MB, videos up to 50 MB (MP4, WebM, MOV). Use only footage you have the rights to.</p>
                  </div>
                )}

                {tab === "stock" && (
                  <div className="mt-3">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void searchStock();
                      }}
                      className="flex gap-2"
                    >
                      <input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} placeholder="e.g. mountain snow storm" className={field} aria-label="Search stock footage" />
                      <button type="submit" disabled={busy !== null || stockQuery.trim().length < 2} className="shrink-0 rounded-xl border border-white/15 px-4 text-sm text-white disabled:opacity-40">
                        {busy === "stock" ? <Loader2 size={15} className="animate-spin" /> : "Search"}
                      </button>
                    </form>
                    {stock.length > 0 && (
                      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {stock.map((c) => (
                          <button
                            key={`${c.provider}-${c.id}`}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => edit("useStock", { action: "useStock", index: slot.index, videoUrl: c.videoUrl, preview: c.preview, seconds: c.seconds, author: c.author })}
                            className="group relative aspect-video overflow-hidden rounded-lg border border-white/10 hover:border-blue-400/60 disabled:opacity-50"
                            title={`${c.seconds}s · ${c.author}`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.preview} alt="" className="h-full w-full object-cover" loading="lazy" />
                            <span className="absolute bottom-0 right-0 bg-black/70 px-1 text-[10px] text-white">{Math.round(c.seconds)}s</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-gray-500">Free stock footage (Pixabay/Pexels). Click a clip to use it.</p>
                  </div>
                )}

                {(slot.history?.length ?? 0) > 0 && (
                  <div className="mt-4">
                    <p className={label}>
                      <Undo2 size={12} aria-hidden /> Earlier pictures · free to go back
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {slot.history!.map((h) => (
                        <button
                          key={h.url + h.at}
                          type="button"
                          onClick={() => edit("restore", { action: "restoreScene", index: slot.index, url: h.url })}
                          disabled={busy !== null}
                          title={h.url === "original" ? "Go back to the original scene" : `From ${new Date(h.at).toLocaleString()}`}
                          className={`relative overflow-hidden rounded-md border border-white/10 transition hover:border-blue-400/60 disabled:opacity-50 ${vertical ? "h-20 w-12" : "h-12 w-20"}`}
                        >
                          {h.url === "original" ? (
                            <span className="flex h-full w-full items-center justify-center bg-white/5 text-[10px] font-semibold text-gray-300">Original</span>
                          ) : h.clip ? (
                            h.poster ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={h.poster} alt="Earlier clip" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <video src={h.url} muted preload="metadata" className="h-full w-full object-cover" />
                            )
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={h.url} alt="Earlier picture" className="h-full w-full object-cover" loading="lazy" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Music */}
          <div>
            <label htmlFor="edit-music" className={label}>
              <Music size={13} aria-hidden /> Background music
            </label>
            <select id="edit-music" value={musicId} onChange={(e) => setMusicId(e.target.value)} className={field}>
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

          {(state.versions?.length ?? 0) > 0 && (
            <div>
              <p className={label}>
                <History size={13} aria-hidden /> Earlier versions
              </p>
              <ul className="space-y-2">
                {state.versions!.map((v) => (
                  <li key={v.url} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#0d0d16] px-3 py-2 text-sm">
                    <span className="font-semibold text-white">{v.version === 0 ? "First render" : `Version ${v.version}`}</span>
                    <span className="text-xs text-gray-500">replaced {new Date(v.at).toLocaleString()}</span>
                    <a href={v.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-blue-300 hover:text-white">
                      Watch
                    </a>
                    <button
                      type="button"
                      onClick={() => switchVersion(v.url)}
                      disabled={busy !== null}
                      className="rounded-lg border border-white/15 px-3 py-1 text-xs text-white transition hover:border-blue-400/50 disabled:opacity-50"
                    >
                      Use this version
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
              {!changed ? " · make a change first" : " · your changes show up after the re-render"}
            </span>
            {busy && busy !== "render" && <Loader2 size={14} className="animate-spin text-gray-400" aria-label="Saving" />}
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
