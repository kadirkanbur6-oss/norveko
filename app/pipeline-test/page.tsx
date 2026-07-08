// app/pipeline-test/page.tsx
// Faz A test sayfası: yeni AI pipeline'ı uçtan uca dener.
// /chat'e dokunmadan pipeline'ı doğrulamak için — ileride birleştirilecek.

"use client";

import { useState } from "react";
import { Loader2, Sparkles, FlaskConical } from "lucide-react";
import Sidebar from "../components/Sidebar";
import PipelineProgress from "../components/PipelineProgress";

const PLATFORMS = ["YouTube Shorts", "TikTok", "Instagram Reels", "YouTube Long-form"];
const STYLES = ["Mystery", "Documentary", "Horror", "Educational", "Ad / Promo", "Cinematic"];
const DURATIONS = ["30 seconds", "60 seconds", "3 minutes", "8 minutes"];
const LANGUAGES = ["English", "Türkçe", "Español", "Deutsch", "Français", "Português"];

export default function PipelineTestPage() {
  const [idea, setIdea] = useState("");
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [style, setStyle] = useState(STYLES[0]);
  const [duration, setDuration] = useState(DURATIONS[1]);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  async function handleGenerate() {
    if (idea.trim().length < 5) {
      setError("Please describe your video idea in a bit more detail.");
      return;
    }

    setStarting(true);
    setError("");
    setJobId(null);

    try {
      const res = await fetch("/api/pipeline/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea,
          platform,
          style,
          duration,
          outputLanguage: language,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Pipeline could not start.");
      }

      setJobId(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setStarting(false);
    }
  }

  const selectClass =
    "mt-2 w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-white outline-none focus:border-blue-400/50";

  return (
    <div className="flex min-h-screen bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="flex-1 p-8">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-400/30 bg-purple-500/10">
              <FlaskConical className="text-purple-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Pipeline Test</h1>
              <p className="text-sm text-gray-400">
                Internal test page for the new AI pipeline (script + thumbnail)
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <label className="text-sm text-gray-400">Video Idea</label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. The mystery of planes lost in the Bermuda Triangle..."
              rows={3}
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white placeholder-gray-500 outline-none focus:border-blue-400/50"
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm text-gray-400">Platform</label>
                <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={selectClass}>
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Style</label>
                <select value={style} onChange={(e) => setStyle(e.target.value)} className={selectClass}>
                  {STYLES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Duration</label>
                <select value={duration} onChange={(e) => setDuration(e.target.value)} className={selectClass}>
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Output Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className={selectClass}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={starting || (jobId !== null && !error)}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-blue-600 py-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {starting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Starting pipeline...
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Generate (Pipeline)
                </>
              )}
            </button>

            {error && (
              <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>

          {/* Progress + results */}
          {jobId && <PipelineProgress jobId={jobId} />}

          {jobId && (
            <button
              onClick={() => {
                setJobId(null);
                setIdea("");
              }}
              className="mt-4 text-sm text-gray-500 transition hover:text-white"
            >
              Start a new generation
            </button>
          )}
        </div>
      </main>
    </div>
  );
}