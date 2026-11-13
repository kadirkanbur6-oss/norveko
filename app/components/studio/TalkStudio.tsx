"use client";
import { friendlyErrorLine } from "@/lib/user-error";

// Talking character studio (used on /talk and in the AI Workspace): pick a character, give them a line (typed or your own
// recording), say where they are — get a lip-synced video. Like Hedra-style
// tools and the viral talking-animal / historical-figure clips.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Loader2, MessageCircle, Mic, Plus, Upload, Volume2 } from "lucide-react";
import { CharacterCreator, type CharacterItem } from "../CharactersCard";
import FinishedVideo from "./FinishedVideo";
import GenerationStage from "../GenerationStage";

type Talk = {
  id: string;
  status: "running" | "completed" | "failed";
  characterName: string;
  script: string | null;
  seconds: number;
  vertical: boolean;
  credits: number;
  imageUrl: string | null;
  outputUrl: string | null;
  projectId: string | null;
  error: string | null;
  createdAt: string;
};
type Voice = { id: string; name: string; style: string };
type Audio = { path: string; url: string; seconds: number; credits: number; forText?: string; forVoice?: string };

const field =
  "w-full rounded-xl border border-white/10 bg-[var(--nv-field)] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400/50";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1 text-xs transition ${on ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"}`;

/** `text` (from the AI Workspace box) replaces the studio's own line box. */
export default function TalkStudio({ text: outerText, onStarted }: { text?: string; onStarted?: () => void } = {}) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState({ maxSeconds: 30, maxChars: 450 });
  const [looks, setLooks] = useState<Array<{ id: string; label: string }>>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [talks, setTalks] = useState<Talk[]>([]);
  const [characters, setCharacters] = useState<CharacterItem[]>([]);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<"type" | "upload">("type");
  const [ownText, setText] = useState("");
  const embedded = outerText !== undefined;
  const text = embedded ? outerText : ownText;
  const [voiceId, setVoiceId] = useState("");
  const [audio, setAudio] = useState<Audio | null>(null);
  const [scene, setScene] = useState("");
  const [look, setLook] = useState("cinematic");
  const [vertical, setVertical] = useState(true);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState<"" | "voice" | "upload" | "start">("");
  const [error, setError] = useState("");
  // Jobs seen running on this page; when one finishes it plays right here.
  const seenRunning = useRef<Set<string>>(new Set());
  const [finished, setFinished] = useState<{ title: string; url: string; projectId: string | null; vertical: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/talk").then((r) => r.json()).catch(() => null);
    if (!d?.success) return;
    setAllowed(Boolean(d.allowed));
    setCfg({ maxSeconds: d.maxSeconds ?? 30, maxChars: d.maxChars ?? 450 });
    setLooks(d.looks ?? []);
    setVoices(d.voices ?? []);
    setVoiceId((v) => v || d.voices?.[0]?.id || "");
    setTalks(d.talks ?? []);
      for (const x of (d.talks ?? []) as Array<{ id: string; status: string; outputUrl: string | null; projectId: string | null; vertical: boolean } & Record<string, unknown>>) {
        if (x.status === "running") seenRunning.current.add(x.id);
        else if (seenRunning.current.has(x.id)) {
          seenRunning.current.delete(x.id);
          if (x.status === "completed" && x.outputUrl) {
            setFinished({ title: String(`${(x as Record<string, unknown>).characterName} talks`), url: x.outputUrl, projectId: x.projectId, vertical: x.vertical });
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

  const running = talks.filter((s) => s.status === "running").map((s) => s.id).join(",");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      for (const id of running.split(",")) await fetch(`/api/talk?id=${id}`).catch(() => undefined);
      await load();
    }, 15000);
    return () => clearInterval(t);
  }, [running, load]);

  async function post(body: Record<string, unknown>) {
    const d = await fetch("/api/talk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (!d.success) throw new Error(d.error || "Something went wrong.");
    return d;
  }

  const typedAudioFresh = audio && audio.forText === text.trim() && audio.forVoice === voiceId;
  const currentAudio = mode === "type" ? (typedAudioFresh ? audio : null) : audio && !audio.forText ? audio : null;

  async function makeVoice(): Promise<Audio | null> {
    setBusy("voice");
    setError("");
    try {
      const d = await post({ action: "voice", text: text.trim(), voiceId });
      const a = { path: d.path, url: d.url, seconds: d.seconds, credits: d.credits, forText: text.trim(), forVoice: voiceId };
      setAudio(a);
      return a;
    } catch (err) {
      setError(err instanceof Error ? err.message : "The voice couldn't be made.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    setAudio(null);
    try {
      const prep = await post({ action: "uploadUrl", type: file.type, size: file.size });
      const { supabase } = await import("@/app/lib/supabase");
      const { error: upErr } = await supabase.storage.from("videos").uploadToSignedUrl(prep.path, prep.token, file, { contentType: prep.contentType });
      if (upErr) throw new Error("The upload failed. Please try again.");
      const q = await post({ action: "quote", path: prep.path });
      setAudio({ path: prep.path, url: q.url, seconds: q.seconds, credits: q.credits });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!characterId) return;
    let a = currentAudio;
    if (!a && mode === "type") a = await makeVoice();
    if (!a) return;
    setBusy("start");
    setError("");
    try {
      await post({
        action: "start",
        path: a.path,
        characterId,
        scene,
        look,
        orientation: vertical ? "vertical" : "horizontal",
        script: mode === "type" ? text.trim() : "",
        voiceId: mode === "type" ? voiceId : "",
        rights,
      });
      onStarted?.();
      if (!embedded) setText("");
      setAudio(null);
      setRights(false);
      await load();
      setTimeout(() => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "It couldn't be started.");
    } finally {
      setBusy("");
    }
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estSeconds = Math.max(1, Math.round(words / 2.3));
  const priceLabel = currentAudio ? `${currentAudio.credits} credits` : null;
  const ready = Boolean(characterId) && rights && (mode === "type" ? text.trim().length > 1 && voiceId : Boolean(currentAudio));
  const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";

  return (
        <div className="space-y-5">
      {finished && (
        <FinishedVideo {...finished} onClose={() => setFinished(null)} />
      )}
          {talks.some((t) => t.status === "running") && (
            <div ref={stageRef} className="scroll-mt-20 space-y-4">
              {talks
                .filter((t) => t.status === "running")
                .map((t) => (
                  <GenerationStage
                    key={t.id}
                    title={t.characterName}
                    createdAt={t.createdAt}
                    steps={[
                      { id: "scene", label: "Setting the scene", status: "completed", expected: 25 },
                      {
                        id: "lips",
                        label: "Syncing the lips to the voice",
                        status: "running",
                        startedAt: t.createdAt,
                        expected: 150,
                        messages: ["Matching every word to the mouth…", "Adding head movement and expressions…", "Rendering the talking video…"],
                      },
                      { id: "save", label: "Saving your video", status: "pending", expected: 15 },
                    ]}
                  >
                    {t.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.imageUrl} alt="" className="mt-4 h-28 rounded-lg object-cover" />
                    )}
                  </GenerationStage>
                ))}
            </div>
          )}

          {allowed === false && (
            <div className={card}>
              <p className="text-sm text-gray-300">
                Talking characters are available on any plan or pack.{" "}
                <Link href="/billing" className="text-sky-300 hover:text-white">
                  See plans
                </Link>
              </p>
            </div>
          )}

          {/* While one is being made, only the progress screen shows. */}
          {allowed && !talks.some((x) => x.status === "running") && (
            <div className={`${card} space-y-6`}>
              {/* Who */}
              <section>
                <p className="text-sm font-semibold">Who talks</p>
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
                    <Plus size={14} /> New character
                  </button>
                </div>
                {creating && (
                  <CharacterCreator
                    className="mt-4"
                    initialKind="fictional"
                    onCreated={(c) => {
                      setCharacters((prev) => [...prev, c]);
                      setCharacterId(c.id);
                      setCreating(false);
                    }}
                  />
                )}
              </section>

              {/* What */}
              <section>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-semibold">What they say</p>
                  <div className="flex gap-1.5" role="tablist">
                    <button type="button" role="tab" aria-selected={mode === "type"} onClick={() => setMode("type")} className={chip(mode === "type")}>
                      Type it
                    </button>
                    <button type="button" role="tab" aria-selected={mode === "upload"} onClick={() => setMode("upload")} className={chip(mode === "upload")}>
                      Upload a recording
                    </button>
                  </div>
                </div>

                {mode === "type" ? (
                  <div className="mt-3 space-y-3">
                    {embedded ? (
                      <p className="rounded-xl border border-white/10 bg-[var(--nv-field)] px-3 py-2 text-sm text-gray-300">{text.trim() || "Write the line in the box above."}</p>
                    ) : (
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={cfg.maxChars}
                      rows={3}
                      placeholder="Ladies and gentlemen, I am the best coach in this barn. Nobody pecks like me."
                      className={field}
                    />
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="Voice" className={`${field} w-auto`}>
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} · {v.style}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void makeVoice()}
                        disabled={busy !== "" || text.trim().length < 2 || !voiceId}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-sm text-gray-200 hover:border-white/25 disabled:opacity-40"
                      >
                        {busy === "voice" ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />} Hear it
                      </button>
                      <span className="text-xs text-gray-500">
                        {text.length}/{cfg.maxChars} · ≈ {estSeconds} s
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void upload(f);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={busy !== ""}
                      className="inline-flex items-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-3 text-sm text-gray-300 hover:border-sky-400/50 disabled:opacity-50"
                    >
                      {busy === "upload" ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                      {currentAudio ? "Use another recording" : "Choose a recording"}
                    </button>
                    <p className="mt-2 text-xs text-gray-500">MP3, WAV or M4A, up to {cfg.maxSeconds} seconds. The character says it with this exact voice.</p>
                  </div>
                )}
                {currentAudio && (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <audio src={currentAudio.url} controls className="h-9 max-w-full" />
                    <span className="text-xs text-gray-500">{currentAudio.seconds} s</span>
                  </div>
                )}
              </section>

              {/* Where */}
              <section>
                <p className="text-sm font-semibold">Where they are</p>
                <input
                  value={scene}
                  onChange={(e) => setScene(e.target.value)}
                  maxLength={300}
                  placeholder="e.g. at a football press conference, lots of microphones on the table"
                  className={`${field} mt-3`}
                />
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {looks.map((l) => (
                      <button key={l.id} type="button" onClick={() => setLook(l.id)} aria-pressed={look === l.id} className={chip(look === l.id)}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <span className="hidden h-4 w-px bg-white/10 sm:block" aria-hidden />
                  <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setVertical(true)} aria-pressed={vertical} className={chip(vertical)}>
                    Vertical 9:16
                  </button>
                  <button type="button" onClick={() => setVertical(false)} aria-pressed={!vertical} className={chip(!vertical)}>
                    Horizontal 16:9
                  </button>
                  </div>
                </div>
              </section>

              <label className="flex items-start gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
                <span>Any recording I upload is my own voice, and I won&apos;t present the result as something a real person actually said or did.</span>
              </label>

              <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
                <button
                  type="button"
                  onClick={start}
                  disabled={busy !== "" || !ready}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
                >
                  {busy === "start" || busy === "voice" ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
                  {busy === "start" ? "Setting the scene…" : priceLabel ? `Make it talk · ${priceLabel}` : "Make it talk"}
                </button>
                <span className="text-xs text-gray-500">
                  {priceLabel ? "" : "Price shows once the voice is ready · "}about 2–5 minutes
                </span>
              </div>
              {error && <p className="text-sm text-red-300">{error}</p>}
            </div>
          )}

          {!talks.some((x) => x.status === "running") && talks.length > 0 && (
            <div className={card}>
              <p className="text-sm font-semibold">Your talking videos</p>
              <ul className="mt-3 space-y-2">
                {talks.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[var(--nv-panel)] px-3 py-2.5 text-sm">
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <Mic size={16} className="text-gray-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{s.characterName}</p>
                      <p className="truncate text-xs text-gray-500">{s.script || `${Math.round(s.seconds)} s recording`}</p>
                    </div>
                    <span className="shrink-0">
                      {s.status === "running" ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-sky-300">
                          <Loader2 size={13} className="animate-spin" /> Talking…
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
