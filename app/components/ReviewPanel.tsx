"use client";

// Storyboard review: the job pauses after the script. The creator reads and
// edits the narration and the scene plan, then approves (the voice and
// visuals are made) or cancels (everything not yet made is refunded).

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Circle, Hand, Loader2, XCircle } from "lucide-react";
import { wordRange } from "@/lib/pipeline/narration";
import { languageOption } from "@/lib/pipeline/options";

interface Scene {
  sceneNumber: number;
  description: string;
  videoPrompt: string;
  characters?: string[];
}

export default function ReviewPanel({
  jobId,
  hook: initialHook,
  script: initialScript,
  scenes: initialScenes,
  duration,
  language,
  onDone,
}: {
  jobId: string;
  hook: string;
  script: string;
  scenes: Scene[];
  duration?: string | null;
  language?: string | null;
  onDone: () => void;
}) {
  const [hook, setHook] = useState(initialHook);
  // Show the narration without the hook sentence it starts with.
  const [script, setScript] = useState(
    initialHook && initialScript.startsWith(initialHook) ? initialScript.slice(initialHook.length).trim() : initialScript
  );
  const [scenes, setScenes] = useState<Scene[]>(initialScenes);
  const [openScene, setOpenScene] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "approve" | "cancel">("");
  const [error, setError] = useState("");

  const panelRef = useRef<HTMLDivElement | null>(null);
  // Bring the review to the viewer and say it in the tab title too: the video is not being made yet.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const before = document.title;
    document.title = "Approve your script | Norveko";
    return () => {
      document.title = before;
    };
  }, []);

  const words = `${hook} ${script}`.split(/\s+/).filter(Boolean).length;
  const range = wordRange(duration ?? "60 seconds", languageOption(language ?? "English").code);
  const lengthNote =
    words < range.min ? `A bit short for ${duration}. Aim for about ${range.target} words.` : words > range.max ? `A bit long for ${duration}. Aim for about ${range.target} words.` : null;

  async function send(action: "approve" | "cancel") {
    setBusy(action);
    setError("");
    try {
      const d = await fetch(`/api/pipeline/${jobId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "approve"
            ? { action, hook, script: `${hook} ${script}`.trim(), scenes: scenes.map(({ sceneNumber, description, videoPrompt }) => ({ sceneNumber, description, videoPrompt })) }
            : { action }
        ),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Something went wrong.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy("");
    }
  }

  const field = "w-full rounded-xl border border-white/10 bg-[var(--nv-field)] p-3 text-sm text-white outline-none focus:border-sky-400/50";

  const approveButton = (big: boolean) => (
    <button
      type="button"
      onClick={() => send("approve")}
      disabled={busy !== "" || words < 5}
      className={`inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:opacity-90 disabled:opacity-50 ${
        big ? "px-6 py-3 text-base" : "px-5 py-2.5 text-sm"
      }`}
    >
      {busy === "approve" ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
      Approve and make the video
    </button>
  );

  const stages = [
    { label: "Script written", state: "done" },
    { label: "Your review", state: "now" },
    { label: "Voice, visuals and video", state: "next" },
  ] as const;

  return (
    <div ref={panelRef} className="scroll-mt-24 rounded-2xl border-2 border-sky-400/50 bg-sky-500/[0.07] shadow-[0_0_40px_-12px_rgba(56,189,248,0.45)]">
      {/* What is going on, said plainly: nothing is being made until you approve. */}
      <div className="rounded-t-2xl border-b border-sky-400/20 bg-sky-500/10 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-400/20 text-sky-200">
            <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-sky-400/20 motion-reduce:hidden" />
            <Hand size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-white sm:text-2xl">Your video is waiting for you</h3>
            <p className="mt-1 text-sm text-sky-100/90">
              The script is ready, but the video has <strong className="font-semibold text-white">not been made yet</strong>. Read it, change anything you like, then approve. The voice, pictures and video are made only after that.
            </p>
          </div>
        </div>

        <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs">
          {stages.map((st, i) => (
            <li key={st.label} className="flex items-center gap-2">
              <span
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                  st.state === "done"
                    ? "bg-green-500/15 text-green-200"
                    : st.state === "now"
                      ? "bg-sky-400 font-semibold text-[#06121c]"
                      : "bg-white/5 text-gray-400"
                }`}
              >
                {st.state === "done" ? <CheckCircle2 size={13} aria-hidden /> : st.state === "now" ? <Hand size={13} aria-hidden /> : <Circle size={13} aria-hidden />}
                {st.label}
              </span>
              {i < stages.length - 1 && <span aria-hidden className="h-px w-4 bg-white/20" />}
            </li>
          ))}
        </ol>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {approveButton(true)}
          <span className="text-xs text-sky-100/70">Waits up to 24 hours, then the credits for unmade steps come back.</span>
        </div>
      </div>

      <div className="p-5 sm:p-6">
      <label className="block">
        <span className="mb-1 block text-xs text-gray-400">Hook (spoken first and shown on screen)</span>
        <input value={hook} onChange={(e) => setHook(e.target.value)} maxLength={300} className={field} />
      </label>
      <label className="mt-4 block">
        <span className="mb-1 flex items-center justify-between text-xs text-gray-400">
          <span>Narration</span>
          <span className={lengthNote ? "text-amber-300" : "text-gray-500"}>{words} words</span>
        </span>
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={10} className={`${field} leading-relaxed`} />
        {lengthNote && <span className="mt-1 block text-xs text-amber-300">{lengthNote}</span>}
      </label>

      <div className="mt-4">
        <p className="mb-2 text-xs text-gray-400">Scenes ({scenes.length})</p>
        <ul className="space-y-2">
          {scenes.map((s, i) => {
            const open = openScene === s.sceneNumber;
            return (
              <li key={s.sceneNumber} className="rounded-xl border border-white/10 bg-[var(--nv-panel)]">
                <button
                  type="button"
                  onClick={() => setOpenScene(open ? null : s.sceneNumber)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <span className="w-6 shrink-0 text-xs text-gray-500">{s.sceneNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-200">{s.description}</span>
                  {s.characters?.length ? <span className="shrink-0 text-[11px] text-sky-300">{s.characters.join(", ")}</span> : null}
                  <ChevronDown size={15} className={`shrink-0 text-gray-500 transition ${open ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {open && (
                  <div className="space-y-3 border-t border-white/10 p-3">
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500">What happens</span>
                      <textarea
                        value={s.description}
                        rows={2}
                        onChange={(e) => setScenes((prev) => prev.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                        className={field}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs text-gray-500">What the picture shows (English, for the image model)</span>
                      <textarea
                        value={s.videoPrompt}
                        rows={3}
                        onChange={(e) => setScenes((prev) => prev.map((x, j) => (j === i ? { ...x, videoPrompt: e.target.value } : x)))}
                        className={field}
                      />
                    </label>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

      </div>

      {/* Always in reach while reading a long script. */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-b-2xl border-t border-sky-400/20 bg-[var(--nv-panel)]/95 px-5 py-3 backdrop-blur sm:px-6">
        {approveButton(false)}
        <button
          type="button"
          onClick={() => send("cancel")}
          disabled={busy !== ""}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2.5 text-sm text-gray-300 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
        >
          {busy === "cancel" ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
          Cancel and refund the rest
        </button>
      </div>
    </div>
  );
}
