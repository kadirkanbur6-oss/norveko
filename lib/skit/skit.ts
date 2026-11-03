// lib/skit/skit.ts
// Skits (3 Nov 2026, Kadir — "I write the joke, the site adapts it, like the
// viral cockroach videos"): a short scene with dialogue. The creator pastes a
// joke or script (+ optional "make it like …" style); an LLM turns it into a
// cast and a shot list, then every shot gets its own picture (characters drawn
// from generated reference portraits), speaking shots get the line in that
// character's voice and a lip-sync (VEED Fabric), silent shots a short
// image→video clip (Seedance), crowd reactions a sound effect (ElevenLabs),
// and Shotstack cuts it together.
//
// Table skit_jobs (SQL in supabase/README.md). Work happens in small steps
// (advanceSkitJob) driven by the /api/skit poll and the minute heartbeat; a
// lease (lease_until) keeps two callers from doing the same step.

import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_COST_PER_SECOND, RENDER_CREDITS_PER_30S, creditsForCost } from "@/lib/pipeline/steps";
import { wordsPerSecond } from "@/lib/pipeline/narration";

export const SKIT_MAX_SHOTS = 8;
export const SKIT_MAX_CHARACTERS = 4;
export const SKIT_MAX_SECONDS = 45;
export const SKIT_MAX_SCRIPT = 1500;
export const SKIT_LOOKS = ["3d", "anime", "cinematic", "painting", "comic"] as const;
const IMAGE_COST = 0.04;
const CLIP_COST = 0.13;
const SFX_COST = 0.03;
const PLAN_COST = 0.03;
const ANIMATE_TIMEOUT_MS = 25 * 60 * 1000;
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;
const LEASE_MS = 100_000;

export interface SkitCharacter {
  id: string;
  name: string;
  look: string;
  voice: string; // Gemini voice name
  refPath?: string;
}

export interface SkitShot {
  id: string;
  setting: string;
  camera: "wide" | "medium" | "close-up";
  visible: string[];
  speaker: string | null;
  line: string;
  tone: string;
  action: string;
  sfx: string;
  seconds: number;
  // Filled while it is made:
  imageUrl?: string;
  audioUrl?: string;
  audioSeconds?: number;
  sfxUrl?: string;
  fal?: { requestId: string; statusUrl: string; responseUrl: string } | null;
  clipUrl?: string | null;
  clipFailed?: boolean;
}

export interface SkitPlan {
  title: string;
  language: string; // ISO code
  look: (typeof SKIT_LOOKS)[number];
  characters: SkitCharacter[];
  shots: SkitShot[];
}

