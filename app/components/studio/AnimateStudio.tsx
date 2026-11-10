"use client";
import { friendlyErrorLine } from "@/lib/user-error";

// Image to video: upload a picture, say what should happen, get a moving clip.
// The picture is the first frame and the reference (Seedance on fal, silent).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlay, Loader2, Upload } from "lucide-react";
import FinishedVideo from "./FinishedVideo";
import GenerationStage from "../GenerationStage";

type Clip = {
  id: string;
  status: "running" | "completed" | "failed";
  prompt: string | null;
  seconds: number;
  vertical: boolean;
  credits: number;
  imageUrl: string | null;
  outputUrl: string | null;
  projectId: string | null;
  error: string | null;
  createdAt: string;
};

export default function AnimateStudio({ text, onStarted }: { text: string; onStarted: () => void }) {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [options, setOptions] = useState<Array<{ seconds: number; credits: number }>>([]);
  const [clips, setClips] = useState<Clip[]>([]);
  const [image, setImage] = useState<{ path: string; preview: string; vertical: boolean } | null>(null);
  const [seconds, setSeconds] = useState(5);
  const [vertical, setVertical] = useState(true);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState<"" | "upload" | "start">("");
  const [error, setError] = useState("");
  const seenRunning = useRef<Set<string>>(new Set());
  const [finished, setFinished] = useState<{ title: string; url: string; projectId: string | null; vertical: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/animate").then((r) => r.json()).catch(() => null);
    if (!d?.success) return;
    setAllowed(Boolean(d.allowed));
    setOptions(d.options ?? []);
    setClips(d.clips ?? []);
    for (const x of (d.clips ?? []) as Clip[]) {
      if (x.status === "running") seenRunning.current.add(x.id);
      else if (seenRunning.current.has(x.id)) {
        seenRunning.current.delete(x.id);
        if (x.status === "completed" && x.outputUrl) {
          setFinished({ title: x.prompt?.slice(0, 60) || "Image to video", url: x.outputUrl, projectId: x.projectId, vertical: x.vertical });
        }
      }
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const running = clips.filter((c) => c.status === "running").map((c) => c.id).join(",");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      for (const id of running.split(",")) await fetch(`/api/animate?id=${id}`).catch(() => undefined);
      await load();
    }, 10000);
    return () => clearInterval(t);
  }, [running, load]);

  async function post(body: Record<string, unknown>) {
    const d = await fetch("/api/animate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    if (!d.success) throw new Error(d.error || "Something went wrong.");
    return d;
  }

  async function upload(file: File) {
    setBusy("upload");
    setError("");
    setImage(null);
    try {
      const prep = await post({ action: "uploadUrl", type: file.type, size: file.size });
      const { supabase } = await import("@/app/lib/supabase");
      const { error: upErr } = await supabase.storage.from("videos").uploadToSignedUrl(prep.path, prep.token, file, { contentType: prep.contentType });
      if (upErr) throw new Error("The upload failed. Please try again.");
      const preview = URL.createObjectURL(file);
      // Match the picture's shape by default (the creator can still switch).
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 1, h: 1 });
        img.src = preview;
      });
      const isVertical = dims.h >= dims.w;
      setVertical(isVertical);
      setImage({ path: prep.path, preview, vertical: isVertical });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload failed.");
    } finally {
      setBusy("");
    }
  }

  async function start() {
    if (!image) return;
    setBusy("start");
    setError("");
    try {
      await post({ action: "start", path: image.path, prompt: text, seconds, orientation: vertical ? "vertical" : "horizontal", rights });
      setImage(null);
      setRights(false);
      onStarted();
      await load();
      setTimeout(() => stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "It couldn't be started.");
    } finally {
      setBusy("");
    }
  }

  const price = options.find((o) => o.seconds === seconds)?.credits;
  const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:p-6";
  const anyRunning = clips.some((c) => c.status === "running");

  return (
    <div className="space-y-5">
      {finished && <FinishedVideo {...finished} onClose={() => setFinished(null)} />}

      {anyRunning && (
        <div ref={stageRef} className="scroll-mt-20 space-y-4">
          {clips
            .filter((c) => c.status === "running")
            .map((c) => (
              <GenerationStage
                key={c.id}
                title="Image to video"
                createdAt={c.createdAt}
                steps={[
                  {
                    id: "animate",
                    label: "Bringing your picture to life",
                    status: "running",
                    startedAt: c.createdAt,
                    expected: c.seconds > 5 ? 150 : 90,
                    messages: ["Reading your picture…", "Planning the motion…", "Rendering the frames…"],
                  },
                ]}
              />
            ))}
        </div>
      )}

      {allowed === false && (
        <div className={card}>
          <p className="text-sm text-gray-300">
            Image to video is available once you have bought a plan or pack.{" "}
            <Link href="/billing" className="text-sky-300 hover:text-white">
              See plans
            </Link>
          </p>
        </div>
      )}

      {allowed && !anyRunning && (
        <div className={card}>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <p className="text-sm font-semibold">1. Your picture</p>
              <p className="mt-1 text-xs text-gray-500">JPG, PNG or WebP, up to 8 MB. It becomes the first frame of the video.</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void upload(f);
                }}
              />
              {image ? (
                <div className="mt-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.preview} alt="Your picture" className="max-h-72 w-full rounded-xl bg-black object-contain" />
                  <button type="button" onClick={() => fileRef.current?.click()} className="mt-2 text-xs text-sky-300 hover:text-white">
                    Use another picture
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy !== ""}
                  className="mt-3 flex h-40 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-sm text-gray-300 transition hover:border-sky-400/50 disabled:opacity-50"
                >
                  {busy === "upload" ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                  {busy === "upload" ? "Uploading…" : "Choose a picture"}
                </button>
              )}
            </div>

            <div>
              <p className="text-sm font-semibold">2. The clip</p>
              <p className="mt-1 text-xs text-gray-500">Describe the motion in the box above (optional). Without it, the picture gets gentle natural movement.</p>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Length">
                {options.map((o) => (
                  <button
                    key={o.seconds}
                    type="button"
                    role="radio"
                    aria-checked={seconds === o.seconds}
                    onClick={() => setSeconds(o.seconds)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${seconds === o.seconds ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"}`}
                  >
                    {o.seconds} seconds · {o.credits} credits
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Shape">
                {[
                  { v: true, label: "Vertical 9:16" },
                  { v: false, label: "Horizontal 16:9" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="radio"
                    aria-checked={vertical === o.v}
                    onClick={() => setVertical(o.v)}
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${vertical === o.v ? "border-sky-400/60 bg-sky-500/15 text-white" : "border-white/10 text-gray-300 hover:border-white/25"}`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-500">The video is silent. If the picture doesn&apos;t match the shape, the edges are cropped.</p>
            </div>
          </div>

          <label className="mt-5 flex items-start gap-2 text-xs text-gray-300">
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" />
            <span>I own this picture or have the right to use it (and permission from anyone recognisable in it), and I won&apos;t use the result to deceive anyone.</span>
          </label>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={start}
              disabled={busy !== "" || !image || !rights}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-5 py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {busy === "start" ? <Loader2 size={16} className="animate-spin" /> : <ImagePlay size={16} />}
              {busy === "start" ? "Checking the picture…" : price ? `Make video · ${price} credits` : "Make video"}
            </button>
            <span className="text-xs text-gray-500">takes about 1–3 minutes</span>
          </div>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </div>
      )}

      {!anyRunning && clips.length > 0 && (
        <div className={card}>
          <p className="text-sm font-semibold">Your clips</p>
          <ul className="mt-3 space-y-2">
            {clips.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[var(--nv-panel)] px-4 py-3 text-sm">
                {c.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover" />
                )}
                <span className="max-w-[18rem] truncate font-medium">{c.prompt || "Image to video"}</span>
                <span className="text-xs text-gray-500">
                  {Math.round(c.seconds)} s · {new Date(c.createdAt).toLocaleString("en-US")}
                </span>
                <span className="ml-auto">
                  {c.status === "completed" && c.projectId ? (
                    <Link href={`/projects/${c.projectId}`} className="text-xs font-semibold text-sky-300 hover:text-white">
                      Open video
                    </Link>
                  ) : (
                    <span className="text-xs text-red-300">{friendlyErrorLine(c.error)} · refunded</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
