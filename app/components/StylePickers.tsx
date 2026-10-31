"use client";

// Look presets for /chat: visual style (all generated images) and caption
// style (burned-in subtitles of full videos). Definitions live in
// lib/pipeline/visual-styles.ts so the server applies exactly what is shown.

import { useState } from "react";
import { CAPTION_STYLES, VISUAL_STYLES } from "@/lib/pipeline/visual-styles";

/** Sample image per style, generated once (lab "style-previews") into the videos bucket. */
export function stylePreviewUrl(id: string): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/storage/v1/object/public/videos/previews/styles/${id}.jpg` : null;
}

const FALLBACK: Record<string, string> = {
  cinematic: "from-amber-700/60 via-slate-800 to-slate-950",
  archive: "from-stone-500/60 via-stone-800 to-stone-950",
  dark: "from-teal-900/70 via-slate-900 to-black",
  anime: "from-sky-500/60 via-indigo-700/60 to-fuchsia-800/60",
  "3d": "from-orange-400/60 via-rose-500/40 to-violet-700/60",
  painting: "from-yellow-800/60 via-amber-950 to-stone-950",
  comic: "from-red-600/60 via-zinc-800 to-black",
  watercolor: "from-sky-200/40 via-rose-200/30 to-emerald-200/30",
};

function Preview({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  const url = stylePreviewUrl(id);
  return (
    <span className={`relative block aspect-[3/4] w-full overflow-hidden rounded-lg bg-gradient-to-br ${FALLBACK[id] ?? "from-slate-700 to-slate-950"}`}>
      {url && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}

export function VisualStylePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="mt-4">
      <label className="text-sm text-gray-400">Visual style</label>
      <p className="text-xs text-gray-500">Applies to the thumbnail and every scene image and clip.</p>
      <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Visual style">
        {VISUAL_STYLES.map((s) => {
          const active = value === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={active}
              title={s.hint}
              onClick={() => onChange(s.id)}
              className={`rounded-xl border p-1.5 text-left transition ${
                active ? "border-blue-400/70 bg-blue-500/10 ring-1 ring-blue-400/40" : "border-white/10 bg-[#12121c] hover:border-white/25"
              }`}
            >
              <Preview id={s.id} />
              <span className="mt-1.5 block truncate px-0.5 text-[11px] font-semibold text-white">{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function CaptionStylePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs font-medium text-gray-400">Subtitle style</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Subtitle style">
        {CAPTION_STYLES.map((c) => {
          const active = value === c.id;
          const words = c.uppercase ? ["THE", "SIGNAL", "STOPPED"] : ["The", "signal", "stopped"];
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(c.id)}
              className={`rounded-xl border p-2 text-left transition ${
                active ? "border-blue-400/60 bg-blue-500/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <span className="flex h-12 items-center justify-center gap-1 rounded-lg bg-gradient-to-b from-slate-700 to-slate-900 px-1">
                {words.map((w, i) => {
                  const spoken = i === 1;
                  return (
                    <span
                      key={w}
                      className={`rounded px-0.5 text-[13px] ${c.font.includes("ExtraBold") ? "font-extrabold" : "font-semibold"}`}
                      style={{
                        color: spoken ? c.preview.accent : c.preview.text,
                        background: spoken && c.preview.box ? c.preview.box : undefined,
                        textShadow: c.stroke ? "0 0 2px #000, 0 0 2px #000, 0 0 2px #000" : undefined,
                      }}
                    >
                      {w}
                    </span>
                  );
                })}
              </span>
              <span className="mt-1.5 block text-xs font-semibold text-white">{c.label}</span>
              <span className="block text-[11px] text-gray-500">{c.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
