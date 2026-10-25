"use client";

// app/components/StockFootagePicker.tsx
// Per-scene "Find stock footage" panel backed by /api/stock (Pexels).
// Lets the user pick a free B-roll clip for a scene instead of (or before)
// generating an AI clip. Attribution link is shown as Pexels requires.

import { useState } from "react";
import { ExternalLink, Film, Loader2, Search } from "lucide-react";
import type { StockClip, StockProvider } from "@/lib/pipeline/pexels";

function providerLabel(provider: StockProvider): string {
  return provider === "pixabay" ? "Pixabay" : "Pexels";
}

export default function StockFootagePicker({
  prompt,
  orientation,
  onPick,
}: {
  prompt: string;
  orientation: "vertical" | "horizontal";
  onPick?: (clip: StockClip) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [clips, setClips] = useState<StockClip[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  async function search(q?: string) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: q ?? prompt, orientation });
      const res = await fetch(`/api/stock?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (res.status === 503) {
        setUnavailable(true);
        return;
      }
      if (!data.success) throw new Error(data.error || "Search failed.");
      setClips(data.clips);
      if (!q) setQuery(data.query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (clips === null) void search();
        }}
        className="mt-2 inline-flex items-center gap-1.5 text-xs text-blue-300 transition hover:text-blue-200"
      >
        <Film size={12} />
        Find stock footage
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-[#0d0d16] px-2.5 py-1.5">
          <Search size={13} className="shrink-0 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search(query);
            }}
            placeholder="Describe the shot…"
            aria-label="Stock footage search"
            className="w-full min-w-0 bg-transparent text-xs text-white outline-none placeholder:text-gray-500"
          />
        </label>
        <button
          type="button"
          onClick={() => void search(query)}
          disabled={loading}
          className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-gray-200 transition hover:text-white disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : "Search"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-500 hover:text-white">
          Close
        </button>
      </div>

      {unavailable && (
        <p className="mt-3 text-xs text-gray-500">
          Stock footage isn&apos;t set up on this deployment yet.
        </p>
      )}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

      {clips && clips.length === 0 && !loading && (
        <p className="mt-3 text-xs text-gray-500">No clips found — try a shorter, more visual query.</p>
      )}

      {clips && clips.length > 0 && (
        <div className={`mt-3 grid gap-2 ${orientation === "vertical" ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-2 sm:grid-cols-3"}`}>
          {clips.map((clip) => (
            <figure key={clip.id} className="group min-w-0">
              <video
                src={clip.videoUrl}
                poster={clip.previewImage}
                muted
                playsInline
                loop
                preload="none"
                onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
                onMouseLeave={(e) => {
                  e.currentTarget.pause();
                  e.currentTarget.currentTime = 0;
                }}
                className={`w-full rounded-lg border border-white/10 bg-black object-cover ${
                  orientation === "vertical" ? "aspect-[9/16]" : "aspect-video"
                }`}
              />
              <figcaption className="mt-1 flex items-center justify-between gap-1 text-[10px] text-gray-500">
                <a
                  href={clip.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 truncate hover:text-gray-300"
                  title={`Video by ${clip.author} on ${providerLabel(clip.provider)}`}
                >
                  <ExternalLink size={9} className="shrink-0" />
                  <span className="truncate">{clip.author}</span>
                </a>
                <span className="shrink-0">{Math.round(clip.durationSeconds)}s</span>
              </figcaption>
              <div className="mt-1 flex gap-2 text-[11px]">
                <a href={clip.videoUrl} download className="text-blue-300 hover:text-blue-200">
                  Download
                </a>
                {onPick && (
                  <button type="button" onClick={() => onPick(clip)} className="text-purple-300 hover:text-purple-200">
                    Use for scene
                  </button>
                )}
              </div>
            </figure>
          ))}
        </div>
      )}

      {clips && clips.length > 0 && (
        <p className="mt-3 text-[10px] text-gray-600">
          Videos provided by{" "}
          <a
            href={clips[0].provider === "pixabay" ? "https://pixabay.com/" : "https://www.pexels.com/"}
            target="_blank"
            rel="noreferrer"
            className="hover:text-gray-400"
          >
            {providerLabel(clips[0].provider)}
          </a>
          .
        </p>
      )}
    </div>
  );
}
