// lib/ambient/ambient.ts
// Ambient music video (10 Nov 2026, Yağmur — "uzun olsun, en uygun maliyetle, %65 kâr, tekrar render yok").
// One idea → a few calm songs (Google Lyria 3 Pro) + one cover picture (Nano Banana) → a long MP4 of
// 10 / 30 / 60 / 120 minutes: a shuffled loop of the songs with soft fades over the still picture,
// assembled with ffmpeg on our own server (a 60-minute video takes about a minute; no Shotstack).
// Stored in swap_jobs with kind = "ambient"; progress state in the `fal` jsonb column; the
// `render_id` column is a short-lived lease so two workers never run the same phase.
//
// Phases (one per call of advanceAmbientJob): music → encode (one call per 60-minute part) → done.

import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SwapRow } from "@/lib/swap/swap";
import { AMBIENT_CHUNK_MINUTES, AMBIENT_MINUTES, ambientTracksFor } from "@/lib/skit/pricing";
import { buildPlaylist, chunkPlaylist } from "./playlist";

export { ambientCreditsFor as ambientCredits } from "@/lib/skit/pricing";
export const AMBIENT_MAX_CHARS = 400;
export const LYRIA_MODEL = process.env.LYRIA_MODEL || "lyria-3-pro-preview";
const LEASE_MS = 6 * 60_000;
const JOB_TIMEOUT_MS = 90 * 60_000;
const FFMPEG_TIMEOUT_MS = 270_000;
/** Songs asked for per call (each is a ~1–2 minute request). */
const SONGS_PER_CALL = 4;
const FADE_SECONDS = 2.5;

export function isAmbientMinutes(n: unknown): n is (typeof AMBIENT_MINUTES)[number] {
  return AMBIENT_MINUTES.includes(n as 10 | 30 | 60 | 120);
}

export interface AmbientState {
  minutes: number;
  tracks: Array<{ key: string; url: string; seconds: number }>;
  needed: number;
  fails: number;
  cover: string | null;
  /** Finished parts of the video (one per 60 minutes). */
  parts: Array<{ key: string; url: string }>;
  total: number;
}

export function readState(row: SwapRow): AmbientState {
  const s = (row.fal ?? {}) as unknown as Partial<AmbientState>;
  return {
    minutes: s.minutes ?? 10,
    tracks: s.tracks ?? [],
    needed: s.needed ?? ambientTracksFor(s.minutes ?? 10),
    fails: s.fails ?? 0,
    cover: s.cover ?? null,
    parts: s.parts ?? [],
    total: s.total ?? (s.minutes ?? 10) * 60,
  };
}

export function initialState(minutes: number): AmbientState {
  return { minutes, tracks: [], needed: ambientTracksFor(minutes), fails: 0, cover: null, parts: [], total: minutes * 60 };
}

/* ---------------- ffmpeg ---------------- */

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null };
  const p = mod.default ?? (mod as unknown as string);
  if (!p || typeof p !== "string") throw new Error("ffmpeg is not available on this server.");
  return p;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err = (err + String(d)).slice(-4000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // `ffmpeg -i file` without an output exits 1 but prints the duration: callers read stderr.
      if (code === 0 || /Duration:/.test(err)) resolve(err);
      else reject(new Error(`ffmpeg failed (${code}): ${err.slice(-500)}`));
    });
  });
}

/** Length of an audio file in seconds. */
export async function audioDuration(file: string): Promise<number> {
  const out = await run(await ffmpegPath(), ["-hide_banner", "-i", file], 30_000);
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/* ---------------- Lyria ---------------- */

const VARIATIONS = [
  "Focus on the main melody with a soft, warm lead sound.",
  "Slightly slower and deeper, with long sustained pads.",
  "Add gentle, sparse percussion and a flowing rhythm.",
  "A more airy and open arrangement, with distant echoes.",
  "A simple, intimate version with fewer layers.",
  "Evolving textures that slowly grow and fade back.",
  "A gentle, hopeful turn in the harmony, still very calm.",
  "A dark, deep and mysterious colour, still soothing.",
  "A bright, light colour with delicate high notes.",
  "A rolling, hypnotic pattern that repeats and shifts slowly.",
  "Warm low drones with a floating melody above.",
  "A quiet, spacious ending-like feel with long silences between notes.",
];

export function songPrompt(idea: string, n: number): string {
  return [
    `Instrumental only: no vocals, no singing, no spoken words. ${idea.trim()}.`,
    "A calm, seamless ambient piece for relaxation and long listening, about three minutes long, with a gentle start and a soft fade-out and no sudden loud moments.",
    VARIATIONS[n % VARIATIONS.length],
  ].join(" ");
}

async function generateSong(idea: string, n: number): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(LYRIA_MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: songPrompt(idea, n) }] }],
      generationConfig: { responseModalities: ["AUDIO", "TEXT"] },
    }),
    signal: AbortSignal.timeout(200_000),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Lyria HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const data = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
  const audio = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData?.data && /audio/.test(p.inlineData.mimeType ?? ""));
  if (!audio?.inlineData?.data) throw new Error("Lyria returned no audio.");
  return Buffer.from(audio.inlineData.data, "base64");
}

