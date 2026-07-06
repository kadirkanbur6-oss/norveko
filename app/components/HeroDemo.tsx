"use client";

import { useEffect, useState } from "react";

const demo = {
  idea: "The Man Who Never Tried to Escape Pompeii",
  hook: "When Vesuvius erupted, everyone ran. Except one man.",
  script: "In AD 79, Pompeii vanished under ash. But one discovery still raises a chilling question.",
  scene: "A lone Roman man sitting still as ash clouds swallow the city...",
  thumbnail: "Ancient Pompeii street, erupting volcano, lone man, cinematic lighting",
  seo: "The Man Who Never Tried to Escape Pompeii",
};

const tasks = ["Hook", "Script", "Scene Plan", "Thumbnail", "SEO"];

export default function HeroDemo() {
  const [step, setStep] = useState(0);

 useEffect(() => {
  let timers: ReturnType<typeof setTimeout>[] = [];

  const runCycle = () => {
    setStep(0);

    timers = [
      setTimeout(() => setStep(1), 1200),
      setTimeout(() => setStep(2), 1900),
      setTimeout(() => setStep(3), 2600),
      setTimeout(() => setStep(4), 3300),
      setTimeout(() => setStep(5), 4000),
      setTimeout(() => setStep(6), 5000),
      setTimeout(runCycle, 8200),
    ];
  };

  runCycle();

  return () => {
    timers.forEach(clearTimeout);
  };
}, []);

  const isGenerating = step > 0 && step < 6;
  const isDone = step === 6;

  return (
    <div className="relative h-[560px] w-full max-w-[560px] rounded-3xl border border-white/10 bg-[#181527] p-6 shadow-2xl">
      <div className="mb-6 flex items-center gap-2">
        <div className="h-3 w-3 rounded-full bg-red-400" />
        <div className="h-3 w-3 rounded-full bg-yellow-400" />
        <div className="h-3 w-3 rounded-full bg-green-400" />
        <span className="ml-4 text-xs text-zinc-500">norveko.app/chat</span>
      </div>

      <div className="rounded-2xl bg-black/30 p-5">
        <p className="mb-2 text-sm text-zinc-400">Your idea</p>
        <p className="text-lg font-medium text-white">{demo.idea}</p>
      </div>

      {step === 0 && (
        <button className="mt-5 w-full rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 py-3 font-semibold text-white">
          Generate Package
        </button>
      )}

      {isGenerating && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Generating package...</p>
            <p className="text-xs text-blue-300">{Math.min(step * 20, 100)}%</p>
          </div>

          <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-500"
              style={{ width: `${Math.min(step * 20, 100)}%` }}
            />
          </div>

          <div className="space-y-2">
            {tasks.map((task, i) => {
              const done = step > i;
              return (
                <div
                  key={task}
                  className="flex items-center justify-between rounded-xl bg-black/25 px-3 py-2 text-sm"
                >
                  <span className={done ? "text-white" : "text-zinc-500"}>
                    {task}
                  </span>
                  <span className={done ? "text-green-300" : "text-zinc-600"}>
                    {done ? "✓" : "○"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {isDone && (
        <div className="mt-5 space-y-2">
          {[
            ["HOOK", demo.hook],
            ["SCRIPT", demo.script],
            ["SCENE 1 · PROMPT", demo.scene],
            ["THUMBNAIL", demo.thumbnail],
            ["SEO TITLE", demo.seo],
          ].map(([label, text]) => (
            <div
              key={label}
              className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-300">
                {label}
              </p>
              <p className="mt-0.5 truncate text-xs text-gray-300">{text}</p>
            </div>
          ))}

          <div className="mt-3 flex items-center justify-between rounded-xl bg-gradient-to-r from-blue-500/15 to-purple-600/15 p-3 text-xs">
            <span className="text-gray-300">Full package generated</span>
            <span className="flex items-center gap-1 text-green-300">
              ✓ 2.4s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}