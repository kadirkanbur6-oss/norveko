"use client";

// Shown on a project whose visuals were made but whose final render failed:
// one click renders the video again (free) and the page updates when it's done.

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

export default function RetryRender({ projectId }: { projectId: string }) {
  const [state, setState] = useState<"hidden" | "ready" | "working" | "error">("hidden");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/edit`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.retryRender) setState("ready");
        else if (d?.status === "running" && d?.renderStatus && d.renderStatus !== "completed") setState("working");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (state !== "working") return;
    const id = setInterval(async () => {
      try {
        const d = await fetch(`/api/projects/${projectId}/edit`).then((r) => r.json());
        if (d?.editable) window.location.reload();
        else if (d?.retryRender) {
          setState("error");
          setMessage("The render failed again. Please contact support.");
        }
      } catch {
        // keep polling
      }
    }, 10000);
    return () => clearInterval(id);
  }, [state, projectId]);

  async function retry() {
    setState("working");
    setMessage("");
    try {
      const d = await fetch(`/api/projects/${projectId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retryRender" }),
      }).then((r) => r.json());
      if (!d?.success) throw new Error(d?.error || "Could not retry.");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not retry.");
    }
  }

  if (state === "hidden") return null;
  return (
    <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">
        <p className="font-semibold text-amber-100">
          {state === "working" ? "Rendering your video again…" : "The final video render failed"}
        </p>
        <p className="mt-0.5 text-amber-100/70">
          {state === "working"
            ? "Long videos can take 20–40 minutes. You can leave this page."
            : message || "Your script, voice and visuals are saved. Render the video again. It's free."}
        </p>
      </div>
      {state !== "working" ? (
        <button
          type="button"
          onClick={retry}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-300"
        >
          <RotateCcw size={15} aria-hidden /> Render again
        </button>
      ) : (
        <Loader2 size={18} className="shrink-0 animate-spin text-amber-200" aria-hidden />
      )}
    </div>
  );
}
