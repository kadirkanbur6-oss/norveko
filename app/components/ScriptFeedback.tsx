"use client";

// app/components/ScriptFeedback.tsx
// 👍 / 👎 on a generated script. Ratings are stored with the writer model and
// prompt version so script quality can be compared across prompt changes.

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";

interface Props {
  projectId: string;
  initial?: { rating: "up" | "down"; note?: string } | null;
}

export default function ScriptFeedback({ projectId, initial }: Props) {
  const [rating, setRating] = useState<"up" | "down" | null>(initial?.rating ?? null);
  const [note, setNote] = useState(initial?.note ?? "");
  const [askNote, setAskNote] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(initial ? "saved" : "idle");

  async function send(next: "up" | "down", withNote?: string) {
    setRating(next);
    setState("saving");
    try {
      const res = await fetch(`/api/projects/${projectId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: next, note: withNote ?? (next === "down" ? note : undefined) }),
      });
      const data = await res.json();
      setState(data.success ? "saved" : "error");
    } catch {
      setState("error");
    }
  }

  const btn = (active: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
      active ? "border-blue-400/60 bg-blue-500/15 text-white" : "border-white/10 bg-white/[0.03] text-gray-300 hover:text-white"
    }`;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-1 text-xs text-gray-400">How was the script?</p>
        <button type="button" aria-pressed={rating === "up"} onClick={() => { setAskNote(false); void send("up", ""); }} className={btn(rating === "up")}>
          <ThumbsUp size={13} /> Good
        </button>
        <button type="button" aria-pressed={rating === "down"} onClick={() => { setAskNote(true); void send("down"); }} className={btn(rating === "down")}>
          <ThumbsDown size={13} /> Needs work
        </button>
        <span className="text-[11px] text-gray-500" aria-live="polite">
          {state === "saving" ? "Saving…" : state === "saved" ? "Thanks — saved" : state === "error" ? "Couldn't save" : ""}
        </span>
      </div>
      {rating === "down" && askNote && (
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            placeholder="What was wrong? (wrong fact, weak hook, unnatural wording…)"
            aria-label="What was wrong with the script"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white placeholder-gray-500"
          />
          <button type="button" onClick={() => { void send("down", note); setAskNote(false); }} className="rounded-lg bg-blue-500/80 px-3 py-1.5 text-xs font-semibold text-white">
            Send
          </button>
        </div>
      )}
    </div>
  );
}