/* ---------------- Job steps ---------------- */

async function save(db: SupabaseClient, row: SwapRow, state: AmbientState, extra: Partial<SwapRow> = {}) {
  Object.assign(row, extra, { fal: state as unknown as SwapRow["fal"] });
  await db.from("swap_jobs").update({ fal: state, ...extra, updated_at: new Date().toISOString() }).eq("id", row.id);
}

async function cleanupFiles(db: SupabaseClient, row: SwapRow, keepFinal = true) {
  const prefix = `${row.user_id}/ambient/${row.id}/`;
  try {
    const r2 = await import("@/lib/storage/r2");
    if (r2.r2Configured()) await r2.deleteR2Prefix(prefix, { keep: (k) => keepFinal && k.endsWith("/final.mp4") });
    else {
      const { data } = await db.storage.from("videos").list(prefix.slice(0, -1));
      const names = (data ?? []).map((f) => `${prefix}${f.name}`).filter((n) => !(keepFinal && n.endsWith("/final.mp4")));
      if (names.length) await db.storage.from("videos").remove(names);
    }
  } catch (err) {
    console.warn("[ambient] cleanup failed:", err instanceof Error ? err.message : err);
  }
}

async function stepMusic(db: SupabaseClient, row: SwapRow, state: AmbientState): Promise<void> {
  const idea = row.prompt || "Calm ambient music";
  const { storeMedia } = await import("@/lib/storage/media");
  const dir = await mkdtemp(path.join(tmpdir(), "amb-"));
  try {
    const todo: Array<Promise<void>> = [];
    // The cover picture first (cheap), in parallel with the first songs.
    if (!state.cover) {
      todo.push(
        (async () => {
          const { generateSceneImage } = await import("@/lib/pipeline/gemini-image");
          const img = await generateSceneImage(
            `${idea}. A wide, atmospheric, beautiful landscape or scene that suits calm music. Soft light, rich detail, no text, no letters, no people in close-up.`,
            `ambient-${row.id}`,
            row.user_id,
            1,
            "horizontal",
            "cinematic"
          );
          state.cover = img.imageUrl;
        })().catch((err) => {
          console.warn("[ambient] cover failed:", err instanceof Error ? err.message : err);
          state.fails += 1;
        })
      );
    }
    const want = Math.min(SONGS_PER_CALL, state.needed - state.tracks.length);
    const base = state.tracks.length + state.fails;
    for (let k = 0; k < want; k++) {
      todo.push(
        (async () => {
          const n = base + k;
          const mp3 = await generateSong(idea, n);
          const file = path.join(dir, `s${n}.mp3`);
          await writeFile(file, mp3);
          const seconds = await audioDuration(file);
          if (seconds < 20) throw new Error(`Song too short (${seconds}s)`);
          const key = `${row.user_id}/ambient/${row.id}/track-${n}.mp3`;
          const url = await storeMedia(db, key, mp3, "audio/mpeg");
          state.tracks.push({ key, url, seconds });
        })().catch((err) => {
          console.warn("[ambient] song failed:", err instanceof Error ? err.message : err);
          state.fails += 1;
        })
      );
    }
    await Promise.all(todo);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  const enough = state.tracks.length >= state.needed || (state.fails >= state.needed + 4 && state.tracks.length >= 2);
  if (state.fails >= state.needed + 6 && state.tracks.length < 2) throw new Error("The music couldn't be made.");
  if (enough && state.cover) await save(db, row, state, { phase: "render" });
  else await save(db, row, state);
}

async function download(url: string, file: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function stepEncode(db: SupabaseClient, row: SwapRow, state: AmbientState): Promise<SwapRow | void> {
  const durations = state.tracks.map((t) => t.seconds);
  const order = buildPlaylist(durations, state.total, row.id);
  const chunks = chunkPlaylist(order, durations, state.total, AMBIENT_CHUNK_MINUTES * 60);
  const k = state.parts.length;
  const chunk = chunks[k];
  if (!chunk) throw new Error("Nothing left to assemble.");
  const last = k === chunks.length - 1;
  const { storeMedia } = await import("@/lib/storage/media");
  const dir = await mkdtemp(path.join(tmpdir(), "amb-"));
  try {
    const bin = await ffmpegPath();
    const cover = path.join(dir, "cover.jpg");
    await download(state.cover!, cover);
    const files: string[] = [];
    for (let i = 0; i < state.tracks.length; i++) {
      files[i] = path.join(dir, `t${i}.mp3`);
      if (chunk.items.includes(i)) await download(state.tracks[i].url, files[i]);
    }
    const args = ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "2", "-i", cover];
    const filters: string[] = ["[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p[v]"];
    const labels: string[] = [];
    chunk.items.forEach((trackIdx, j) => {
      args.push("-i", files[trackIdx]);
      const len = durations[trackIdx];
      filters.push(`[${j + 1}:a]afade=t=in:d=${FADE_SECONDS},afade=t=out:st=${Math.max(0, len - FADE_SECONDS).toFixed(2)}:d=${FADE_SECONDS}[a${j}]`);
      labels.push(`[a${j}]`);
    });
    const tail = last ? `,afade=t=out:st=${Math.max(0, chunk.seconds - 6).toFixed(2)}:d=6` : "";
    filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1${tail}[aout]`);
    const out = path.join(dir, "out.mp4");
    args.push(
      "-filter_complex", filters.join(";"),
      "-map", "[v]", "-map", "[aout]",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-crf", "32", "-g", "60",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-t", chunk.seconds.toFixed(2), "-movflags", "+faststart", out
    );
    await run(bin, args, FFMPEG_TIMEOUT_MS);

    const base = `${row.user_id}/ambient/${row.id}`;
    if (chunks.length === 1) {
      const url = await storeMedia(db, `${base}/final.mp4`, await readFile(out), "video/mp4");
      return await finish(db, row, state, url);
    }
    const partKey = `${base}/part-${k}.mp4`;
    const partUrl = await storeMedia(db, partKey, await readFile(out), "video/mp4");
    state.parts.push({ key: partKey, url: partUrl });
    if (!last) {
      await save(db, row, state);
      return;
    }
    // Last part done: join the parts without re-encoding.
    const list: string[] = [];
    for (let i = 0; i < state.parts.length; i++) {
      const f = path.join(dir, `p${i}.mp4`);
      if (i === state.parts.length - 1) await writeFile(f, await readFile(out));
      else await download(state.parts[i].url, f);
      list.push(`file '${f.replace(/'/g, "'\\''")}'`);
    }
    await writeFile(path.join(dir, "list.txt"), list.join("\n"));
    const joined = path.join(dir, "final.mp4");
    await run(bin, ["-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-c", "copy", "-movflags", "+faststart", joined], 120_000);
    const url = await storeMedia(db, `${base}/final.mp4`, await readFile(joined), "video/mp4");
    return await finish(db, row, state, url);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function finish(db: SupabaseClient, row: SwapRow, state: AmbientState, url: string): Promise<SwapRow> {
  const idea = row.prompt || "Ambient music";
  const title = (idea.length > 70 ? `${idea.slice(0, 67)}…` : idea).replace(/^./, (c) => c.toUpperCase());
  const { data: project } = await db
    .from("projects")
    .insert({
      user_id: row.user_id,
      title,
      platform: "YouTube Long-form",
      style: "Ambient music video",
      duration: `${state.minutes} minutes`,
      idea,
      status: "draft",
      content: {
        titles: [title],
        description: `${idea}\n\nThe music in this video was generated with AI.`,
        tags: [],
        finalVideoUrl: url,
        thumbnailUrl: state.cover ?? undefined,
        ambient: { minutes: state.minutes, songs: state.tracks.length },
      },
    })
    .select("id")
    .single();
  await save(db, row, state, { phase: "done", status: "completed", output_url: url, project_id: project?.id ?? null, render_id: null });
  await cleanupFiles(db, row);
  const { logSwapUsage } = await import("@/lib/creative-usage");
  await logSwapUsage(db, row, "ok");
  return row;
}

