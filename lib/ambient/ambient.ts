// lib/ambient/ambient.ts
// Ambient music video (10 Nov 2026, Yağmur — "uzun olsun, en uygun maliyetle, %65 kâr, tekrar render yok").
// One idea → a few calm songs (Google Lyria 3 Pro) + 10–16 different pictures (Nano Banana) → a long
// 1080p MP4 of 10 / 30 / 60 / 120 minutes: a shuffled loop of the songs with soft fades, while the
// pictures take turns (a minute each, slow camera drift, floating light specks, fade between them).
// Assembled with ffmpeg on our own server (no Shotstack): every picture becomes one 60-second
// segment, encoded once; the final file repeats the segments without re-encoding and is streamed
// straight into R2 (a two-hour video never touches the disk).
// Stored in swap_jobs with kind = "ambient"; progress state in the `fal` jsonb column; the
// `render_id` column is a short-lived lease so two workers never run the same phase.
//
// Steps (state.step; a time-boxed slice per call of advanceAmbientJob):
//   music (songs + scene list) → scenes (pictures) → segments → audio → final → done.

import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SwapRow } from "@/lib/swap/swap";
import { AMBIENT_MINUTES, AMBIENT_SCENE_SECONDS, ambientScenesFor, ambientTracksFor } from "@/lib/skit/pricing";
import { buildPlaylist } from "./playlist";

export { ambientCreditsFor as ambientCredits } from "@/lib/skit/pricing";
export const AMBIENT_MAX_CHARS = 400;
export const LYRIA_MODEL = process.env.LYRIA_MODEL || "lyria-3-pro-preview";
const LEASE_MS = 6 * 60_000;
const JOB_TIMEOUT_MS = 90 * 60_000;
const FFMPEG_TIMEOUT_MS = 270_000;
/** Songs asked for per call (each is a ~1–2 minute request). */
const SONGS_PER_CALL = 4;
const FADE_SECONDS = 2.5;
/** Work on segments / pictures stops being started after this long in one call. */
const SLICE_MS = 170_000;
const FPS = 15;
const W = 1920;
const H = 1080;

export function isAmbientMinutes(n: unknown): n is (typeof AMBIENT_MINUTES)[number] {
  return AMBIENT_MINUTES.includes(n as 10 | 30 | 60 | 120);
}

export type AmbientStep = "music" | "scenes" | "segments" | "audio" | "final";

export interface AmbientState {
  minutes: number;
  step: AmbientStep;
  tracks: Array<{ key: string; url: string; seconds: number }>;
  needed: number;
  fails: number;
  /** One picture prompt per scene, then the pictures and their encoded segments (same order). */
  scenePrompts: string[];
  scenes: Array<string | null>;
  segments: Array<string | null>;
  scenesNeeded: number;
  audio: string | null;
  cover: string | null;
  total: number;
}

export function readState(row: SwapRow): AmbientState {
  const s = (row.fal ?? {}) as unknown as Partial<AmbientState>;
  const minutes = s.minutes ?? 10;
  return {
    minutes,
    step: s.step ?? "music",
    tracks: s.tracks ?? [],
    needed: s.needed ?? ambientTracksFor(minutes),
    fails: s.fails ?? 0,
    scenePrompts: s.scenePrompts ?? [],
    scenes: s.scenes ?? [],
    segments: s.segments ?? [],
    scenesNeeded: s.scenesNeeded ?? ambientScenesFor(minutes),
    audio: s.audio ?? null,
    cover: s.cover ?? null,
    total: s.total ?? minutes * 60,
  };
}

