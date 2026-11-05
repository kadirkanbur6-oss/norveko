"use client";

// Landing hero: one idea → the steps Norveko runs → a finished video. The end
// card is a real render from the showcase (lib/showcase.ts), not a mock-up.

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { SHOWCASE_VIDEOS, showcaseThumbnailUrl } from "@/lib/showcase";

const video = SHOWCASE_VIDEOS[0];
const thumb = video ? showcaseThumbnailUrl(video) : null;

const tasks = ["Researching the facts", "Writing the script", "Recording the voiceover", "Making the visuals", "Adding music & subtitles", "Rendering the MP4"];
const DONE = tasks.length + 1;

export default function HeroDemo() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    let timers: ReturnType<typeof setTimeout>[] = [];
    const runCycle = () => {
      setStep(0);
      timers = [
        ...tasks.map((_, i) => setTimeout(() => setStep(i + 1), 1100 + i * 700)),
        setTimeout(() => setStep(DONE), 1100 + tasks.length * 700 + 300),
        setTimeout(runCycle, 1100 + tasks.length * 700 + 4800),
      ];
    };
    runCycle();
    return () => timers.forEach(clearTimeout);
  }, []);

  const isGenerating = step > 0 && step < DONE;
  const isDone = step === DONE;
  const pct = Math.round((Math.min(step, tasks.length) / tasks.length) * 100);

  return (
    <div className="relative min-h-[480px] w-full min-w-0 max-w-[560px] overflow-hidden rounded-3xl border border-white/15 bg-[#181527]/55 p-4 shadow-2xl backdrop-blur-md sm:h-[560px] sm:p-6">
      <div className="mb-6 flex items-center gap-2">
        <div className="h-3 w-3 rounded-full bg-red-400" />
        <div className="h-3 w-3 rounded-full bg-yellow-400" />
        <div className="h-3 w-3 rounded-full bg-green-400" />
        <span className="ml-4 text-xs text-zinc-500">norveko.app/chat</span>
      </div>

      <div className="min-w-0 rounded-2xl bg-black/30 p-5">
        <p className="mb-2 text-sm text-zinc-400">What do you want to make?</p>
        <p className="break-words text-lg font-medium text-white">{video?.idea ?? "Why did nine hikers die at Dyatlov Pass?"}</p>
      </div>

      {step === 0 && (
        <button type="button" tabIndex={-1} aria-hidden className="mt-5 w-full rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 py-3 font-semibold text-white">
          Make the video
        </button>
      )}

      {isGenerating && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Making your video…</p>
            <p className="text-xs text-blue-300">{pct}%</p>
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="space-y-2">
            {tasks.map((task, i) => {
              const done = step > i + 1;
              const now = step === i + 1;
              return (
                <div key={task} className="flex items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-sm">
                  <span className={done || now ? "text-white" : "text-zinc-500"}>{task}</span>
                  <span className={done ? "text-green-300" : now ? "text-blue-300" : "text-zinc-600"}>{done ? "✓" : now ? "…" : "○"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isDone && (
        <a href="#examples" className="mt-5 flex gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-white/20">
          <span className="relative aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-xl bg-black/40 sm:w-36">
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white">
                <Play size={18} className="ml-0.5" />
              </span>
            </span>
          </span>
          <span className="flex min-w-0 flex-col justify-center gap-2">
            <span className="text-sm font-semibold text-white">{video?.title ?? "Your video"}</span>
            <span className="text-xs text-gray-400">
              {video ? `${video.seconds} s · ${video.orientation === "vertical" ? "9:16" : "16:9"} MP4` : "MP4"} · narration, visuals, music and subtitles
            </span>
            <span className="text-xs text-green-300">✓ Ready to publish · watch real examples</span>
          </span>
        </a>
      )}
    </div>
  );
}
