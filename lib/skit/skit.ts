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
import * as visualStyles from "@/lib/pipeline/visual-styles";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_COST_PER_SECOND, RENDER_CREDITS_PER_30S, creditsForCost } from "@/lib/pipeline/steps";
import { wordsPerSecond } from "@/lib/pipeline/narration";
import { SKIT_CLIP_COST, SKIT_IMAGE_COST, skitCreditsFor } from "./pricing";
import type { CaptionCue } from "@/lib/pipeline/captions";
import { applyVoiceStyle, isVoiceStyle, styleDirection, voiceFor, type VoiceGender, type VoiceStyle } from "@/lib/skit/voice-styles";
import { musicCredit } from "@/lib/pipeline/music";
import { storeMedia } from "@/lib/storage/media";

export const SKIT_MAX_SHOTS = 8;
export const SKIT_MAX_CHARACTERS = 4;
export const SKIT_MAX_SECONDS = 60;
export const SKIT_MAX_SCRIPT = 1500;
export const SKIT_LOOKS = ["3d", "anime", "cinematic", "painting", "comic"] as const;
const IMAGE_COST = SKIT_IMAGE_COST;
const CLIP_COST = SKIT_CLIP_COST;
const CROWD_VOICES = 4;
const ANIMATE_TIMEOUT_MS = 25 * 60 * 1000;
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;
const LEASE_MS = 100_000;

export interface SkitCharacter {
  id: string;
  name: string;
  look: string;
  voice: string; // Gemini voice name
  gender?: VoiceGender;
  /** One of the 3 skit voices (cartoon / comic / gruff); older plans have none = comic. */
  voiceStyle?: VoiceStyle;
  refPath?: string;
  /** Where the reference portrait lives (R2 redirect URL or public Supabase URL). */
  refUrl?: string;
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
  /** Words a crowd shouts in this shot ("Yaşa! Var ol!"), in the dialogue language; "" if none. */
  crowd: string;
  seconds: number;
  // Filled while it is made:
  imageUrl?: string;
  audioUrl?: string;
  audioSeconds?: number;
  sfxUrl?: string;
  crowdUrls?: string[];
  crowdSeconds?: number;
  /** Subtitle cues of this shot's line, relative to its audio. */
  cues?: CaptionCue[];
  fal?: { requestId: string; statusUrl: string; responseUrl: string } | null;
  clipUrl?: string | null;
  /** Set by "Make this shot again" after the skit is done. */
  editedClipUrl?: string | null;
  clipFailed?: boolean;
}

