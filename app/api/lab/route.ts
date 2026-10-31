// app/api/lab/route.ts
// Private-beta model comparison lab. POST { action, ... } → generates one
// candidate output, stores it under videos/lab/<run>/ and returns its URL.
// Only users allowed to render full videos can call it.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { isFullVideoEnabled } from "@/lib/pipeline/features";
import {
  listGoogleModels,
  labImage,
  labSpeech,
  labVideoPoll,
  labVideoSubmit,
  type ImageProvider,
  type Media,
  type TtsProvider,
  type VideoHandle,
  type VideoProvider,
} from "@/lib/lab/providers";

export const runtime = "nodejs";
export const maxDuration = 300; // script runs: research + plan + draft + editor + fact check + judge

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function readJson<T>(path: string): Promise<T | null> {
  const { data } = await admin().storage.from("videos").download(path);
  if (!data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<string> {
  const db = admin();
  const { error } = await db.storage
    .from("videos")
    .upload(path, Buffer.from(JSON.stringify(value, null, 2)), { contentType: "application/json", upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return db.storage.from("videos").getPublicUrl(path).data.publicUrl;
}

type Research = { brief: string; sources: Array<{ title: string; url: string }> };

/** Research for a lab run; eval topics are cached so every model sees the same brief. */
async function labResearch(idea: string, language: string, cacheId?: string, refresh = false): Promise<Research> {
  const path = cacheId ? `lab/eval/research/${cacheId.replace(/[^a-z0-9-]/gi, "")}.json` : null;
  if (path && !refresh) {
    const hit = await readJson<Research>(path);
    if (hit?.brief) return hit;
  }
  const { researchTopic } = await import("@/lib/pipeline/openai");
  const { RESEARCH_MODEL } = await import("@/lib/pipeline/llm");
  const r = await researchTopic({ idea, outputLanguage: language, model: RESEARCH_MODEL });
  const out = { brief: r.brief, sources: r.sources };
  if (path) await writeJson(path, out);
  return out;
}

async function store(run: string, name: string, media: Media): Promise<string> {
  const db = admin();
  const safe = name.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80);
  const path = `lab/${run}/${safe}.${media.ext}`;
  const { error } = await db.storage.from("videos").upload(path, media.buffer, { contentType: media.contentType, upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return db.storage.from("videos").getPublicUrl(path).data.publicUrl;
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user || !isFullVideoEnabled(user.id)) {
    return NextResponse.json({ success: false, error: "Not available." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const run = String(body.run ?? "default").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "default";
  const name = String(body.name ?? body.model ?? "item");
  const started = Date.now();
  try {
    switch (body.action) {
      case "image": {
        const media = await labImage(body.provider as ImageProvider, String(body.model), String(body.prompt ?? ""));
        return NextResponse.json({ success: true, url: await store(run, name, media), ms: Date.now() - started, bytes: media.buffer.length });
      }
      case "tts": {
        const media = await labSpeech(body.provider as TtsProvider, String(body.model), String(body.text ?? ""), String(body.voice ?? ""));
        return NextResponse.json({ success: true, url: await store(run, name, media), ms: Date.now() - started, note: media.note, bytes: media.buffer.length });
      }
      case "video": {
        const handle = await labVideoSubmit(
          body.provider as VideoProvider,
          String(body.model),
          String(body.prompt ?? ""),
          typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : undefined
        );
        return NextResponse.json({ success: true, handle, ms: Date.now() - started });
      }
      case "poll": {
        const handle = body.handle as VideoHandle;
        const r = await labVideoPoll(handle);
        if (!r.done) return NextResponse.json({ success: true, done: false });
        if (r.error || !r.media) return NextResponse.json({ success: false, done: true, error: r.error ?? "failed" });
        return NextResponse.json({ success: true, done: true, url: await store(run, name, r.media), bytes: r.media.buffer.length });
      }
      case "align": {
        // Debug: run ElevenLabs forced alignment on a stored narration.
        const audioUrl = String(body.audioUrl ?? "");
        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok) throw new Error(`audio fetch HTTP ${audioRes.status}`);
        const buf = Buffer.from(await audioRes.arrayBuffer());
        const { forceAlign } = await import("@/lib/pipeline/elevenlabs");
        const a = await forceAlign(buf, String(body.text ?? ""), audioRes.headers.get("content-type") ?? "audio/wav");
        return NextResponse.json({
          success: true,
          ms: Date.now() - started,
          bytes: buf.length,
          chars: a?.characters.length ?? 0,
          last: a ? a.character_end_times_seconds[a.character_end_times_seconds.length - 1] : null,
        });
      }
      case "models":
        return NextResponse.json({ success: true, models: await listGoogleModels() });
      case "text-models": {
        const { listOpenAIModels } = await import("@/lib/lab/script-eval");
        const google = (await listGoogleModels(/^gemini-/i).catch(() => [])) as Array<{ name: string; methods: string[] }>;
        return NextResponse.json({ success: true, openai: await listOpenAIModels(), google: google
            .filter((m) => m.methods.includes("generateContent") && !/image|tts|audio|live|embed|omni|banana|robot/i.test(m.name))
            .map((m) => m.name) });
      }
      case "eval-topics": {
        const { EVAL_TOPICS, JUDGE_MODEL } = await import("@/lib/lab/script-eval");
        const { SCRIPT_MODEL } = await import("@/lib/pipeline/llm");
        const { SCRIPT_PROMPT_VERSION } = await import("@/lib/pipeline/openai");
        return NextResponse.json({ success: true, topics: EVAL_TOPICS, judge: JUDGE_MODEL, current: SCRIPT_MODEL, promptVersion: SCRIPT_PROMPT_VERSION });
      }
      case "research": {
        const r = await labResearch(String(body.idea ?? ""), String(body.language ?? "English"), typeof body.cacheId === "string" ? body.cacheId : undefined, body.refresh === true);
        return NextResponse.json({ success: true, ...r, ms: Date.now() - started });
      }
      case "script": {
        // One script-writer run: optional research → full generateScript → optional judge.
        const idea = String(body.idea ?? "").trim();
        const language = String(body.language ?? "English");
        const style = String(body.style ?? "Documentary");
        const duration = String(body.duration ?? "60 seconds");
        const { SCRIPT_MODEL } = await import("@/lib/pipeline/llm");
        const model = String(body.model ?? SCRIPT_MODEL);
        let research: string | null = typeof body.research === "string" && body.research.trim() ? body.research : null;
        if (!research && body.withResearch === true) {
          research = (await labResearch(idea, language, typeof body.cacheId === "string" ? body.cacheId : undefined)).brief;
        }
        const { generateScript } = await import("@/lib/pipeline/openai");
        const { narrationWordCount, wordRange } = await import("@/lib/pipeline/narration");
        const { languageCode } = await import("@/lib/pipeline/options");
        const { estimateCostUsd, splitProvider } = await import("@/lib/pipeline/usage");
        const t0 = Date.now();
        const r = await generateScript({
          idea,
          platform: "YouTube Shorts",
          style,
          duration,
          outputLanguage: language,
          model,
          orientation: "vertical",
          research,
          notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null,
        });
        const writeMs = Date.now() - t0;
        const range = wordRange(duration, languageCode(language));
        const words = narrationWordCount(r.hook, r.script);
        const { provider, model: m } = splitProvider(r.usageKey ?? `openai:${model}`);
        const costUsd = estimateCostUsd(provider, m, { inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens });
        let judge = null;
        if (body.judge === true) {
          const { judgeScript } = await import("@/lib/lab/script-eval");
          judge = (await judgeScript({ idea, language, hook: r.hook, script: r.script, research, wordCount: words, range })).scores;
        }
        return NextResponse.json({
          success: true,
          ms: Date.now() - started,
          writeMs,
          model: r.usageKey,
          promptVersion: r.promptVersion,
          hook: r.hook,
          script: r.script,
          words,
          range,
          plan: r.plan,
          factCheck: r.factCheck,
          usage: r.usage,
          costUsd,
          research,
          judge,
        });
      }
      case "usage-report": {
        // Read-only: real provider cost per job/step (provider_usage) to price credits.
        const db = admin();
        const since = String(body.since ?? new Date(Date.now() - 2 * 86400_000).toISOString());
        const { data: rows, error } = await db
          .from("provider_usage")
          .select("job_id, step, provider, model, unit, quantity, input_tokens, output_tokens, estimated_cost_usd, status, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(5000);
        if (error) throw new Error(error.message);
        const ids = [...new Set((rows ?? []).map((r) => r.job_id))];
        const { data: jobs } = ids.length
          ? await db.from("pipeline_jobs").select("id, idea, status, credits_charged, credits_refunded, output_language, options, steps").in("id", ids)
          : { data: [] as Array<Record<string, unknown>> };
        const out = (jobs ?? []).map((j) => {
          const steps = (j.steps ?? {}) as Record<string, Record<string, unknown>>;
          const plan = steps.video?.plan as Record<string, unknown> | undefined;
          const usage = (rows ?? []).filter((r) => r.job_id === j.id);
          return {
            id: j.id,
            idea: String(j.idea).slice(0, 60),
            status: j.status,
            lang: j.output_language,
            charged: j.credits_charged,
            refunded: j.credits_refunded,
            footage: plan?.footage,
            clipMode: plan?.clipMode,
            seconds: steps.voiceover?.duration_seconds,
            calls: usage.map((u) => ({
              step: u.step,
              model: `${u.provider}:${u.model}`,
              unit: u.unit,
              qty: u.quantity,
              inTok: u.input_tokens,
              outTok: u.output_tokens,
              usd: Number(u.estimated_cost_usd),
              ok: u.status === "ok",
            })),
          };
        });
        return NextResponse.json({ success: true, since, jobs: out });
      }
      case "rerender": {
        // Re-render a finished full video with a different background track.
        // Only the render step runs again (no new script/voice/visuals, no charge).
        const jobId = String(body.jobId ?? "");
        const db = admin();
        const { data: job } = await db.from("pipeline_jobs").select("*").eq("id", jobId).maybeSingle();
        if (!job || job.user_id !== user.id) throw new Error("Job not found.");
        if (job.status === "running") throw new Error("Job is still running.");
        const steps = (job.steps ?? {}) as Record<string, Record<string, unknown>>;
        if (!steps.render) throw new Error("Not a full-video job.");
        const { MUSIC_TRACKS } = await import("@/lib/pipeline/music");
        const musicId = String(body.musicId ?? "");
        if (!MUSIC_TRACKS.some((t) => t.id === musicId)) throw new Error(`Unknown music id: ${musicId}`);
        steps.render = {
          ...steps.render,
          status: "pending",
          render_id: null,
          provider_status: null,
          error: null,
          music_id: musicId,
          version: (Number(steps.render.version) || 0) + 1,
          queued_at: new Date().toISOString(),
        };
        const { error } = await db
          .from("pipeline_jobs")
          .update({ steps, status: "running", current_step: "render", error: null })
          .eq("id", jobId);
        if (error) throw new Error(error.message);
        const { kickJob } = await import("@/lib/pipeline/runner");
        await kickJob(jobId);
        return NextResponse.json({ success: true, version: steps.render.version });
      }
      case "music-list": {
        const { MUSIC_TRACKS } = await import("@/lib/pipeline/music");
        return NextResponse.json({ success: true, tracks: MUSIC_TRACKS });
      }
      case "music-catalog": {
        // Kevin MacLeod's own catalogue metadata (feel / genre / length per piece).
        const url = String(body.url ?? "https://incompetech.com/music/royalty-free/pieces.json");
        if (!url.startsWith("https://incompetech.com/")) throw new Error("incompetech.com only");
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();
        let pieces: Array<Record<string, unknown>> = [];
        try {
          const j = JSON.parse(text);
          pieces = Array.isArray(j) ? j : Array.isArray(j?.pieces) ? j.pieces : [];
        } catch {
          return NextResponse.json({ success: false, status: res.status, error: "not JSON", head: text.slice(0, 400) });
        }
        const want = Array.isArray(body.titles) ? (body.titles as string[]).map((t) => t.toLowerCase()) : null;
        const feel = typeof body.feel === "string" ? body.feel.toLowerCase() : null;
        const rows = pieces.filter((p) => {
          const title = String(p.title ?? "").toLowerCase();
          if (want && !want.includes(title)) return false;
          if (feel && !JSON.stringify(p.feel ?? "").toLowerCase().includes(feel)) return false;
          return true;
        });
        return NextResponse.json({ success: true, total: pieces.length, keys: Object.keys(pieces[0] ?? {}), rows: rows.slice(0, 300) });
      }
      case "music-analyze": {
        const { analyzeTrack } = await import("@/lib/lab/music-analyze");
        return NextResponse.json({ success: true, result: await analyzeTrack(String(body.title ?? "")), ms: Date.now() - started });
      }
      case "save-eval": {
        const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${String(body.model ?? "model").replace(/[^a-z0-9.-]/gi, "_")}`;
        const url = await writeJson(`lab/eval/runs/${id}.json`, { savedAt: new Date().toISOString(), ...(body.result as object) });
        return NextResponse.json({ success: true, url, id });
      }
      case "list-evals": {
        const db = admin();
        const { data } = await db.storage.from("videos").list("lab/eval/runs", { limit: 100, sortBy: { column: "name", order: "desc" } });
        const runs = [];
        for (const f of (data ?? []).slice(0, 30)) {
          const j = await readJson<Record<string, unknown>>(`lab/eval/runs/${f.name}`);
          if (j) runs.push({ id: f.name.replace(/\.json$/, ""), model: j.model, promptVersion: j.promptVersion, average: j.average, count: j.count, savedAt: j.savedAt, costUsd: j.costUsd });
        }
        return NextResponse.json({ success: true, runs });
      }
      default:
        return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
  }
}