/** Claim the right to run one phase of this job (6-minute lease kept in `render_id`). */
async function claim(db: SupabaseClient, row: SwapRow): Promise<boolean> {
  const now = new Date();
  const stale = `lease:${new Date(now.getTime() - LEASE_MS).toISOString()}`;
  const { data } = await db
    .from("swap_jobs")
    .update({ render_id: `lease:${now.toISOString()}` })
    .eq("id", row.id)
    .eq("status", "running")
    .or(`render_id.is.null,render_id.lt.${stale}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

/** Move an ambient job one phase along. `fail` ends it with a refund (lib/swap/swap.ts). */
export async function advanceAmbientJob(db: SupabaseClient, row: SwapRow, fail: (message: string) => Promise<void>): Promise<SwapRow> {
  if (row.status !== "running") return row;
  if (Date.now() - Date.parse(row.created_at) > JOB_TIMEOUT_MS) {
    await fail("This took too long. Your credits were refunded.");
    return row;
  }
  if (!(await claim(db, row))) return row;
  const state = readState(row);
  try {
    if (row.phase === "swap" || (row.phase as string) === "music") await stepMusic(db, row, state);
    else if (row.phase === "render") await stepEncode(db, row, state);
  } catch (err) {
    console.error(`[ambient] ${row.id} ${row.phase} failed:`, err);
    // One more try after a pause (the lease), then give up with a refund.
    state.fails += 1;
    if (state.fails >= 8 || row.phase === "render") {
      const again = (row as SwapRow & { _retried?: boolean })._retried;
      if (row.phase === "render" && !again && state.fails < 8) {
        await save(db, row, state);
      } else {
        await fail("The video couldn't be made. Your credits were refunded.");
        await cleanupFiles(db, row, false);
        return row;
      }
    } else {
      await save(db, row, state);
    }
  }
  if (row.status === "running") await db.from("swap_jobs").update({ render_id: null }).eq("id", row.id);
  return row;
}