export interface SkitPlan {
  /** When each making phase began (ISO). */
  phaseAt?: Record<string, string>;
  /** Burned-in subtitles of the lines (on by default). */
  captions?: boolean;
  captionStyle?: string;
  /** Background music (comedy pieces); `false` to leave it out. */
  music?: { id: string; title: string; url: string } | false | null;
  /** Re-renders after edits (file names stay unique for CDNs). */
  renderVersion?: number;
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
  status: "draft" | "running" | "completed" | "failed";
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
  const ask = (model: string) => chatJSON<Record<string, unknown>>({
    model,
    system: `You turn a creator's joke or script into a short animated skit for TikTok/Reels/Shorts: a cast and a shot list. Answer with JSON only.

Rules:
- Keep every spoken line the creator wrote, word for word, in its original language (you may fix punctuation). Do not add new jokes or new dialogue, except at most one very short reaction line if the script clearly implies one.
- Narration in the script ("after a long silence…", "applause, cheers…") is NOT spoken by a character: turn it into a silent shot (a pause, a reaction) and/or a sound effect. When the script says a crowd shouts or chants words ("yaşa, varol sesleri", "the crowd chants his name"), put those words in "crowd" (in the dialogue language, short, with exclamation marks, e.g. "Yaşa! Var ol! Yaşa!") on a wide crowd shot, together with an applause/cheering "sfx".
- If the creator asks for a style ("like the viral cockroach videos", "as cats", "anime"), EVERY character becomes that: e.g. Pixar-style 3D cartoon cockroaches with human clothes in human settings. Without a style ask, use friendly Pixar-style 3D cartoon characters.
- Real, named people become clearly cartoon caricatures of that species, recognisable only through clothes, hairstyle and props. Never put a real person's name in "look" or "setting" — describe what they wear instead. Character "name" may be a short role label in the script's language (e.g. "Başkan", "Gazeteci").
- At most ${SKIT_MAX_CHARACTERS} characters and ${SKIT_MAX_SHOTS} shots, aim for under ${SKIT_MAX_SECONDS} seconds (the creator's lines always stay whole). Vary the camera (wide establishing shot first, close-ups for punchlines, a wide crowd shot for reactions). A speaking shot shows ONLY the speaker's face (single medium close-up or close-up; others at most from behind) — group shots are for silent moments and reactions.
- "setting" must fully describe the place in every shot (each picture is drawn on its own), in English. Keep the same place consistent across shots that happen there.
- "look" is a consistent English visual description: species/type, colours, clothing, props, size. Crowds and extras are described in "setting", not as characters.
- Give each character a "gender" (male|female, the voice they should have) and one of 3 "voiceStyle"s: "cartoon" (high and quick — small, cute, silly or animal characters, the viral cockroach/chick-video sound; the default for cartoon animals), "comic" (natural voice, over-the-top acting — loud bosses, show-offs, excited people), "gruff" (deep, husky, older — old men/women, tough guys, villains).

JSON shape:
{"title": string (short, in the script's language),
 "language": ISO 639-1 code of the dialogue,
 "look": one of ${SKIT_LOOKS.join("|")},
 "characters": [{"id":"c1","name":string,"look":string,"gender":"male|female","voiceStyle":"cartoon|comic|gruff"}],
 "shots": [{"setting":string,"camera":"wide|medium|close-up","visible":["c1"],"speaker":"c1" or null,"line":string (exact spoken text, "" if silent),"tone":string (English, how the line is said: "proud, booming", "confused, hesitant"…),"action":string (English: what happens on screen),"sfx":string (English sound effect for this shot, e.g. "large crowd applauding and cheering", or ""),"crowd":string (words a crowd shouts in this shot, or ""),"seconds":number (2-4, only used for silent shots)}]}`,
    user: script.slice(0, SKIT_MAX_SCRIPT),
    timeoutMs: 90_000,
  });
  // One retry on a backup model: a timeout, refusal or broken JSON shouldn't reach the creator.
  let data: Record<string, unknown>;
  try {
    data = (await ask(SCRIPT_MODEL)).data;
    if (!Array.isArray(data.characters) || !Array.isArray(data.shots)) throw new Error("plan without cast/shots");
  } catch (err) {
    console.warn("[skit] plan failed, retrying on the backup model:", err instanceof Error ? err.message : err);
    data = (await ask(process.env.SKIT_BACKUP_MODEL || "gemini-3.8-flash")).data;
  }

  const characters: SkitCharacter[] = (Array.isArray(data.characters) ? data.characters : [])
    .slice(0, SKIT_MAX_CHARACTERS)
    .map((c, i) => {
      const r = c as Record<string, unknown>;
      const gender: VoiceGender = r.gender === "female" ? "female" : "male";
      const voiceStyle: VoiceStyle = isVoiceStyle(r.voiceStyle) ? r.voiceStyle : "cartoon";
      return {
        id: clean(r.id, 10) || `c${i + 1}`,
        name: clean(r.name, 40) || `Character ${i + 1}`,
        look: clean(r.look, 400),
        voice: "",
        gender,
        voiceStyle,
      };
    })
    .filter((c) => c.look);
  assignVoices(characters, voices);
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
      crowd: clean(r.crowd, 120),
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
    } else total += Math.max(s.seconds, s.crowd ? s.crowd.split(/\s+/).length / wps + 1 : 0);
  }
  return { speaking, total };
}

