"use client";

// Settings: the creator's own cloned voice (ElevenLabs Instant Voice Clone).
// Record in the browser (reading a short script) or upload audio files.

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square, Trash2, Upload } from "lucide-react";

interface Clone {
  voiceId: string;
  name: string;
  createdAt: string;
}

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 3;

export default function VoiceCloneCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [clone, setClone] = useState<Clone | null>(null);
  const [script, setScript] = useState("");
  const [name, setName] = useState("My voice");
  const [files, setFiles] = useState<File[]>([]);
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState<"" | "create" | "delete">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/voices/clone")
      .then((r) => r.json())
      .then((d) => {
        setAvailable(Boolean(d.available) || Boolean(d.clone));
        setClone(d.clone ?? null);
        setScript(d.readingScript ?? "");
      })
      .catch(() => setAvailable(false));
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  if (available === null || (!available && !clone)) return null;

  const totalBytes = files.reduce((n, f) => n + f.size, 0);

  async function startRecording() {
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 96_000 } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        const ext = (rec.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm";
        setFiles((prev) => [...prev, new File([blob], `recording-${prev.length + 1}.${ext}`, { type: blob.type })].slice(-MAX_FILES));
      };
      rec.start(1000);
      recorder.current = rec;
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= 120) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch {
      setMessage({ ok: false, text: "Couldn't use your microphone. Allow microphone access, or upload a recording instead." });
    }
  }

  function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false);
  }

  async function create() {
    setBusy("create");
    setMessage(null);
    try {
      const form = new FormData();
      form.append("name", name);
      form.append("consent", consent ? "true" : "false");
      files.forEach((f) => form.append("files", f, f.name));
      const d = await fetch("/api/voices/clone", { method: "POST", body: form }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Creating your voice failed.");
      setClone(d.clone);
      setFiles([]);
      setConsent(false);
      setMessage({ ok: true, text: "Your voice is ready. Pick “Your voice” in the AI Workspace voice list." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Creating your voice failed." });
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setBusy("delete");
    await fetch("/api/voices/clone", { method: "DELETE" }).catch(() => null);
    setClone(null);
    setBusy("");
    setMessage({ ok: true, text: "Your cloned voice was deleted." });
  }

  const canCreate = files.length > 0 && consent && totalBytes <= MAX_BYTES && !recording && busy === "";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <Mic size={18} className="text-emerald-300" aria-hidden />
        <h2 className="font-semibold">Your voice</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        Narrate videos in your own voice. Record about a minute (or upload clean recordings) and we&apos;ll create a private voice only you can use. Priced like other premium voices.
      </p>

      {clone && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0d0d16] p-4">
          <div>
            <p className="text-sm font-semibold">{clone.name}</p>
            <p className="text-xs text-gray-500">Created {new Date(clone.createdAt).toLocaleDateString()}</p>
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={busy !== ""}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:border-red-400/30 hover:text-red-300 disabled:opacity-50"
          >
            {busy === "delete" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Trash2 size={15} aria-hidden />}
            Delete voice
          </button>
        </div>
      )}

      {available && (
        <div className="mt-5 space-y-4">
          {clone && <p className="text-xs text-gray-500">Creating a new one replaces your current voice.</p>}
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-gray-500">Read this aloud</p>
            <p className="rounded-xl border border-white/10 bg-[#0d0d16] p-4 text-sm leading-relaxed text-gray-200">{script}</p>
            <p className="mt-1 text-xs text-gray-500">Any language works. Quiet room, normal narration pace, no music.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {!recording ? (
              <button
                type="button"
                onClick={startRecording}
                disabled={busy !== "" || files.length >= MAX_FILES}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
              >
                <Mic size={15} aria-hidden /> Record
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
              >
                <Square size={13} aria-hidden /> Stop · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                setFiles((prev) => [...prev, ...picked].slice(0, MAX_FILES));
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={recording || busy !== "" || files.length >= MAX_FILES}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-200 transition hover:border-emerald-400/40 disabled:opacity-50"
            >
              <Upload size={15} aria-hidden /> Upload audio
            </button>
          </div>

          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#0d0d16] p-2 text-xs text-gray-300">
                  <audio src={URL.createObjectURL(f)} controls className="h-8 max-w-[220px]" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-gray-500">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove ${f.name}`}
                    className="ml-auto text-gray-500 hover:text-red-300"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
              {totalBytes > MAX_BYTES && <li className="text-xs text-red-300">Recordings must be under 4 MB in total.</li>}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-start">
            <div>
              <label htmlFor="clone-name" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Voice name</label>
              <input
                id="clone-name"
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#12121c] p-2.5 text-sm text-white outline-none focus:border-emerald-400/50"
              />
            </div>
            <label className="flex items-start gap-2 pt-5 text-xs text-gray-300">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-500" />
              <span>
                This is my own voice, or I have the speaker&apos;s permission to clone it. I won&apos;t use it to impersonate anyone or mislead people.
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={create}
            disabled={!canCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy === "create" && <Loader2 size={15} className="animate-spin" aria-hidden />}
            {busy === "create" ? "Creating your voice…" : clone ? "Replace my voice" : "Create my voice"}
          </button>
        </div>
      )}

      {message && (
        <p
          className={`mt-4 rounded-xl border p-3 text-sm ${
            message.ok ? "border-green-400/30 bg-green-500/10 text-green-300" : "border-red-400/30 bg-red-500/10 text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