export function initialState(minutes: number): AmbientState {
  return readState({ fal: { minutes } } as unknown as SwapRow);
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

export async function generateSong(idea: string, n: number): Promise<Buffer> {
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

/* ---------------- Scenes ---------------- */

const SCENE_FALLBACKS = [
  "A wide establishing landscape of the place at dusk, layers of mist, soft light.",
  "An extreme close-up portrait of a person who belongs to this world, calm eyes looking at the camera, detailed traditional clothing and ornaments.",
  "A close-up of the instruments and ritual objects of this world resting on cloth or stone, shallow depth of field.",
  "A lone figure seen from behind on a ridge, looking over a vast valley under a dramatic sky.",
  "The night sky full of stars over the landscape, a small warm light far below.",
  "A quiet forest or shore at dawn with fog between the trees and still water.",
  "A person sitting calmly beside a gentle animal that belongs to this world, soft overcast light.",
  "A fire or lantern in the foreground with glowing sparks, the dark landscape behind it.",
  "A high aerial view of rivers, mountains or plains fading into haze.",
  "A profile portrait in falling snow or drifting dust, soft rim light.",
  "An old dwelling or sacred place of this world at blue hour, smoke rising, warm windows.",
  "Hands playing an instrument of this world in warm light, close up.",
  "A winding path leading into mountains under moving clouds.",
  "A figure walking through tall grass or snow toward distant light.",
  "Standing stones, totems or carvings of this world in mist.",
  "Sunrise breaking over the horizon, long golden light across the land.",
];

async function writeScenePrompts(idea: string, n: number): Promise<string[]> {
  try {
    const { chatJSON } = await import("@/lib/pipeline/llm");
    const out = await chatJSON<{ scenes?: unknown }>({
      model: process.env.AMBIENT_SCENE_MODEL || "gemini:gemini-3.8-flash",
      system:
        "You plan the pictures for a long relaxing music video. Return JSON {\"scenes\": string[]}. Each scene is one English image prompt of 25-45 words for a photorealistic, cinematic 16:9 picture. All scenes belong to one consistent world and mood that fits the music, but each shows something different: mix wide landscapes, intimate close-up portraits (adults only, invented people), details of instruments and objects, animals, skies, dwellings, different times of day and weather. No text, no logos, no real named people, nothing violent or frightening.",
      user: `Music and world: ${idea}\nWrite exactly ${n} scenes. Start with the strongest, most striking picture (it is also the cover).`,
      timeoutMs: 60_000,
    });
    const list = Array.isArray(out.data.scenes) ? out.data.scenes.filter((x): x is string => typeof x === "string" && x.trim().length > 20).map((x) => x.trim().slice(0, 500)) : [];
    if (list.length >= Math.min(n, 6)) return Array.from({ length: n }, (_, i) => list[i % list.length]);
  } catch (err) {
    console.warn("[ambient] scene list failed:", err instanceof Error ? err.message : err);
  }
  return Array.from({ length: n }, (_, i) => `${idea}. ${SCENE_FALLBACKS[i % SCENE_FALLBACKS.length]}`);
}

/** A see-through layer of soft warm specks; scrolled slowly over every scene (embers, snow, dust). */
async function specksPng(file: string, seed: number, count: number): Promise<void> {
  const sharp = (await import("sharp")).default;
  let s = (seed % 2147483646) + 1;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let c = "";
  for (let i = 0; i < count; i++) {
    c += `<circle cx="${(r() * W).toFixed(1)}" cy="${(r() * H).toFixed(1)}" r="${(1 + r() * 3.2).toFixed(1)}" fill="#ffe8c4" fill-opacity="${(0.2 + r() * 0.5).toFixed(2)}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="b"><feGaussianBlur stdDeviation="1.3"/></filter></defs><g filter="url(#b)">${c}</g></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}

/* ---------------- Job steps ---------------- */

async function save(db: SupabaseClient, row: SwapRow, state: AmbientState, extra: Partial<SwapRow> = {}) {
  Object.assign(row, extra, { fal: state as unknown as SwapRow["fal"] });
  await db.from("swap_jobs").update({ fal: state, ...extra, updated_at: new Date().toISOString() }).eq("id", row.id);
}

const baseKey = (row: SwapRow) => `${row.user_id}/ambient/${row.id}`;

async function cleanupFiles(row: SwapRow, keepFinal = true) {
  try {
    const r2 = await import("@/lib/storage/r2");
    await r2.deleteR2Prefix(`${baseKey(row)}/`, { keep: (k) => keepFinal && (k.endsWith("/final.mp4") || k.endsWith("/cover.jpg")) });
  } catch (err) {
    console.warn("[ambient] cleanup failed:", err instanceof Error ? err.message : err);
  }
}

async function download(url: string, file: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function stepMusic(db: SupabaseClient, row: SwapRow, state: AmbientState): Promise<void> {
  const idea = row.prompt || "Calm ambient music";
  const { storeMedia } = await import("@/lib/storage/media");
  const dir = await mkdtemp(path.join(tmpdir(), "amb-"));
  try {
    const todo: Array<Promise<void>> = [];
    if (!state.scenePrompts.length) {
      todo.push(
        writeScenePrompts(idea, state.scenesNeeded).then((list) => {
          state.scenePrompts = list;
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
          const key = `${baseKey(row)}/track-${n}.mp3`;
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
  if (state.fails >= state.needed + 6 && state.tracks.length < 2) throw new Error("The music couldn't be made.");
  const enough = state.tracks.length >= state.needed || (state.fails >= state.needed + 4 && state.tracks.length >= 2);
  if (enough && state.scenePrompts.length) state.step = "scenes";
  await save(db, row, state);
}

async function stepScenes(db: SupabaseClient, row: SwapRow, state: AmbientState): Promise<void> {
  const { generateSceneImage } = await import("@/lib/pipeline/gemini-image");
  const started = Date.now();
  const missing = () => state.scenePrompts.map((_, i) => i).filter((i) => !state.scenes[i]);
  let imageFails = 0;
  while (missing().length && Date.now() - started < SLICE_MS && imageFails < 6) {
    const batch = missing().slice(0, 4);
    await Promise.all(
      batch.map(async (i) => {
        try {
          const img = await generateSceneImage(
            `${state.scenePrompts[i]} Photorealistic, cinematic, rich detail, soft natural light. No text, no letters, no watermark.`,
            `ambient-${row.id}`,
            row.user_id,
            i + 1 + state.fails * 100,
            "horizontal",
            "cinematic"
          );
          state.scenes[i] = img.imageUrl;
        } catch (err) {
          console.warn("[ambient] picture failed:", err instanceof Error ? err.message : err);
          imageFails += 1;
        }
      })
    );
  }
  const have = state.scenes.filter(Boolean).length;
  if (missing().length && imageFails >= 6) {
    state.fails += 2;
    // Enough pictures to carry the video: go on with the ones we have.
    if (have >= Math.max(3, Math.ceil(state.scenesNeeded / 2)) && state.fails >= 6) {
      const keep = state.scenes.map((u, i) => (u ? i : -1)).filter((i) => i >= 0);
      state.scenes = keep.map((i) => state.scenes[i]);
      state.scenePrompts = keep.map((i) => state.scenePrompts[i]);
    } else if (state.fails >= 10) throw new Error("The pictures couldn't be made.");
  }
  if (!missing().length) {
    state.cover = state.scenes[0];
    state.step = "segments";
  }
  await save(db, row, state);
}

/** One picture → one 60-second segment: slow drift, floating specks, fade in and out. */
async function stepSegments(db: SupabaseClient, row: SwapRow, state: AmbientState): Promise<void> {
  const { storeMedia } = await import("@/lib/storage/media");
  const sharp = (await import("sharp")).default;
  const bin = await ffmpegPath();
  const started = Date.now();
  const dir = await mkdtemp(path.join(tmpdir(), "amb-"));
  try {
    const specks = path.join(dir, "specks.png");
    const specks2 = path.join(dir, "specks2.png");
    await specksPng(specks, 7, 170);
    await specksPng(specks2, 99, 70);
    const len = AMBIENT_SCENE_SECONDS;
    for (let i = 0; i < state.scenes.length; i++) {
      if (state.segments[i]) continue;
      if (Date.now() - started > SLICE_MS) break;
      const raw = path.join(dir, `raw-${i}`);
      const pic = path.join(dir, `pic-${i}.png`);
      await download(state.scenes[i]!, raw);
      // 10% larger than the frame, so the camera has room to drift.
      await sharp(raw).resize(Math.round(W * 1.1), Math.round(H * 1.1), { fit: "cover" }).png({ compressionLevel: 1 }).toFile(pic);
      const mx = Math.round(W * 0.05);
      const my = Math.round(H * 0.05);
      // Each scene drifts along its own slow path.
      const px = 31 + (i % 5) * 4;
      const py = 43 + (i % 4) * 5;
      const ph = (i * 1.7).toFixed(2);
      const out = path.join(dir, `seg-${i}.mp4`);
      await run(
        bin,
        [
          "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
          "-loop", "1", "-framerate", String(FPS), "-i", pic,
          "-loop", "1", "-framerate", String(FPS), "-i", specks,
          "-loop", "1", "-framerate", String(FPS), "-i", specks2,
          "-filter_complex",
          [
            `[0]crop=${W}:${H}:'${mx}+${mx - 4}*sin(t/${px}+${ph})':'${my}+${my - 4}*cos(t/${py}+${ph})'[bg]`,
            `[1]scroll=vertical=-0.0016:horizontal=0.0004,format=rgba[s1]`,
            `[2]scroll=vertical=-0.0032:horizontal=-0.0007,format=rgba[s2]`,
            `[bg][s1]overlay=format=auto[b1]`,
            `[b1][s2]overlay=format=auto,fade=t=in:d=1.5,fade=t=out:st=${len - 1.5}:d=1.5,format=yuv420p[v]`,
          ].join(";"),
          "-map", "[v]", "-t", String(len), "-r", String(FPS),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "25", "-maxrate", "2500k", "-bufsize", "5000k",
          "-g", String(FPS * 4), "-video_track_timescale", "15360", out,
        ],
        FFMPEG_TIMEOUT_MS
      );
      state.segments[i] = await storeMedia(db, `${baseKey(row)}/seg-${i}.mp4`, await readFile(out), "video/mp4");
      await rm(out, { force: true });
      await rm(pic, { force: true });
      await rm(raw, { force: true });
      await save(db, row, state);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  if (state.scenes.every((_, i) => state.segments[i])) state.step = "audio";
  await save(db, row, state);
}

/** The whole soundtrack as one AAC file: the shuffled songs with soft fades between them. */
async function stepAudio(db: SupabaseClient, row: SwapRow, state: AmbientState): Promise<void> {
  const durations = state.tracks.map((t) => t.seconds);
  const order = buildPlaylist(durations, state.total, row.id);
  const dir = await mkdtemp(path.join(tmpdir(), "amb-"));
  try {
    const bin = await ffmpegPath();
    const args = ["-y", "-nostdin", "-hide_banner", "-loglevel", "error"];
    await Promise.all(state.tracks.map((t, i) => download(t.url, path.join(dir, `t${i}.mp3`))));
    const filters: string[] = [];
    const labels: string[] = [];
    order.forEach((trackIdx, j) => {
      args.push("-i", path.join(dir, `t${trackIdx}.mp3`));
      const len = durations[trackIdx];
      filters.push(`[${j}:a]aresample=44100,aformat=channel_layouts=stereo,afade=t=in:d=${FADE_SECONDS},afade=t=out:st=${Math.max(0, len - FADE_SECONDS).toFixed(2)}:d=${FADE_SECONDS}[a${j}]`);
      labels.push(`[a${j}]`);
    });
    filters.push(`${labels.join("")}concat=n=${labels.length}:v=0:a=1,afade=t=out:st=${Math.max(0, state.total - 6)}:d=6[aout]`);
    const out = path.join(dir, "audio.m4a");
    args.push("-filter_complex", filters.join(";"), "-map", "[aout]", "-c:a", "aac", "-b:a", "160k", "-t", String(state.total), out);
    await run(bin, args, FFMPEG_TIMEOUT_MS);
    const r2 = await import("@/lib/storage/r2");
    const key = `${baseKey(row)}/audio.m4a`;
    await r2.uploadStreamToR2(key, (await import("node:fs")).createReadStream(out), "audio/mp4");
    state.audio = key;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  state.step = "final";
  await save(db, row, state);
}

/** Repeat the segments for the whole length under the soundtrack (no re-encoding), streamed into R2. */
async function stepFinal(db: SupabaseClient, row: SwapRow, state: AmbientState): Promise<SwapRow> {
  const r2 = await import("@/lib/storage/r2");
  const dir = await mkdtemp(path.join(tmpdir(), "amb-"));
  try {
    const bin = await ffmpegPath();
    const n = state.segments.length;
    await Promise.all(state.segments.map((u, i) => download(u!, path.join(dir, `seg-${i}.mp4`))));
    const audio = path.join(dir, "audio.m4a");
    await download(await r2.signedR2Url(state.audio!), audio);
    const slots = Math.ceil(state.total / AMBIENT_SCENE_SECONDS);
    const list = Array.from({ length: slots }, (_, k) => `file '${path.join(dir, `seg-${k % n}.mp4`)}'`);
    await writeFile(path.join(dir, "list.txt"), list.join("\n"));
    const key = `${baseKey(row)}/final.mp4`;
    const child = spawn(
      bin,
      [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"),
        "-i", audio,
        "-map", "0:v", "-map", "1:a", "-c", "copy", "-t", String(state.total),
        "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "8000000",
        "-f", "mp4", "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let err = "";
    child.stderr.on("data", (d) => {
      err = (err + String(d)).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), FFMPEG_TIMEOUT_MS);
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    try {
      await r2.uploadStreamToR2(key, child.stdout, "video/mp4");
    } finally {
      clearTimeout(timer);
    }
    const code = await exited;
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.slice(-400)}`);
    return await finish(db, row, state, r2.r2PublicUrl(key));
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
        description: `${idea}\n\nThe music and pictures in this video were generated with AI.`,
        tags: [],
        finalVideoUrl: url,
        thumbnailUrl: state.cover ?? undefined,
        ambient: { minutes: state.minutes, songs: state.tracks.length, scenes: state.scenes.length },
      },
    })
    .select("id")
    .single();
  await save(db, row, state, { phase: "done", status: "completed", output_url: url, project_id: project?.id ?? null, render_id: null });
  await cleanupFiles(row);
  const { logSwapUsage } = await import("@/lib/creative-usage");
  await logSwapUsage(db, row, "ok");
  return row;
}

