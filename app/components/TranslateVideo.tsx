"use client";

// Project page → Publish: make this video in another language in one click.
// The pictures, clips and thumbnail are reused; the script is translated and
// a new voice-over + subtitles are made, then it renders as a new project.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Languages, Loader2 } from "lucide-react";
import { LANGUAGE_OPTIONS } from "@/lib/pipeline/options";

type Translation = { jobId: string; status: string; language: string | null; projectId: string | null };
type Voice = { voice_id: string; name: string; source: string };

export default function TranslateVideo({ projectId }: { projectId: string }) {
  const [info, setInfo] = useState<{
    available: boolean;
    from: string;
    prices: { gemini: number; elevenlabs: number };
    translations: Translation[];
  } | null>(null);
  const [language, setLanguage] = useState("");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const d = await fetch(`/api/projects/${projectId}/translate`).then((r) => r.json()).catch(() => null);
    if (d?.success && d.prices) setInfo(d);
  }, [projectId]);

  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  // Voices for the chosen language: the narrators (every language) + your own voice.
  useEffect(() => {
    if (!language) return;
    let cancelled = false;
    fetch(`/api/voices?language=${encodeURIComponent(language)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled || !d?.success) return;
        const list: Voice[] = [...(d.mine ?? []), ...(d.gemini ?? [])];
        setVoices(list);
        setVoiceId((current) => (list.some((v) => v.voice_id === current) ? current : list.find((v) => v.source === "gemini")?.voice_id ?? ""));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Refresh while a translation is being made.
  const running = info?.translations.some((t) => t.status === "running");
  useEffect(() => {
    if (!running) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [running, load]);

  if (!info || (!info.available && !info.translations.length)) return null;

  const engine = voices.find((v) => v.voice_id === voiceId)?.source === "clone" ? "elevenlabs" : "gemini";
  const price = info.prices[engine];
  const label = (code: string | null) => {
    const o = LANGUAGE_OPTIONS.find((l) => l.label === code);
    return o ? `${o.flag} ${o.english}` : code ?? "";
  };

  async function start() {
    setBusy(true);
    setError("");
    try {
      const d = await fetch(`/api/projects/${projectId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, voiceId }),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Could not start the translation.");
      setLanguage("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the translation.");
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-xl border border-white/10 bg-[var(--nv-field)] px-3 py-2 text-sm text-white outline-none focus:border-sky-400/50";

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Languages size={17} className="text-sky-300" aria-hidden />
        <h3 className="text-sm font-semibold text-white">Make it in another language</h3>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        Same scenes and clips: translated narration, a new voice, subtitles and cover. Saved as a new project.
      </p>

      {info.translations.length > 0 && (
        <ul className="mt-4 space-y-2">
          {info.translations.map((t) => (
            <li key={t.jobId} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[var(--nv-panel)] px-3 py-2 text-sm">
              <span className="text-gray-200">{label(t.language)}</span>
              {t.status === "running" ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-sky-300">
                  <Loader2 size={13} className="animate-spin" /> Being made…
                </span>
              ) : t.projectId && t.status === "completed" ? (
                <Link href={`/projects/${t.projectId}`} className="text-xs font-semibold text-sky-300 hover:text-white">
                  Open video
                </Link>
              ) : (
                <span className="text-xs text-red-300">Failed, credits refunded</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {info.available && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-gray-400">Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className={field}>
              <option value="">Choose…</option>
              {LANGUAGE_OPTIONS.filter((l) => l.label !== info.from).map((l) => (
                <option key={l.label} value={l.label}>
                  {l.flag} {l.english}
                </option>
              ))}
            </select>
          </label>
          {language && (
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">Voice</span>
              <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className={field}>
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={start}
            disabled={busy || !language || !voiceId || running}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Languages size={15} />}
            Translate · {price} credits
          </button>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
