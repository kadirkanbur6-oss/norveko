"use client";

// app/lab/page.tsx
// Private-beta model comparison lab: the same scene / narration / clip is
// generated with every candidate model so quality can be judged side by side
// before the production pipeline switches provider. Model ids are editable
// because provider catalogues change faster than this code.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Play, RefreshCw } from "lucide-react";
import ScriptLab from "./ScriptLab";

type Kind = "image" | "tts" | "video";
type Status = "idle" | "running" | "done" | "error";

interface Candidate {
  key: string;
  kind: Kind;
  label: string;
  provider: string;
  model: string;
  /** USD per unit (image, 1K chars, 5 s clip) from the 31 Oct research. */
  cost: string;
  current?: boolean;
  voice?: string;
  /** Video: animate the chosen still instead of text-to-video. */
  fromImage?: boolean;
}

interface CellState {
  status: Status;
  url?: string;
  error?: string;
  ms?: number;
  note?: string;
}

const CANDIDATES: Candidate[] = [
  // Images
  { key: "img-now", kind: "image", label: "Gemini 3.1 Flash Image", provider: "gemini", model: "gemini-3.1-flash-image", cost: "$0.067", current: true },
  { key: "img-nb21", kind: "image", label: "Nano Banana 2.1", provider: "gemini", model: "gemini-nano-banana-2.1", cost: "$0.034" },
  { key: "img-lite", kind: "image", label: "Nano Banana 2 Lite", provider: "gemini", model: "gemini-3.1-flash-lite-image", cost: "$0.034" },
  { key: "img-3pro", kind: "image", label: "Gemini 3 Pro Image", provider: "gemini", model: "gemini-3-pro-image", cost: "?" },
  { key: "img-gpt2", kind: "image", label: "GPT Image 2 (medium)", provider: "openai", model: "gpt-image-2", cost: "$0.041" },
  { key: "img-seedream", kind: "image", label: "Seedream 5.0 Lite (fal)", provider: "fal", model: "fal-ai/bytedance/seedream/v5/lite/text-to-image", cost: "$0.035" },
  // Voices (Daniel — the Turkish narrator used in production)
  { key: "tts-v2", kind: "tts", label: "ElevenLabs Multilingual v2", provider: "elevenlabs", model: "eleven_multilingual_v2", cost: "$0.08 / 1K", current: true, voice: "onwK4e9ZLuTAKqWW03F9" },
  { key: "tts-v4", kind: "tts", label: "ElevenLabs v4", provider: "elevenlabs", model: "eleven_v4", cost: "? / 1K", voice: "onwK4e9ZLuTAKqWW03F9" },
  { key: "tts-v3", kind: "tts", label: "ElevenLabs v3", provider: "elevenlabs", model: "eleven_v3", cost: "$0.08 / 1K", voice: "onwK4e9ZLuTAKqWW03F9" },
  { key: "tts-flash", kind: "tts", label: "ElevenLabs Flash v2.5", provider: "elevenlabs", model: "eleven_flash_v2_5", cost: "$0.04 / 1K", voice: "onwK4e9ZLuTAKqWW03F9" },
  { key: "tts-gemini", kind: "tts", label: "Gemini Flash TTS", provider: "gemini", model: "gemini-2.5-flash-preview-tts", cost: "~$0.016 / 1K", voice: "Charon" },
  { key: "tts-gemini-pro", kind: "tts", label: "Gemini Pro TTS (production)", provider: "gemini", model: "gemini-2.5-pro-preview-tts", cost: "~$0.033 / 1K", voice: "Charon" },
  { key: "tts-gemini-38", kind: "tts", label: "Gemini 3.8 Flash TTS", provider: "gemini", model: "gemini-3.8-flash-tts", cost: "~$0.016 / 1K", voice: "Charon" },
  // Video
  { key: "vid-kling", kind: "video", label: "Kling 3.0 (text→video)", provider: "kling", model: "kling-3.0", cost: "$0.42–0.50", current: true },
  { key: "vid-omni", kind: "video", label: "Gemini Omni 1.1 Flash (image→video)", provider: "omni", model: "gemini-omni-1.1-flash", cost: "?", fromImage: true },
  { key: "vid-sd10", kind: "video", label: "Seedance 1.0 Pro Fast (fal)", provider: "fal", model: "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video", cost: "~$0.11", fromImage: true },
  { key: "vid-sd15", kind: "video", label: "Seedance 1.5 Pro, silent (fal)", provider: "fal", model: "fal-ai/bytedance/seedance/v1.5/pro/image-to-video", cost: "~$0.13", fromImage: true },
  { key: "vid-sd20mini", kind: "video", label: "Seedance 2.0 Mini (fal)", provider: "fal", model: "bytedance/seedance-2.0/mini/image-to-video", cost: "~$0.77", fromImage: true },
  { key: "vid-h3-turbo", kind: "video", label: "MiniMax H3 Max Turbo (fal)", provider: "fal", model: "minimax/h3-max-turbo/image-to-video", cost: "$0.20", fromImage: true },
  { key: "vid-h3", kind: "video", label: "MiniMax H3 Max (fal)", provider: "fal", model: "minimax/h3-max/image-to-video", cost: "$0.40", fromImage: true },
];