/** Claim the right to run one step of this job (6-minute lease kept in `render_id`). */
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

/** Move an ambient job one step along. `fail` ends it with a refund (lib/swap/swap.ts). */
export async function advanceAmbientJob(db: SupabaseClient, row: SwapRow, fail: (message: string) => Promise<void>): Promise<SwapRow> {
  if (row.status !== "running") return row;
  if (Date.now() - Date.parse(row.created_at) > JOB_TIMEOUT_MS) {
    await fail("This took too long. Your credits were refunded.");
    await cleanupFiles(row, false);
    return row;
  }
  if (!(await claim(db, row))) return row;
  const state = readState(row);
  try {
    const r2 = await import("@/lib/storage/r2");
    if (!r2.r2Configured()) throw new Error("Video storage is not configured.");
    if (state.step === "music") await stepMusic(db, row, state);
    else if (state.step === "scenes") await stepScenes(db, row, state);
    else if (state.step === "segments") await stepSegments(db, row, state);
    else if (state.step === "audio") await stepAudio(db, row, state);
    else await stepFinal(db, row, state);
  } catch (err) {
    console.error(`[ambient] ${row.id} ${state.step} failed:`, err);
    state.fails += 2;
    if (state.fails >= 12) {
      await fail("The video couldn't be made. Your credits were refunded.");
      await cleanupFiles(row, false);
      return row;
    }
    await save(db, row, state);
  }
  if (row.status === "running") await db.from("swap_jobs").update({ render_id: null }).eq("id", row.id);
  return row;
}