export interface SkitRow {
  id: string;
  user_id: string;
  billed_to: string | null;
  status: "running" | "completed" | "failed";
  phase: "cast" | "shots" | "animate" | "render" | "done";
  script: string;
  plan: SkitPlan;
  vertical: boolean;
  credits: number;
  refunded: boolean;
  render_id: string | null;
  output_url: string | null;
  project_id: string | null;
  error: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

/* ---------------- Planning ---------------- */

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export async function planSkit(script: string, voices: Array<{ name: string; style: string; gender: string }>): Promise<SkitPlan> {
  const { chatJSON, SCRIPT_MODEL } = await import("@/lib/pipeline/llm");
  const { data } = await chatJSON<Record<string, unknown>>({
    model: SCRIPT_MODEL,
    system: `You turn a creator's joke or script into a short animated skit for TikTok/Reels/Shorts: a cast and a shot list. Answer with JSON only.

Rules:
- Keep every spoken line the creator wrote, word for word, in its original language (you may fix punctuation). Do not add new jokes or new dialogue, except at most one very short reaction line if the script clearly implies one.
- Narration in the script ("after a long silence…", "applause, cheers…") is NOT spoken: turn it into a silent shot (a pause, a reaction) and/or a sound effect.
- If the creator asks for a style ("like the viral cockroach videos", "as cats", "anime"), EVERY character becomes that: e.g. Pixar-style 3D cartoon cockroaches with human clothes in human settings. Without a style ask, use friendly Pixar-style 3D cartoon characters.
- Real, named people become clearly cartoon caricatures of that species, recognisable only through clothes, hairstyle and props. Never put a real person's name in "look" or "setting" — describe what they wear instead. Character "name" may be a short role label in the script's language (e.g. "Başkan", "Gazeteci").
- At most ${SKIT_MAX_CHARACTERS} characters and ${SKIT_MAX_SHOTS} shots, total under ${SKIT_MAX_SECONDS} seconds. Vary the camera (wide establishing shot first, close-ups for punchlines, a wide crowd shot for reactions).
- "setting" must fully describe the place in every shot (each picture is drawn on its own), in English. Keep the same place consistent across shots that happen there.
- "look" is a consistent English visual description: species/type, colours, clothing, props, size. Crowds and extras are described in "setting", not as characters.
- Pick a voice for each speaking character from this list (match gender and personality): ${voices.map((v) => `${v.name} (${v.gender}, ${v.style})`).join("; ")}.

JSON shape:
{"title": string (short, in the script's language),
 "language": ISO 639-1 code of the dialogue,
 "look": one of ${SKIT_LOOKS.join("|")},
 "characters": [{"id":"c1","name":string,"look":string,"voice":string}],
 "shots": [{"setting":string,"camera":"wide|medium|close-up","visible":["c1"],"speaker":"c1" or null,"line":string (exact spoken text, "" if silent),"tone":string (English, how the line is said: "proud, booming", "confused, hesitant"…),"action":string (English: what happens on screen),"sfx":string (English sound effect for this shot, e.g. "large crowd applauding and cheering", or ""),"seconds":number (2-4, only used for silent shots)}]}`,
    user: script.slice(0, SKIT_MAX_SCRIPT),
    timeoutMs: 90_000,
  });

  const voiceNames = new Set(voices.map((v) => v.name));
  const characters: SkitCharacter[] = (Array.isArray(data.characters) ? data.characters : [])
    .slice(0, SKIT_MAX_CHARACTERS)
    .map((c, i) => {
      const r = c as Record<string, unknown>;
      const voice = clean(r.voice, 30);
      return {
        id: clean(r.id, 10) || `c${i + 1}`,
        name: clean(r.name, 40) || `Character ${i + 1}`,
        look: clean(r.look, 400),
        voice: voiceNames.has(voice) ? voice : voices[i % voices.length].name,
      };
    })
    .filter((c) => c.look);
  if (!characters.length) throw new Error("The script couldn't be turned into a scene. Add who is speaking.");
  const ids = new Set(characters.map((c) => c.id));
  const shots: SkitShot[] = (Array.isArray(data.shots) ? data.shots : []).slice(0, SKIT_MAX_SHOTS).map((s, i) => {
    const r = s as Record<string, unknown>;
    const speaker = typeof r.speaker === "string" && ids.has(r.speaker) ? r.speaker : null;
    const line = speaker ? clean(r.line, 400) : "";
    const camera = r.camera === "wide" || r.camera === "close-up" ? r.camera : "medium";
    const visible = (Array.isArray(r.visible) ? r.visible : []).filter((v): v is string => typeof v === "string" && ids.has(v));
    return {
      id: `s${i + 1}`,
      setting: clean(r.setting, 500),
      camera,
      visible: speaker && !visible.includes(speaker) ? [speaker, ...visible] : visible,
      speaker: line ? speaker : null,
      line,
      tone: clean(r.tone, 120),
      action: clean(r.action, 300),
      sfx: clean(r.sfx, 200),
      seconds: Math.min(4, Math.max(2, Number(r.seconds) || 2.5)),
    };
  });
  if (!shots.some((s) => s.line)) throw new Error("No spoken lines were found. Write the dialogue lines in the script.");
  const look = SKIT_LOOKS.includes(data.look as (typeof SKIT_LOOKS)[number]) ? (data.look as SkitPlan["look"]) : "3d";
  return { title: clean(data.title, 80) || "Skit", language: clean(data.language, 5).toLowerCase() || "en", look, characters, shots };
}

/** Seconds the finished skit will roughly last (speaking shots from word count). */
export function estimateSeconds(plan: SkitPlan): { speaking: number; total: number } {
  const wps = wordsPerSecond(plan.language);
  let speaking = 0;
  let total = 0;
  for (const s of plan.shots) {
    if (s.line) {
      const sec = s.line.split(/\s+/).length / wps + 0.4;
      speaking += sec;
      total += sec;
    } else total += s.seconds;
  }
  return { speaking, total };
}

export function skitCredits(plan: SkitPlan): number {
  const { speaking, total } = estimateSeconds(plan);
  const silent = plan.shots.filter((s) => !s.line).length;
  const sfx = plan.shots.filter((s) => s.sfx).length;
  const usd =
    PLAN_COST +
    IMAGE_COST * (plan.characters.length + plan.shots.length) +
    Math.ceil(speaking * 1.15) * AVATAR_COST_PER_SECOND + // 15 % headroom: voices run a bit long
    silent * CLIP_COST +
    sfx * SFX_COST;
  return creditsForCost(usd) + RENDER_CREDITS_PER_30S * Math.max(1, Math.ceil(total / 30));
}

/* ---------------- Making it ---------------- */

const publicUrl = (db: SupabaseClient, path: string) => db.storage.from("videos").getPublicUrl(path).data.publicUrl;

async function save(db: SupabaseClient, row: SkitRow, values: Partial<SkitRow>) {
  Object.assign(row, values);
  await db.from("skit_jobs").update({ ...values, updated_at: new Date().toISOString() }).eq("id", row.id);
}

async function fail(db: SupabaseClient, row: SkitRow, message: string) {
  const { data } = await db
    .from("skit_jobs")
    .update({ status: "failed", error: message, refunded: true, lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "running")
    .eq("refunded", false)
    .select("id")
    .maybeSingle();
  Object.assign(row, { status: "failed", error: message });
  if (data && row.credits > 0) {
    await db.rpc("add_credits", { p_user_id: row.billed_to ?? row.user_id, p_amount: row.credits, p_type: "refund", p_reason: "Refund: skit failed" });
  }
}

async function claim(db: SupabaseClient, row: SkitRow): Promise<boolean> {
  const now = new Date();
  const { data } = await db
    .from("skit_jobs")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", row.id)
    .eq("status", "running")
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

async function settled<T>(items: T[], fn: (item: T) => Promise<void>) {
  const results = await Promise.allSettled(items.map(fn));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
}

async function charRefs(db: SupabaseClient, plan: SkitPlan, ids: string[]) {
  const refs = [];
  for (const c of plan.characters.filter((x) => ids.includes(x.id) && x.refPath)) {
    const { data } = await db.storage.from("videos").download(c.refPath!);
    if (!data) continue;
    refs.push({ name: c.name, description: c.look, images: [{ mimeType: data.type || "image/png", data: Buffer.from(await data.arrayBuffer()).toString("base64") }] });
  }
  return refs;
}

function shotPrompt(plan: SkitPlan, s: SkitShot): string {
  const who = s.visible
    .map((id) => plan.characters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `${c!.name} (${c!.look})`)
    .join("; ");
  const framing = s.camera === "wide" ? "Wide shot" : s.camera === "close-up" ? "Close-up" : "Medium shot";
  const speaker = s.speaker ? plan.characters.find((c) => c.id === s.speaker) : null;
  return `${framing}. ${s.setting}. ${who ? `On screen: ${who}.` : ""} ${s.action}${
    speaker ? ` ${speaker.name} faces the camera with the face large and clearly visible, mouth slightly open as if speaking.` : ""
  } Expressive, funny, viral short-video look.`;
}

async function stepCast(db: SupabaseClient, row: SkitRow) {
  const { generateReferencePortrait } = await import("@/lib/pipeline/gemini-image");
  await settled(
    row.plan.characters.filter((c) => !c.refPath),
    async (c) => {
      const img = await generateReferencePortrait({ name: c.name, description: `${c.look}. ${row.plan.look === "cinematic" ? "" : "Cartoon character, not a real human."}` });
      const path = `${row.user_id}/skit/${row.id}/char-${c.id}.${img.mimeType.includes("jpeg") ? "jpg" : "png"}`;
      const { error } = await db.storage.from("videos").upload(path, img.bytes, { contentType: img.mimeType, upsert: true });
      if (error) throw new Error(error.message);
      c.refPath = path;
    }
  );
  await save(db, row, { plan: row.plan, phase: "shots" });
}

async function stepShots(db: SupabaseClient, row: SkitRow) {
  const { generateSceneImage } = await import("@/lib/pipeline/gemini-image");
  const { synthesizeNarration } = await import("@/lib/pipeline/tts");
  const { generateSoundEffect } = await import("@/lib/pipeline/elevenlabs");
  const { audioSeconds } = await import("@/lib/talk/talk");
  const plan = row.plan;
  const jobs: Array<() => Promise<void>> = [];
  plan.shots.forEach((s, i) => {
    if (!s.imageUrl)
      jobs.push(async () => {
        const refs = await charRefs(db, plan, s.visible);
        const img = await generateSceneImage(shotPrompt(plan, s), `skit-${row.id}`, row.user_id, i + 1, row.vertical ? "vertical" : "horizontal", plan.look, refs);
        s.imageUrl = img.imageUrl;
      });
    if (s.line && !s.audioUrl)
      jobs.push(async () => {
        const c = plan.characters.find((x) => x.id === s.speaker)!;
        const speech = await synthesizeNarration(s.line, `gemini:${c.voice}`, {
          direction: `Perform this line as ${c.name}, a cartoon character in a comedy sketch, ${s.tone || "expressively"} — acted, not narrated. Say only the line`,
        });
        const path = `${row.user_id}/skit/${row.id}/line-${s.id}-${randomUUID().slice(0, 8)}.${speech.ext}`;
        const { error } = await db.storage.from("videos").upload(path, speech.audio, { contentType: speech.contentType, upsert: true });
        if (error) throw new Error(error.message);
        s.audioSeconds = Math.round(audioSeconds(speech.audio, speech.ext) * 100) / 100;
        s.audioUrl = publicUrl(db, path);
      });
    if (s.sfx && !s.sfxUrl)
      jobs.push(async () => {
        try {
          const audio = await generateSoundEffect(s.sfx, s.line ? undefined : Math.max(2, s.seconds + 1));
          const path = `${row.user_id}/skit/${row.id}/sfx-${s.id}.mp3`;
          await db.storage.from("videos").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
          s.sfxUrl = publicUrl(db, path);
        } catch (err) {
          console.warn(`[skit] ${row.id} sfx skipped:`, err instanceof Error ? err.message : err);
          s.sfx = ""; // a missing sound effect never stops the skit
        }
      });
  });
  await settled(jobs, (j) => j());
  await save(db, row, { plan, phase: "animate" });
}

function avatarPrompt(s: SkitShot): string {
  return `The speaking character talks with lively cartoon expressions, ${s.tone || "expressive"}, natural head and body movement. ${s.action}`.slice(0, 900);
}

async function stepAnimate(db: SupabaseClient, row: SkitRow): Promise<boolean> {
  const fv = await import("@/lib/pipeline/fal-video");
  const plan = row.plan;
  // Submit what hasn't been sent yet.
  await settled(
    plan.shots.filter((s) => !s.fal && !s.clipUrl && !s.clipFailed),
    async (s) => {
      try {
        s.fal = s.line
          ? await fv.submitAvatar({
              imageUrl: s.imageUrl!,
              audioUrl: s.audioUrl!,
              prompt: avatarPrompt(s),
            })
          : await fv.submitImageToVideo({ prompt: s.action || "subtle natural movement", imageUrl: s.imageUrl!, aspectRatio: row.vertical ? "9:16" : "16:9" });
      } catch (err) {
        console.warn(`[skit] ${row.id} ${s.id} submit failed:`, err instanceof Error ? err.message : err);
        s.clipFailed = true;
      }
    }
  );
  // Collect finished ones.
  await settled(
    plan.shots.filter((s) => s.fal && !s.clipUrl && !s.clipFailed),
    async (s) => {
      try {
        const r = await fv.getImageToVideo(s.fal!);
        if (r.status === "succeed" && r.videoUrl) s.clipUrl = r.videoUrl;
        else if (r.status === "failed") {
          // Speaking shots get one more try on the fallback lip-sync model.
          if (s.line && !fv.isFallbackAvatar(s.fal)) {
            s.fal = await fv.submitAvatar({ imageUrl: s.imageUrl!, audioUrl: s.audioUrl!, prompt: avatarPrompt(s), model: fv.FAL_AVATAR_FALLBACK_MODEL });
          } else s.clipFailed = true;
        }
      } catch {
        /* try again next time */
      }
    }
  );
  const age = Date.now() - Date.parse(row.created_at);
  if (age > ANIMATE_TIMEOUT_MS) for (const s of plan.shots) if (!s.clipUrl) s.clipFailed = true;
  const done = plan.shots.every((s) => s.clipUrl || s.clipFailed);
  await save(db, row, { plan });
  return done;
}

/** Shotstack edit: shots one after another; voices, sound effects on their own tracks. */
export function buildSkitEdit(plan: SkitPlan, vertical: boolean) {
  const video: Array<Record<string, unknown>> = [];
  const voices: Array<Record<string, unknown>> = [];
  const sfx: Array<Record<string, unknown>> = [];
  let t = 0;
  for (const s of plan.shots) {
    const length = Math.round((s.line ? (s.audioSeconds ?? 2) + 0.3 : s.seconds) * 100) / 100;
    const start = Math.round(t * 100) / 100;
    if (s.clipUrl) {
      video.push({ asset: { type: "video", src: s.clipUrl, volume: 0 }, start, length, fit: "cover" });
    } else if (s.imageUrl) {
      video.push({ asset: { type: "image", src: s.imageUrl }, start, length, fit: "cover", effect: s.camera === "wide" ? "zoomInSlow" : "zoomIn" });
    }
    if (s.audioUrl) voices.push({ asset: { type: "audio", src: s.audioUrl, volume: 1 }, start: start + 0.1, length: s.audioSeconds ?? length });
    if (s.sfxUrl) sfx.push({ asset: { type: "audio", src: s.sfxUrl, volume: s.line ? 0.35 : 0.8 }, start, length: Math.max(length, 1.5) });
    t += length;
  }
  const total = Math.round(t * 100) / 100;
  return {
    total,
    edit: {
      timeline: { background: "#000000", tracks: [{ clips: voices }, ...(sfx.length ? [{ clips: sfx }] : []), { clips: video }] },
      output: { format: "mp4", fps: 30, size: vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, quality: "medium", range: { start: 0, length: total } },
    },
  };
}

async function finish(db: SupabaseClient, row: SkitRow, renderUrl: string, seconds: number) {
  const key = `${row.user_id}/skit/${row.id}/final.mp4`;
  let url: string;
  const r2 = await import("@/lib/storage/r2");
  if (r2.r2Configured()) {
    await r2.copyUrlToR2(renderUrl, key, "video/mp4");
    url = r2.r2PublicUrl(key);
  } else {
    const bytes = Buffer.from(await (await fetch(renderUrl)).arrayBuffer());
    const { error } = await db.storage.from("videos").upload(key, bytes, { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(error.message);
    url = publicUrl(db, key);
  }
  const plan = row.plan;
  const dialogue = plan.shots
    .filter((s) => s.line)
    .map((s) => `${plan.characters.find((c) => c.id === s.speaker)?.name ?? ""}: ${s.line}`)
    .join("\n");
  const { data: project } = await db
    .from("projects")
    .insert({
      user_id: row.user_id,
      title: plan.title,
      platform: row.vertical ? "YouTube Shorts" : "YouTube Long-form",
      style: "Cinematic",
      duration: `${Math.round(seconds)} seconds`,
      idea: row.script.slice(0, 500),
      status: "draft",
      content: {
        titles: [plan.title],
        description: dialogue,
        tags: [],
        finalVideoUrl: url,
        thumbnailUrl: plan.shots.find((s) => s.imageUrl)?.imageUrl,
        skit: { characters: plan.characters.map((c) => c.name) },
      },
    })
    .select("id")
    .single();
  await save(db, row, { phase: "done", status: "completed", output_url: url, project_id: project?.id ?? null, lease_until: null });
}

/** One step of work on a skit (each fits well inside a minute). */
export async function advanceSkitJob(db: SupabaseClient, row: SkitRow): Promise<SkitRow> {
  if (row.status !== "running") return row;
  if (!(await claim(db, row))) return row;
  try {
    if (row.phase === "cast") await stepCast(db, row);
    else if (row.phase === "shots") await stepShots(db, row);
    else if (row.phase === "animate") {
      if (await stepAnimate(db, row)) {
        if (row.plan.shots.every((s) => !s.imageUrl)) return (await fail(db, row, "The pictures couldn't be made."), row);
        const { submitRender } = await import("@/lib/pipeline/shotstack");
        const { edit } = buildSkitEdit(row.plan, row.vertical);
        const renderId = await submitRender(edit);
        await save(db, row, { phase: "render", render_id: renderId });
      }
    } else if (row.phase === "render" && row.render_id) {
      const { getRender } = await import("@/lib/pipeline/shotstack");
      const r = await getRender(row.render_id);
      if (r.status === "failed") await fail(db, row, r.error ?? "The final video couldn't be made.");
      else if (r.status === "done" && r.url) await finish(db, row, r.url, buildSkitEdit(row.plan, row.vertical).total);
      else if (Date.now() - Date.parse(row.updated_at) > RENDER_TIMEOUT_MS) await fail(db, row, "The final video took too long.");
    }
  } catch (err) {
    console.error(`[skit] ${row.id} ${row.phase} failed:`, err);
    const tries = ((row.plan as SkitPlan & { tries?: number }).tries ?? 0) + 1;
    (row.plan as SkitPlan & { tries?: number }).tries = tries;
    if (tries >= 4) await fail(db, row, err instanceof Error && /refus|safety|blocked/i.test(err.message) ? "The picture model refused this scene." : "Something went wrong while making the skit.");
    else await save(db, row, { plan: row.plan });
  } finally {
    if (row.status === "running") await db.from("skit_jobs").update({ lease_until: null }).eq("id", row.id);
  }
  return row;
}

/** Heartbeat: one step for every running skit. */
export async function advanceSkitJobs(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from("skit_jobs").select("*").eq("status", "running").limit(10);
  if (error) return 0;
  await Promise.allSettled(((data ?? []) as SkitRow[]).map((row) => advanceSkitJob(db, row)));
  return data?.length ?? 0;
}