const DEFAULT_IMAGE_PROMPT =
  "Photorealistic cinematic film still from a high-budget documentary, vertical frame. Wide establishing shot, 24mm lens: ancient Egyptian workers hauling a huge limestone block on a wooden sled across wet sand toward a half-built pyramid at dawn, era-accurate linen clothing seen from behind, warm golden low sun, dust in the air, ochre and sandstone palette, volumetric light. No text, letters or logos.";
const DEFAULT_TTS_TEXT =
  "Betonda kendiliğinden yüzler belirdi. 23 Ağustos 1971'de, Belmez'deki küçük bir mutfakta María Gómez Cámara zemine baktı… ve bir yüzün ona baktığını gördü. Zemini kırdılar. Yenisini döktüler. Ama yüzler geri geldi.";
const DEFAULT_VIDEO_PROMPT =
  "Slow steady push-in on the scene, workers pull the sled forward, dust drifts in golden light, level horizon, no camera roll.";

export default function LabPage() {
  const [run] = useState(() => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  const [models, setModels] = useState<Record<string, string>>(() => Object.fromEntries(CANDIDATES.map((c) => [c.key, c.model])));
  const [cells, setCells] = useState<Record<string, CellState>>({});
  const [imagePrompt, setImagePrompt] = useState(DEFAULT_IMAGE_PROMPT);
  const [ttsText, setTtsText] = useState(DEFAULT_TTS_TEXT);
  const [videoPrompt, setVideoPrompt] = useState(DEFAULT_VIDEO_PROMPT);
  const [sourceImage, setSourceImage] = useState<string>("");
  const [googleModels, setGoogleModels] = useState<string>("");

  const imageOptions = useMemo(
    () => CANDIDATES.filter((c) => c.kind === "image" && cells[c.key]?.url).map((c) => ({ label: c.label, url: cells[c.key]!.url! })),
    [cells]
  );
  const chosenImage = sourceImage || imageOptions[0]?.url || "";

  const set = (key: string, patch: CellState) => setCells((prev) => ({ ...prev, [key]: patch }));

  async function call(body: Record<string, unknown>) {
    const res = await fetch("/api/lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run, ...body }) });
    return (await res.json()) as {
      success: boolean;
      url?: string;
      error?: string;
      ms?: number;
      note?: string;
      done?: boolean;
      handle?: unknown;
    };
  }

  async function runOne(c: Candidate) {
    const model = models[c.key];
    set(c.key, { status: "running" });
    const started = Date.now();
    try {
      if (c.kind === "image") {
        const r = await call({ action: "image", provider: c.provider, model, prompt: imagePrompt, name: c.key });
        set(c.key, r.success ? { status: "done", url: r.url, ms: r.ms } : { status: "error", error: r.error, ms: r.ms });
        return;
      }
      if (c.kind === "tts") {
        const r = await call({ action: "tts", provider: c.provider, model, text: ttsText, voice: c.voice, name: c.key });
        set(c.key, r.success ? { status: "done", url: r.url, ms: r.ms, note: r.note } : { status: "error", error: r.error, ms: r.ms });
        return;
      }
      if (c.fromImage && !chosenImage) {
        set(c.key, { status: "error", error: "Generate at least one image first (image→video uses it)." });
        return;
      }
      const prompt = c.fromImage ? videoPrompt : `${imagePrompt} ${videoPrompt}`;
      const sub = await call({ action: "video", provider: c.provider, model, prompt, imageUrl: c.fromImage ? chosenImage : undefined, name: c.key });
      if (!sub.success) {
        set(c.key, { status: "error", error: sub.error });
        return;
      }
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 10_000));
        const p = await call({ action: "poll", handle: sub.handle, name: c.key });
        // A failed poll (provider error) is terminal too — don't keep waiting.
        if (p.done || p.success === false) {
          set(c.key, p.success ? { status: "done", url: p.url, ms: Date.now() - started } : { status: "error", error: p.error, ms: Date.now() - started });
          return;
        }
        set(c.key, { status: "running", ms: Date.now() - started });
      }
      set(c.key, { status: "error", error: "Timed out after 15 minutes." });
    } catch (err) {
      set(c.key, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  function runKind(kind: Kind) {
    CANDIDATES.filter((c) => c.kind === kind).forEach((c) => void runOne(c));
  }

  const section = (kind: Kind, title: string, hint: string) => (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <p className="text-xs text-gray-400">{hint}</p>
        </div>
        <button
          type="button"
          onClick={() => runKind(kind)}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white"
        >
          <Play size={14} /> Run all
        </button>
      </div>
      <div className={`mt-4 grid gap-4 ${kind === "tts" ? "md:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
        {CANDIDATES.filter((c) => c.kind === kind).map((c) => {
          const cell = cells[c.key] ?? { status: "idle" as Status };
          return (
            <div key={c.key} className={`rounded-2xl border p-3 ${c.current ? "border-yellow-400/40 bg-yellow-500/[0.04]" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {c.label} {c.current && <span className="ml-1 rounded-full bg-yellow-400/20 px-2 py-0.5 text-[10px] text-yellow-200">current</span>}
                  </p>
                  <p className="text-xs text-gray-400">{c.cost}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void runOne(c)}
                  disabled={cell.status === "running"}
                  aria-label={`Run ${c.label}`}
                  className="rounded-lg border border-white/10 p-1.5 text-gray-300 hover:text-white disabled:opacity-50"
                >
                  {cell.status === "running" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </button>
              </div>
              <input
                value={models[c.key]}
                onChange={(e) => setModels((m) => ({ ...m, [c.key]: e.target.value }))}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-gray-300"
                aria-label={`${c.label} model id`}
              />
              <div className="mt-3">
                {cell.status === "running" && (
                  <p className="text-xs text-blue-200">Generating… {cell.ms ? `${Math.round(cell.ms / 1000)} s` : ""}</p>
                )}
                {cell.status === "error" && <p className="break-words text-xs text-red-300">{cell.error}</p>}
                {cell.status === "done" && cell.url && (
                  <>
                    {kind === "image" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cell.url} alt={c.label} className="aspect-[9/16] w-full rounded-xl object-cover" />
                    )}
                    {kind === "tts" && <audio controls src={cell.url} className="w-full" />}
                    {kind === "video" && <video controls playsInline loop src={cell.url} className="aspect-[9/16] w-full rounded-xl bg-black object-cover" />}
                    <p className="mt-1 text-[11px] text-gray-500">
                      {cell.ms ? `${(cell.ms / 1000).toFixed(1)} s` : ""}
                      {cell.note ? ` · ${cell.note}` : ""}
                    </p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <main id="main-content" className="min-h-screen bg-[#0a0a12] px-4 py-8 text-white sm:px-8">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
        <ArrowLeft size={14} /> Dashboard
      </Link>
      <h1 className="mt-4 text-2xl font-black">Model lab</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-400">
        Same scene, same narration, every candidate model. Yellow = what production uses today. Pick by quality first, then price.
      </p>

      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-gray-400">
        <button
          type="button"
          onClick={async () => {
            setGoogleModels("Loading…");
            const r = await call({ action: "models" });
            setGoogleModels(
              r.success
                ? ((r as unknown as { models: Array<{ name: string; methods: string[] }> }).models ?? [])
                    .map((m) => `${m.name}  [${m.methods.join(", ")}]`)
                    .join("\n")
                : r.error ?? "failed"
            );
          }}
          className="rounded-lg border border-white/10 px-3 py-1 text-gray-200 hover:text-white"
        >
          List Google image / video / TTS models for this key
        </button>
        {googleModels && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-gray-300">{googleModels}</pre>}
      </div>

      <ScriptLab />

      <label className="mt-10 block text-xs font-semibold uppercase tracking-wider text-gray-400">Scene prompt (images)</label>
      <textarea value={imagePrompt} onChange={(e) => setImagePrompt(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm" />
      {section("image", "1 · Scene images (9:16)", "One image per 5-second slot in a video; 9–12 per 60 s Short.")}

      <label className="mt-10 block text-xs font-semibold uppercase tracking-wider text-gray-400">Narration (Turkish)</label>
      <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm" />
      {section("tts", "2 · Voiceover", "Same voice (Daniel) where the provider allows it. Word timings are needed for karaoke subtitles.")}

      <label className="mt-10 block text-xs font-semibold uppercase tracking-wider text-gray-400">Motion prompt (video)</label>
      <textarea value={videoPrompt} onChange={(e) => setVideoPrompt(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
        Image→video source:
        <select value={chosenImage} onChange={(e) => setSourceImage(e.target.value)} className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-gray-200">
          {imageOptions.length === 0 && <option value="">(generate images first)</option>}
          {imageOptions.map((o) => (
            <option key={o.url} value={o.url}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {section("video", "3 · Video clips (5 s)", "Kling is text→video today; the candidates animate the chosen still so clips match the images.")}
    </main>
  );
}