export function skitCredits(plan: SkitPlan): number {
  const { speaking, total } = estimateSeconds(plan);
  return skitCreditsFor({
    characters: plan.characters.length,
    shots: plan.shots.length,
    speakingSeconds: speaking,
    silentShots: plan.shots.filter((s) => !s.line).length,
    sfx: plan.shots.filter((s) => s.sfx).length,
    crowd: plan.shots.filter((s) => s.crowd).length,
    totalSeconds: total,
  });
}

/* ---------------- Making it ---------------- */

const publicUrl = (db: SupabaseClient, path: string) => db.storage.from("videos").getPublicUrl(path).data.publicUrl;

async function save(db: SupabaseClient, row: SkitRow, values: Partial<SkitRow>) {
  // Remember when each phase began (the progress screen estimates from it).
  if (values.phase && values.phase !== row.phase) {
    const plan = (values.plan ?? row.plan) as SkitPlan & { phaseAt?: Record<string, string> };
    plan.phaseAt = { ...(plan.phaseAt ?? {}), [values.phase]: new Date().toISOString() };
    values = { ...values, plan };
  }
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
    let blob: Blob | null = null;
    if (c.refUrl) {
      const res = await fetch(c.refUrl, { cache: "no-store" }).catch(() => null);
      blob = res && res.ok ? await res.blob() : null;
    } else {
      blob = (await db.storage.from("videos").download(c.refPath!)).data;
    }
    if (!blob) continue;
    const mimeType = blob.type && blob.type.startsWith("image/") ? blob.type : c.refPath?.endsWith(".jpg") ? "image/jpeg" : "image/png";
    refs.push({ name: c.name, description: c.look, images: [{ mimeType, data: Buffer.from(await blob.arrayBuffer()).toString("base64") }] });
  }
  return refs;
}

function shotPrompt(plan: SkitPlan, s: SkitShot): string {
  const speaker = s.speaker ? plan.characters.find((c) => c.id === s.speaker) : null;
  if (speaker) {
    // The lip-sync model moves every visible mouth, so a speaking shot shows ONE face: the speaker's.
    const framing = s.camera === "close-up" ? "Close-up" : "Medium close-up";
    return `${framing} single shot of ${speaker.name} (${speaker.look}). ${s.setting}. ${s.action} ${speaker.name} is the only face in the picture: centred, facing the camera, face large and clearly visible, mouth slightly open as if speaking. Any other characters appear only from behind, cut off at the frame edge or blurred in the background with their faces turned away — no other visible face or mouth. Expressive, funny, viral short-video look.`;
  }
  const who = s.visible
    .map((id) => plan.characters.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => `${c!.name} (${c!.look})`)
    .join("; ");
  const framing = s.camera === "wide" ? "Wide shot" : s.camera === "close-up" ? "Close-up" : "Medium shot";
  return `${framing}. ${s.setting}. ${who ? `On screen: ${who}.` : ""} ${s.action} Nobody is talking; mouths closed. Expressive, funny, viral short-video look.`;
}

