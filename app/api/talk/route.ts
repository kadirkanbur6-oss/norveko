// app/api/talk/route.ts — talking character (lib/talk/talk.ts).
//   GET [?id=] → voices, looks, your recent talking videos (moves a running one along)
//   POST {action:"voice", text, voiceId} → speak the line, returns the audio to preview
//   POST {action:"uploadUrl", type, size} → signed upload for your own recording
//   POST {action:"quote", path} → length and price of an uploaded recording
//   POST {action:"start", path, characterId, scene?, look?, orientation, script?, rights:true}

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/api-keys";
import { isFullVideoEnabled, isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { hasPurchased, isWatermarkExempt } from "@/lib/pipeline/watermark-policy";
import { advanceSwapJob, type SwapRow } from "@/lib/swap/swap";
import {
  AUDIO_TYPES,
  CONTENT_TYPES,
  TALK_AVATAR_PROMPT,
  TALK_LOOKS,
  TALK_MAX_BYTES,
  TALK_MAX_CHARS,
  TALK_MAX_SECONDS,
  audioSeconds,
  talkCredits,
  talkImagePrompt,
} from "@/lib/talk/talk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ success: false, error, ...extra }, { status });
const MAX_RUNNING = 2;
/** Spoken lines you can preview per hour (each costs us a TTS call). */
const VOICE_PREVIEWS_PER_HOUR = 30;
const voiceCalls = new Map<string, number[]>();

function view(r: SwapRow) {
  return {
    id: r.id,
    status: r.status,
    characterName: r.character_name,
    script: r.script ?? null,
    seconds: r.source_seconds,
    vertical: r.vertical,
    credits: r.credits,
    imageUrl: r.image_url ?? null,
    outputUrl: r.output_url,
    projectId: r.project_id,
    error: r.error,
    createdAt: r.created_at,
  };
}

const PATH_RE = (userId: string) => new RegExp(`^${userId}/talk/(aud|rec)-[0-9a-f-]{36}\\.(mp3|wav|m4a)$`);

async function audioInfo(db: ReturnType<typeof adminDb>, userId: string, path: unknown) {
  if (typeof path !== "string" || !PATH_RE(userId).test(path)) throw new Error("Add the voice first.");
  const { data, error } = await db.storage.from("videos").download(path);
  if (error || !data) throw new Error("The recording wasn't found. Add it again.");
  if (data.size > TALK_MAX_BYTES) throw new Error("Recordings can be up to 8 MB.");
  const ext = path.slice(path.lastIndexOf(".") + 1) as "mp3" | "wav" | "m4a";
  const seconds = audioSeconds(Buffer.from(await data.arrayBuffer()), ext);
  if (!(seconds >= 1)) throw new Error("The recording is too short.");
  if (seconds > TALK_MAX_SECONDS + 0.5) throw new Error(`Up to ${TALK_MAX_SECONDS} seconds — shorten the line or trim the recording.`);
  return { seconds: Math.round(seconds * 10) / 10 };
}

async function allowedFor(db: ReturnType<typeof adminDb>, userId: string) {
  return isGenerationEnabled(userId) && isFullVideoEnabled(userId) && (isWatermarkExempt(userId) || (await hasPurchased(db, userId)));
}

export async function GET(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  const db = adminDb();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data } = await db.from("swap_jobs").select("*").eq("id", id).eq("user_id", user.id).eq("kind", "talk").maybeSingle();
    if (!data) return bad("Not found", 404);
    return NextResponse.json({ success: true, talk: view(await advanceSwapJob(db, data as SwapRow)) });
  }
  const { VOICE_STYLES } = await import("@/lib/skit/voice-styles");
  const { userClone } = await import("@/lib/voice/clones");
  const clone = await userClone(db, user.id).catch(() => null);
  const { data } = await db.from("swap_jobs").select("*").eq("user_id", user.id).eq("kind", "talk").order("created_at", { ascending: false }).limit(20);
  return NextResponse.json({
    success: true,
    allowed: await allowedFor(db, user.id),
    maxSeconds: TALK_MAX_SECONDS,
    maxChars: TALK_MAX_CHARS,
    looks: TALK_LOOKS,
    voices: [
      // Only the 3 character voices (cartoon / comic / gruff), male or female.
      ...VOICE_STYLES.flatMap((v) => (["male", "female"] as const).map((g) => ({ id: `style:${v.id}:${g}`, name: `${v.label} · ${g}`, style: v.hint }))),
      ...(clone ? [{ id: clone.voice_id, name: "Your voice", style: clone.name }] : []),
    ],
    talks: ((data ?? []) as SwapRow[]).map(view),
  });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  if (!isGenerationEnabled(user.id) || !isFullVideoEnabled(user.id)) return bad(LAUNCH_LOCK_MESSAGE, 403);
  const db = adminDb();
  if (!(await allowedFor(db, user.id))) return bad("Talking characters are available on any plan or pack.", 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "voice") {
    const text = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
    if (text.length < 2) return bad("Write what they should say.");
    if (text.length > TALK_MAX_CHARS) return bad(`Keep it under ${TALK_MAX_CHARS} characters (about ${TALK_MAX_SECONDS} seconds).`);
    const voiceId = typeof body.voiceId === "string" ? body.voiceId : "";
    const { isVoiceStyle, voiceFor, styleDirection, applyVoiceStyle } = await import("@/lib/skit/voice-styles");
    const { userClone } = await import("@/lib/voice/clones");
    const ownClone = (await userClone(db, user.id).catch(() => null))?.voice_id;
    const [, styleId, gender] = voiceId.split(":");
    const style = voiceId.startsWith("style:") && isVoiceStyle(styleId) && (gender === "male" || gender === "female") ? styleId : null;
    if (!style && voiceId !== ownClone) return bad("Pick a voice.");
    const now = Date.now();
    const recent = (voiceCalls.get(user.id) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= VOICE_PREVIEWS_PER_HOUR) return bad("That's a lot of tries — wait a little and try again.", 429);
    voiceCalls.set(user.id, [...recent, now]);
    try {
      const { synthesizeNarration } = await import("@/lib/pipeline/tts");
      const speech = style
        ? await synthesizeNarration(text, `gemini:${voiceFor(style, gender as "male" | "female")}`, { align: false,
            direction: styleDirection(style, "the character", "talking straight to the camera"),
          })
        : await synthesizeNarration(text, voiceId, { align: false,
            direction: "Say this in character, expressively and naturally, like a person talking to a camera — not like a narrator",
          });
      if (style && speech.ext === "wav") speech.audio = applyVoiceStyle(speech.audio, style);
      const path = `${user.id}/talk/aud-${randomUUID()}.${speech.ext}`;
      const { error } = await db.storage.from("videos").upload(path, speech.audio, { contentType: speech.contentType, upsert: false });
      if (error) throw new Error(error.message);
      const { seconds } = await audioInfo(db, user.id, path);
      return NextResponse.json({
        success: true,
        path,
        seconds,
        credits: talkCredits(seconds),
        url: db.storage.from("videos").getPublicUrl(path).data.publicUrl,
      });
    } catch (err) {
      console.error("[talk] voice failed:", err);
      return bad(err instanceof Error && /seconds|short/.test(err.message) ? err.message : "The voice couldn't be made. Try again.", 502);
    }
  }

  if (body.action === "uploadUrl") {
    const ext = AUDIO_TYPES[String(body.type ?? "")];
    if (!ext) return bad("Use an MP3, WAV or M4A recording.");
    if (Number(body.size) > TALK_MAX_BYTES) return bad("Recordings can be up to 8 MB.");
    const path = `${user.id}/talk/rec-${randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from("videos").createSignedUploadUrl(path);
    if (error || !data) return bad("Could not prepare the upload.", 500);
    return NextResponse.json({ success: true, path, token: data.token, contentType: CONTENT_TYPES[ext] });
  }

  if (body.action === "quote") {
    try {
      const { seconds } = await audioInfo(db, user.id, body.path);
      return NextResponse.json({ success: true, seconds, credits: talkCredits(seconds), url: db.storage.from("videos").getPublicUrl(String(body.path)).data.publicUrl });
    } catch (err) {
      return bad(err instanceof Error ? err.message : "This recording can't be used.");
    }
  }

  if (body.action === "start") {
    if (body.rights !== true) return bad("Confirm the checkbox first.");
    const characterId = typeof body.characterId === "string" ? body.characterId : "";
    const { data: character } = await db
      .from("characters")
      .select("id, name, description, reference_paths")
      .eq("id", characterId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!character || !(character.reference_paths as string[] | undefined)?.length) return bad("Pick one of your characters.");
    const { count } = await db.from("swap_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "running").eq("kind", "talk");
    if ((count ?? 0) >= MAX_RUNNING) return bad(`Up to ${MAX_RUNNING} are made at a time. Try again when one finishes.`, 429);

    let seconds: number;
    try {
      ({ seconds } = await audioInfo(db, user.id, body.path));
    } catch (err) {
      return bad(err instanceof Error ? err.message : "This recording can't be used.");
    }
    const vertical = body.orientation !== "horizontal";
    const look = TALK_LOOKS.some((l) => l.id === body.look) ? String(body.look) : "cinematic";
    const scene = typeof body.scene === "string" ? body.scene.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : "";
    const script = typeof body.script === "string" ? body.script.replace(/\s+/g, " ").trim().slice(0, TALK_MAX_CHARS) : "";

    const credits = talkCredits(seconds);
    const { payerFor } = await import("@/lib/teams");
    const payer = await payerFor(db, user.id);
    const { data: paid, error: payErr } = await db.rpc("deduct_credits", {
      p_user_id: payer,
      p_amount: credits,
      p_reason: `Talking character (${Math.ceil(seconds)} s, ${character.name})`,
    });
    if (payErr) return bad(payErr.message, 500);
    if (!paid) return bad(`Not enough credits — this costs ${credits}.`, 402, { code: "insufficient_credits" });

    const id = randomUUID();
    try {
      const { loadReferenceImages } = await import("@/lib/characters/characters");
      const { generateSceneImage } = await import("@/lib/pipeline/gemini-image");
      const images = await loadReferenceImages(db, character.reference_paths as string[]);
      const picture = await generateSceneImage(
        talkImagePrompt(character.name, (character.description as string | null) ?? "", scene),
        `talk-${id}`,
        user.id,
        1,
        vertical ? "vertical" : "horizontal",
        look,
        [{ name: character.name, description: (character.description as string | null) ?? undefined, images }]
      );
      const { submitAvatar } = await import("@/lib/pipeline/fal-video");
      const fal = await submitAvatar({
        imageUrl: picture.imageUrl,
        audioUrl: db.storage.from("videos").getPublicUrl(String(body.path)).data.publicUrl,
        prompt: TALK_AVATAR_PROMPT,
      });
      const { error } = await db.from("swap_jobs").insert({
        id,
        kind: "talk",
        user_id: user.id,
        billed_to: payer !== user.id ? payer : null,
        status: "running",
        phase: "swap",
        source_path: body.path,
        source_seconds: seconds,
        vertical,
        character_id: character.id,
        character_name: character.name,
        prompt: scene || null,
        script: script || null,
        image_url: picture.imageUrl,
        fal,
        credits,
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error("[talk] start failed:", err);
      await db.rpc("add_credits", { p_user_id: payer, p_amount: credits, p_type: "refund", p_reason: "Refund: talking character could not start" });
      return bad("It couldn't be started — the picture model may have refused this character. Your credits were refunded.", 502);
    }
    return NextResponse.json({ success: true, id, credits });
  }

  return bad("Unknown action.");
}
