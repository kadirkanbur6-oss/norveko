"use client";
import { friendlyErrorLine } from "@/lib/user-error";

// Character swap: upload a short clip, pick one of your characters, and they
// take the place of the person in it — same moves, expressions and sound.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Film, Loader2, Plus, Shuffle, Upload } from "lucide-react";
import { CharacterCreator, type CharacterItem } from "../CharactersCard";
import FinishedVideo from "./FinishedVideo";
import GenerationStage from "../GenerationStage";

type Swap = {
  id: string;
  status: "running" | "completed" | "failed";
  phase: string;
  characterName: string;
  seconds: number;
  vertical: boolean;
  credits: number;
  outputUrl: string | null;
  projectId: string | null;
  error: string | null;
  createdAt: string;
};

export default function SwapStudio() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [maxSeconds, setMaxSeconds] = useState(15);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [clip, setClip] = useState<{ path: string; preview: string; seconds: number; credits: number; vertical: boolean } | null>(null);
  const [prompt, setPrompt] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState<"" | "upload" | "start">("");
  const [error, setError] = useState("");
  // Jobs seen running on this page; when one finishes it plays right here.
  const seenRunning = useRef<Set<string>>(new Set());
  const [finished, setFinished] = useState<{ title: string; url: string; projectId: string | null; vertical: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/swap").then((r) => r.json()).catch(() => null);
    if (d?.success) {
      setAllowed(Boolean(d.allowed));
      setMaxSeconds(d.maxSeconds ?? 15);
      setSwaps(d.swaps ?? []);
      for (const x of (d.swaps ?? []) as Array<{ id: string; status: string; outputUrl: string | null; projectId: string | null; vertical: boolean } & Record<string, unknown>>) {
        if (x.status === "running") seenRunning.current.add(x.id);
        else if (seenRunning.current.has(x.id)) {
          seenRunning.current.delete(x.id);
          if (x.status === "completed" && x.outputUrl) {
            setFinished({ title: String(`${(x as Record<string, unknown>).characterName} (character swap)`), url: x.outputUrl, projectId: x.projectId, vertical: x.vertical });
          }
        }
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => setCharacters(d?.characters ?? []))
      .catch(() => undefined);
    return () => clearTimeout(t);
  }, [load]);

  // Running swaps: ask about each one (that also moves it along).
  const running = swaps.filter((s) => s.status === "running").map((s) => s.id).join(",");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      for (const id of running.split(",")) await fetch(`/api/swap?id=${id}`).catch(() => undefined);
      await load();
    }, 20000);
    return () => clearInterval(t);
  }, [running, load]);

  async function post(body: Record<string, unknown>) {
    const d = await fetch("/api/swap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (!d.success) throw new Error(d.error || "Something went wrong.");
    return d;
  }

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    setClip(null);
    try {
      const type = file.type || (file.name.toLowerCase().endsWith(".mov") ? "video/quicktime" : "video/mp4");
      const prep = await post({ action: "uploadUrl", type, size: file.size });
      const { supabase } = await import("@/app/lib/supabase");
      const { error: upErr } = await supabase.storage.from("videos").uploadToSignedUrl(prep.path, prep.token, file, { contentType: type });
      if (upErr) throw new Error("The upload failed. Please try again.");
      const q = await post({ action: "quote", path: prep.path });
      setClip({ path: prep.path, preview: URL.createObjectURL(file), seconds: q.seconds, credits: q.credits, vertical: q.vertical });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!clip || !characterId) return;
    setBusy("start");
    setError("");
    try {
      await post({ action: "start", path: clip.path, characterId, prompt, rights });
      setClip(null);
      setRights(false);
      setPrompt("");
      await load();
      setTimeout(() => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The swap couldn't be started.");
    } finally {
      setBusy("");
    }
  }

  const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";

  return (
        <div className="space-y-5">
      {finished && (
        <FinishedVideo {...finished} onClose={() => setFinished(null)} />
      )}
          {swaps.some((x) => x.status === "running") && (
            <div ref={stageRef} className="scroll-mt-20 space-y-4">
              {swaps
                .filter((x) => x.status === "running")
                .map((x) => (
                  <GenerationStage
                    key={x.id}
                    title={`${x.characterName} swap`}
                    createdAt={x.createdAt}
                    steps={[
                      {
                        id: "swap",
                        label: "Putting your character into the clip",
                        status: x.phase === "render" ? "completed" : "running",
                        startedAt: x.createdAt,
                        expected: Math.max(240, x.seconds * 110),
                        messages: ["Tracking every move in the clip…", "Matching light and expressions…", "This is the slow part, hang tight…"],
                      },
                      {
                        id: "sound",
                        label: "Adding the clip's own sound",
                        status: x.phase === "render" ? "running" : "pending",
                        expected: 60,
                        messages: ["Laying the original sound back on…", "Rendering the final MP4…"],
                      },
                    ]}
                  />
                ))}
            </div>
          )}

          {allowed === false && (
            <div className={card}>
              <p className="text-sm text-gray-300">
                Character swaps are available on any plan or pack.{" "}
                <Link href="/billing" className="text-sky-300 hover:text-white">
                  See plans
                </Link>
              </p>
            </div>
          )}

          {/* While one is being made, only the progress screen shows. */}
          {allowed && !swaps.some((x) => x.status === "running") && (
            <div className={card}>
              <div className="grid gap-6 md:grid-cols-2">
                {/* 1. Clip */}
                <div>
                  <p className="text-sm font-semibold">1. Your clip</p>
                  <p className="mt-1 text-xs text-gray-500">MP4 or MOV, up to {maxSeconds} seconds and 50 MB, one person clearly visible.</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="video/mp4,video/quicktime"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void upload(f);
                    }}
                  />
                  {clip ? (
                    <div className="mt-3">
                      <video src={clip.preview} controls muted playsInline className={`w-full rounded-xl bg-black ${clip.vertical ? "max-h-80 object-contain" : ""}`} />
                      <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 text-xs text-sky-300 hover:text-white">
                        Use another clip
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy !== ""}
                      className="mt-3 flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-sm text-gray-300 transition hover:border-sky-400/50 disabled:opacity-50"
                    >
                      {busy === "upload" ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                      {busy === "upload" ? "Uploading…" : "Choose a clip"}
                    </button>
                  )}
                </div>

                {/* 2. Character */}
                <div>
                  <p className="text-sm font-semibold">2. Who goes in</p>
                  <p className="mt-1 text-xs text-gray-500">You, someone who agreed, a historical figure or an invented character.</p>
                  <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Character">
                    {characters.map((c) => {
                      const on = characterId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setCharacterId(c.id)}
                          className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition ${on ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"}`}
                        >
                          {c.previews[0] ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.previews[0]} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <span className="h-7 w-7 rounded-full bg-white/10" />
                          )}
                          {c.name}
                          {on && <Check size={13} />}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setCreating((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-white/15 px-3 py-1 text-sm text-gray-400 hover:text-white"
                    >
                      <Plus size={14} /> New
                    </button>
                  </div>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-xs text-gray-400">How they should look (optional)</span>
                    <input
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      maxLength={500}
                      placeholder="e.g. as a cartoon cat in a puffer jacket"
                      className="w-full rounded-xl border border-white/10 bg-[var(--nv-field)] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400/50"
                    />
                  </label>
                </div>
              </div>

              {creating && (
                <CharacterCreator
                  className="mt-5"
                  onCreated={(c) => {
                    setCharacters((prev) => [...prev, c]);
                    setCharacterId(c.id);
                    setCreating(false);
                  }}
                />
              )}

              <label className="mt-5 flex items-start gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
                <span>I filmed this clip or have the right to use it, and I won&apos;t use the result to deceive anyone about who did or said something.</span>
              </label>

              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={start}
                  disabled={busy !== "" || !clip || !characterId || !rights}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  {busy === "start" ? <Loader2 size={16} className="animate-spin" /> : <Shuffle size={16} />}
                  {busy === "start" ? "Checking the clip…" : clip ? `Swap · ${clip.credits} credits` : "Swap"}
                </button>
                <span className="text-xs text-gray-500">
                  {clip ? `${clip.seconds} s clip · ` : ""}takes about 10–15 minutes · the clip&apos;s own sound is kept
                </span>
              </div>
              {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
            </div>
          )}

          {!swaps.some((x) => x.status === "running") && swaps.length > 0 && (
            <div className={card}>
              <p className="text-sm font-semibold">Your swaps</p>
              <ul className="mt-3 space-y-2">
                {swaps.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[var(--nv-panel)] px-4 py-3 text-sm">
                    <Film size={15} className="text-gray-500" />
                    <span className="font-medium">{s.characterName}</span>
                    <span className="text-xs text-gray-500">
                      {Math.round(s.seconds)} s · {new Date(s.createdAt).toLocaleString("en-US")}
                    </span>
                    <span className="ml-auto">
                      {s.status === "running" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-sky-300">
                          <Loader2 size={13} className="animate-spin" /> {s.phase === "render" ? "Adding the sound…" : "Swapping…"}
                        </span>
                      ) : s.status === "completed" && s.projectId ? (
                        <Link href={`/projects/${s.projectId}`} className="text-xs font-semibold text-sky-300 hover:text-white">
                          Open video
                        </Link>
                      ) : (
                        <span className="text-xs text-red-300">{friendlyErrorLine(s.error)} · refunded</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
  );
}