async function stepCast(db: SupabaseClient, row: SkitRow) {
  const { generateReferencePortrait } = await import("@/lib/pipeline/gemini-image");
  await settled(
    row.plan.characters.filter((c) => !c.refPath),
    async (c) => {
      const img = await generateReferencePortrait({ name: c.name, description: `${c.look}. ${row.plan.look === "cinematic" ? "" : "Cartoon character, not a real human."}` });
      const path = `${row.user_id}/skit/${row.id}/char-${c.id}.${img.mimeType.includes("jpeg") ? "jpg" : "png"}`;
      c.refUrl = await storeMedia(db, path, img.bytes, img.mimeType);
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
        const refs = await charRefs(db, plan, s.speaker ? [s.speaker] : s.visible);
        const img = await generateSceneImage(shotPrompt(plan, s), `skit-${row.id}`, row.user_id, i + 1, row.vertical ? "vertical" : "horizontal", plan.look, refs);
        s.imageUrl = img.imageUrl;
      });
    if (s.line && !s.audioUrl)
      jobs.push(async () => {
        const c = plan.characters.find((x) => x.id === s.speaker)!;
        const style: VoiceStyle = c.voiceStyle ?? "comic";
        const speech = await synthesizeNarration(s.line, `gemini:${c.voice}`, {
          direction: c.voiceStyle ? styleDirection(style, c.name, s.tone) : `Perform this line as ${c.name}, a cartoon character in a comedy sketch, ${s.tone || "expressively"} — acted, not narrated. Say only the line`,
        });
        // Cartoon / gruff: the take is pitched up or down (its timing changes with it).
        const audio = speech.ext === "wav" ? applyVoiceStyle(speech.audio, style) : speech.audio;
        const path = `${row.user_id}/skit/${row.id}/line-${s.id}-${randomUUID().slice(0, 8)}.${speech.ext}`;
        const lineUrl = await storeMedia(db, path, audio, speech.contentType);
        s.audioSeconds = Math.round(audioSeconds(audio, speech.ext) * 100) / 100;
        if (speech.alignment && audio === speech.audio) {
          const { alignmentToCues } = await import("@/lib/pipeline/captions");
          s.cues = alignmentToCues(speech.alignment);
        }
        s.audioUrl = lineUrl;
      });
    if (s.crowd && !s.crowdUrls)
      jobs.push(async () => {
        try {
          // The same shout from several different voices, layered at render time.
          const { GEMINI_VOICES } = await import("@/lib/pipeline/gemini-tts");
          const cast = new Set(plan.characters.map((c) => c.voice));
          const pool = GEMINI_VOICES.filter((v) => !cast.has(v.name));
          const men = pool.filter((v) => v.gender === "male");
          const women = pool.filter((v) => v.gender === "female");
          const picks = [men[0], women[0], men[1], women[1]].filter(Boolean).slice(0, CROWD_VOICES);
          const parts = await Promise.all(
            picks.map(async (v, k) => {
              const speech = await synthesizeNarration(s.crowd, `gemini:${v.name}`, {
                direction: "Shout this loudly and excitedly as one person in a big cheering crowd at a rally, slightly overlapping the others",
              });
              const path = `${row.user_id}/skit/${row.id}/crowd-${s.id}-${k}.${speech.ext}`;
              const url = await storeMedia(db, path, speech.audio, speech.contentType);
              return { url, seconds: audioSeconds(speech.audio, speech.ext) };
            })
          );
          s.crowdUrls = parts.map((p) => p.url);
          s.crowdSeconds = Math.round(Math.max(...parts.map((p) => p.seconds)) * 100) / 100;
        } catch (err) {
          console.warn(`[skit] ${row.id} crowd skipped:`, err instanceof Error ? err.message : err);
          s.crowd = ""; // a missing shout never stops the skit
        }
      });
    if (s.sfx && !s.sfxUrl)
      jobs.push(async () => {
        try {
          const audio = await generateSoundEffect(s.sfx, s.line ? undefined : Math.max(2, s.seconds + 1, s.crowd ? s.crowd.split(/\s+/).length / 2 + 2 : 0));
          const path = `${row.user_id}/skit/${row.id}/sfx-${s.id}.mp3`;
          s.sfxUrl = await storeMedia(db, path, audio, "audio/mpeg");
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
  return `Only the character in the centre speaks, with lively cartoon expressions, ${s.tone || "expressive"}, natural head and body movement; anyone else in the frame stays silent with the mouth closed. ${s.action}`.slice(0, 900);
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
  // From when animating began (an edit of an old skit starts its own clock).
  const age = Date.now() - Date.parse(row.plan.phaseAt?.animate ?? row.plan.phaseAt?.shots ?? row.created_at);
  if (age > ANIMATE_TIMEOUT_MS) for (const s of plan.shots) if (!s.clipUrl) s.clipFailed = true;
  const done = plan.shots.every((s) => s.clipUrl || s.clipFailed);
  await save(db, row, { plan });
  return done;
}

/** Where each shot sits on the timeline (seconds). */
export function skitLayout(plan: SkitPlan): Array<{ start: number; length: number }> {
  let t = 0;
  return plan.shots.map((s) => {
    const silentLength = Math.max(s.seconds, s.crowdUrls?.length && s.crowdSeconds ? s.crowdSeconds + 0.6 : 0);
    const length = Math.round((s.line ? (s.audioSeconds ?? 2) + 0.3 : silentLength) * 100) / 100;
    const start = Math.round(t * 100) / 100;
    t += length;
    return { start, length };
  });
}

/** Subtitles for the whole skit: every line (and crowd shout) at its place on the timeline. */
export function skitCues(plan: SkitPlan): CaptionCue[] {
  const layout = skitLayout(plan);
  const cues: CaptionCue[] = [];
  plan.shots.forEach((s, i) => {
    const { start, length } = layout[i];
    if (s.line && s.cues?.length) {
      for (const c of s.cues) cues.push({ start: start + 0.1 + c.start, end: Math.min(start + length, start + 0.1 + c.end), text: c.text });
    } else if (s.line) {
      cues.push({ start: start + 0.1, end: start + length - 0.05, text: s.line });
    } else if (s.crowd && s.crowdUrls?.length) {
      cues.push({ start: start + 0.2, end: start + length - 0.1, text: s.crowd });
    }
  });
  return cues.filter((c) => c.end - c.start > 0.2);
}

/** Shotstack edit: shots one after another; voices, crowd, effects, subtitles and music on their own tracks. */
export function buildSkitEdit(plan: SkitPlan, vertical: boolean, extras: { captionsUrl?: string | null; musicUrl?: string | null } = {}) {
  const video: Array<Record<string, unknown>> = [];
  const voices: Array<Record<string, unknown>> = [];
  const sfx: Array<Record<string, unknown>> = [];
  const crowd: Array<Array<Record<string, unknown>>> = Array.from({ length: CROWD_VOICES }, () => []);
  const layout = skitLayout(plan);
  plan.shots.forEach((s, i) => {
    const { start, length } = layout[i];
    const clipUrl = s.editedClipUrl ?? s.clipUrl;
    if (clipUrl) {
      video.push({ asset: { type: "video", src: clipUrl, volume: 0 }, start, length, fit: "cover" });
    } else if (s.imageUrl) {
      video.push({ asset: { type: "image", src: s.imageUrl }, start, length, fit: "cover", effect: s.camera === "wide" ? "zoomInSlow" : "zoomIn" });
    }
    if (s.audioUrl) voices.push({ asset: { type: "audio", src: s.audioUrl, volume: 1 }, start: start + 0.1, length: s.audioSeconds ?? length });
    // Crowd shout: each voice on its own track, a beat apart, so it sounds like many people.
    (s.crowdUrls ?? []).forEach((src, k) => {
      const at = Math.round((start + 0.2 + k * 0.17) * 100) / 100;
      crowd[k].push({ asset: { type: "audio", src, volume: 0.7 }, start: at, length: Math.max(0.5, Math.min(s.crowdSeconds ?? length, start + length - at + 0.4)) });
    });
    if (s.sfxUrl) sfx.push({ asset: { type: "audio", src: s.sfxUrl, volume: s.line ? 0.35 : 0.8 }, start, length: Math.max(length, 1.5) });
  });
  const last = layout[layout.length - 1];
  const total = last ? Math.round((last.start + last.length) * 100) / 100 : 1;
  const size = vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const tracks: Array<{ clips: Array<Record<string, unknown>> }> = [];
  if (extras.captionsUrl) {
    const { captionStyle } = visualStyles;
    const cap = captionStyle(plan.captionStyle);
    tracks.push({
      clips: [
        {
          asset: {
            type: "rich-caption",
            src: extras.captionsUrl,
            font: { family: cap.font, size: vertical ? cap.size : Math.round(cap.size * 0.76), color: cap.color, weight: cap.font.includes("ExtraBold") ? 800 : 600 },
            ...(cap.stroke ? { stroke: { width: cap.stroke.width, color: cap.stroke.color, opacity: 1 } } : {}),
            animation: { style: cap.animation },
            ...(cap.active || cap.activeBackground
              ? { active: { font: { ...(cap.active ? { color: cap.active } : {}), ...(cap.activeBackground ? { background: cap.activeBackground } : {}) } } }
              : {}),
            align: { vertical: "middle" },
          },
          start: 0,
          length: "end",
          width: Math.round(size.width * 0.86),
          height: Math.round(size.height * (vertical ? 0.16 : 0.2)),
          position: "bottom",
          offset: { x: 0, y: vertical ? 0.14 : 0.07 },
        },
      ],
    });
  }
  tracks.push({ clips: voices }, ...crowd.filter((c) => c.length).map((clips) => ({ clips })));
  if (sfx.length) tracks.push({ clips: sfx });
  if (extras.musicUrl) {
    tracks.push({ clips: [{ asset: { type: "audio", src: extras.musicUrl, volume: 0.08, effect: "fadeInFadeOut" }, start: 0, length: total }] });
  }
  tracks.push({ clips: video });
  return {
    total,
    edit: {
      timeline: { background: "#000000", tracks },
      output: { format: "mp4", fps: 30, size, quality: "medium", range: { start: 0, length: total } },
    },
  };
}

/** Background music for a render (optional, never fatal). Skits carry no subtitles. */
async function renderExtras(db: SupabaseClient, row: SkitRow): Promise<{ captionsUrl: string | null; musicUrl: string | null }> {
  const plan = row.plan;
  // 4 Nov 2026 (Kadir): skits have no burned-in subtitles; only narrated videos offer them.
  const captionsUrl: string | null = null;
  let musicUrl: string | null = null;
  if (plan.music !== false) {
    if (plan.music && plan.music.url) musicUrl = plan.music.url;
    else {
      const { comedyTracksFor } = await import("@/lib/pipeline/music");
      for (const t of comedyTracksFor(row.id)) {
        try {
          const path = `music/${t.id}.mp3`;
          const { data: existing } = await db.storage.from("videos").list("music", { search: `${t.id}.mp3`, limit: 1 });
          if (!existing?.some((f) => f.name === `${t.id}.mp3`)) {
            const res = await fetch(t.sourceUrl, { cache: "no-store" });
            if (!res.ok) continue;
            const { error } = await db.storage.from("videos").upload(path, Buffer.from(await res.arrayBuffer()), { contentType: "audio/mpeg", upsert: true });
            if (error) continue;
          }
          musicUrl = publicUrl(db, path);
          plan.music = { id: t.id, title: t.title, url: musicUrl };
          break;
        } catch {
          /* try the next piece */
        }
      }
    }
  }
  return { captionsUrl, musicUrl };
}

/** Start the final cut (first render or after edits). */
async function startRender(db: SupabaseClient, row: SkitRow) {
  const extras = await renderExtras(db, row);
  const { submitRender } = await import("@/lib/pipeline/shotstack");
  const { edit } = buildSkitEdit(row.plan, row.vertical, extras);
  const renderId = await submitRender(edit);
  await save(db, row, { plan: row.plan, phase: "render", render_id: renderId });
}

async function finish(db: SupabaseClient, row: SkitRow, renderUrl: string, seconds: number) {
  const version = row.plan.renderVersion ?? 0;
  const key = `${row.user_id}/skit/${row.id}/final${version ? `-v${version}` : ""}.mp4`;
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
  if (row.project_id) {
    // An edit of a finished skit: the same project gets the new cut.
    const { data: existing } = await db.from("projects").select("content").eq("id", row.project_id).maybeSingle();
    const content = (existing?.content ?? {}) as Record<string, unknown>;
    await db
      .from("projects")
      .update({
        content: {
          ...content,
          finalVideoUrl: url,
          thumbnailUrl: plan.shots.find((s) => s.imageUrl)?.imageUrl ?? content.thumbnailUrl,
          description: plan.music ? `${dialogue}\n\n${musicCredit(plan.music)}` : dialogue,
        },
        duration: `${Math.round(seconds)} seconds`,
      })
      .eq("id", row.project_id);
    await save(db, row, { phase: "done", status: "completed", output_url: url, lease_until: null });
    return;
  }
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
        description: plan.music ? `${dialogue}\n\n${musicCredit(plan.music)}` : dialogue,
        tags: [],
        finalVideoUrl: url,
        thumbnailUrl: plan.shots.find((s) => s.imageUrl)?.imageUrl,
        skit: { characters: plan.characters.map((c) => c.name) },
      },
    })
    .select("id")
    .single();
  await save(db, row, { phase: "done", status: "completed", output_url: url, project_id: project?.id ?? null, lease_until: null });
  // A series episode gets published now.
  if ((plan as SkitPlan & { series?: unknown }).series) {
    const { onSkitCompleted } = await import("@/lib/series/run");
    await onSkitCompleted(db, row).catch((err) => console.error(`[skit] ${row.id} publish failed:`, err));
  }
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
        await startRender(db, row);
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


/* ---------------- Editing a finished skit ---------------- */

export const MAX_SKIT_EDITS = 12;

/** Credits to make one shot again (picture + its animation). */
export function shotRedoCredits(plan: SkitPlan, index: number): number {
  const s = plan.shots[index];
  if (!s) return 0;
  const animate = s.line ? Math.ceil((s.audioSeconds ?? 3) * 1.1) * AVATAR_COST_PER_SECOND : CLIP_COST;
  return creditsForCost(IMAGE_COST + animate) + RENDER_CREDITS_PER_30S;
}

/**
 * Make one shot again (new picture, optionally with a note, then its animation)
 * and re-cut the skit. The project keeps its id; the new MP4 replaces the old.
 */
export function prepareShotRedo(row: SkitRow, index: number, note: string): SkitRow["plan"] {
  const plan = row.plan;
  const s = plan.shots[index];
  if (!s) throw new Error("No such shot.");
  if (note) s.action = `${note}. ${s.action}`.slice(0, 400);
  delete s.imageUrl;
  delete s.fal;
  delete s.clipUrl;
  delete s.clipFailed;
  delete s.editedClipUrl;
  plan.renderVersion = (plan.renderVersion ?? 0) + 1;
  (plan as SkitPlan & { edits?: number }).edits = ((plan as SkitPlan & { edits?: number }).edits ?? 0) + 1;
  return plan;
}

/** Re-cut with music switched on or off (free). */
export function prepareRecut(row: SkitRow, opts: { music?: boolean }): SkitRow["plan"] {
  const plan = row.plan;
  if (typeof opts.music === "boolean") plan.music = opts.music ? null : false;
  plan.renderVersion = (plan.renderVersion ?? 0) + 1;
  (plan as SkitPlan & { edits?: number }).edits = ((plan as SkitPlan & { edits?: number }).edits ?? 0) + 1;
  return plan;
}

export function editsUsed(plan: SkitPlan): number {
  return (plan as SkitPlan & { edits?: number }).edits ?? 0;
}

/** Give every character a Gemini voice that fits their gender and style, different from the others where possible. */
export function assignVoices(characters: SkitCharacter[], voices: Array<{ name: string }> = []): void {
  const known = new Set(voices.map((v) => v.name));
  const seen = new Map<string, number>();
  const used = new Set<string>();
  for (const c of characters) {
    const style = c.voiceStyle ?? "comic";
    const gender = c.gender ?? "male";
    const key = `${style}:${gender}`;
    let n = seen.get(key) ?? 0;
    let voice = voiceFor(style, gender, n);
    for (let k = 0; k < 3 && used.has(voice); k++) voice = voiceFor(style, gender, ++n);
    seen.set(key, n + 1);
    used.add(voice);
    c.voice = !known.size || known.has(voice) ? voice : c.voice || voice;
  }
}

/** Change one character's voice on a draft (style and/or gender), then re-pick voices. */
export function setCharacterVoice(plan: SkitPlan, characterId: string, opts: { voiceStyle?: unknown; gender?: unknown }): boolean {
  const c = plan.characters.find((x) => x.id === characterId);
  if (!c) return false;
  if (isVoiceStyle(opts.voiceStyle)) c.voiceStyle = opts.voiceStyle;
  if (opts.gender === "male" || opts.gender === "female") c.gender = opts.gender;
  assignVoices(plan.characters);
  return true;
}
