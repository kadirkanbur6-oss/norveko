"use client";
import { friendlyErrorLine } from "@/lib/user-error";

// Ambient music video: describe the music + scene, pick a length, get a long MP4
// (AI songs on a loop over one picture). No re-render: a new one is a new video.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Music } from "lucide-react";
import FinishedVideo from "./FinishedVideo";
import GenerationStage from "../GenerationStage";

type Video = {
  id: string;
  status: "running" | "completed" | "failed";
  prompt: string | null;
  minutes: number;
  songs: number;
  songsNeeded: number;
  parts: number;
  phase: string;
  credits: number;
  outputUrl: string | null;
  projectId: string | null;
  error: string | null;
  createdAt: string;
};

function label(m: number) {
  return m >= 60 ? `${m / 60} hour${m > 60 ? "s" : ""}` : `${m} minutes`;
}

export default function AmbientStudio({ text, onStarted }: { text: string; onStarted: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [options, setOptions] = useState<Array<{ minutes: number; credits: number }>>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seenRunning = useRef<Set<string>>(new Set());
  const [finished, setFinished] = useState<{ title: string; url: string; projectId: string | null; vertical: boolean } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/ambient").then((r) => r.json()).catch(() => null);
    if (!d?.success) return;
    setAllowed(Boolean(d.allowed));
    setOptions(d.options ?? []);
    setVideos(d.videos ?? []);
    for (const x of (d.videos ?? []) as Video[]) {
      if (x.status === "running") seenRunning.current.add(x.id);
      else if (seenRunning.current.has(x.id)) {
        seenRunning.current.delete(x.id);
        if (x.status === "completed" && x.outputUrl) {
          setFinished({ title: x.prompt?.slice(0, 60) || "Ambient music video", url: x.outputUrl, projectId: x.projectId, vertical: false });
        }
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const running = videos.filter((v) => v.status === "running").map((v) => v.id).join(",");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      for (const id of running.split(",")) await fetch(`/api/ambient?id=${id}`).catch(() => undefined);
      await load();
    }, 12000);
    return () => clearInterval(t);
  }, [running, load]);

  async function start() {
    setBusy(true);
    setError("");
    try {
      const d = await fetch("/api/ambient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", idea: text, minutes }),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Something went wrong.");
      onStarted();
      await load();
      setTimeout(() => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "It couldn't be started.");
    } finally {
      setBusy(false);
    }
  }

  const price = options.find((o) => o.minutes === minutes)?.credits;
  const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";
  const anyRunning = videos.some((v) => v.status === "running");
  const failed = videos.find((v) => v.status === "failed");

  return (
    <div className="space-y-5">
      {finished && <FinishedVideo {...finished} onClose={() => setFinished(null)} />}

      {anyRunning && (
        <div ref={stageRef} className="scroll-mt-20 space-y-4">
          {videos
            .filter((v) => v.status === "running")
            .map((v) => (
              <GenerationStage
                key={v.id}
                title="Ambient music video"
                createdAt={v.createdAt}
                steps={[
                  {
                    id: "music",
                    label: `Composing the music (${Math.min(v.songs, v.songsNeeded)}/${v.songsNeeded} songs)`,
                    status: v.phase === "swap" ? "running" : "completed",
                    startedAt: v.createdAt,
                    expected: 240,
                    messages: ["Writing the melodies…", "Layering the sounds…", "Painting the scene…"],
                  },
                  {
                    id: "video",
                    label: "Putting the video together",
                    status: v.phase === "render" ? "running" : "pending",
                    expected: Math.max(60, v.minutes * 3),
                    messages: ["Mixing the songs into one long track…", "Encoding the video…"],
                  },
                ]}
              />
            ))}
          <p className="text-xs text-gray-500">You can leave this page: the video keeps being made and appears in Projects.</p>
        </div>
      )}

      {allowed === false && (
        <div className={card}>
          <p className="text-sm text-gray-300">
            Ambient music videos are available once you have bought a plan or pack.{" "}
            <Link href="/billing" className="text-sky-300 hover:text-white">
              See plans
            </Link>
          </p>
        </div>
      )}

      {allowed && !anyRunning && (
        <div className={card}>
          <p className="text-sm font-semibold">How long?</p>
          <p className="mt-1 text-xs text-gray-500">Describe the music and the scene in the box above. We compose several calm songs and play them in a loop over one picture.</p>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Length">
            {options.map((o) => (
              <button
                key={o.minutes}
                type="button"
                role="radio"
                aria-checked={minutes === o.minutes}
                onClick={() => setMinutes(o.minutes)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${minutes === o.minutes ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"}`}
              >
                {label(o.minutes)} · {o.credits} credits
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            16:9 video with instrumental music only. Changes aren&apos;t possible afterwards, so write the idea first; a new idea is a new video. Videos are labelled as AI-made music in the description.
          </p>
          {failed?.error && <p className="mt-3 text-xs text-amber-300">Last try: {friendlyErrorLine(failed.error)}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={start}
              disabled={busy || text.trim().length < 5}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Music size={16} />}
              {price ? `Make video · ${price} credits` : "Make video"}
            </button>
            <span className="text-xs text-gray-500">takes about {minutes >= 60 ? "10–20" : "5–10"} minutes</span>
          </div>
        </div>
      )}
    </div>
  );
}
