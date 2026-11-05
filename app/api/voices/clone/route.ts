// app/api/voices/clone/route.ts — the creator's own cloned voice (lib/voice/clones.ts).
// GET: the clone (or null) + whether cloning is available.
// POST multipart {name, consent:"true", files[] (≤3, total ≤4 MB)}: create/replace it.
// DELETE: remove it (also at ElevenLabs).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { isWatermarkExempt, hasPurchased } from "@/lib/pipeline/watermark-policy";
import { cleanVoiceName, CLONE_MAX_BYTES, CLONE_MAX_FILES, CLONE_MIN_BYTES, READING_SCRIPT, userClone } from "@/lib/voice/clones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const unauthorized = () => NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });

async function allowed(db: ReturnType<typeof adminDb>, userId: string): Promise<boolean> {
  if (!process.env.ELEVENLABS_API_KEY) return false;
  return isWatermarkExempt(userId) || (await hasPurchased(db, userId));
}

export async function GET() {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const db = adminDb();
  try {
    const [clone, ok] = await Promise.all([userClone(db, user.id), allowed(db, user.id)]);
    return NextResponse.json({
      success: true,
      available: ok,
      clone: clone ? { voiceId: clone.voice_id, name: clone.name, createdAt: clone.created_at } : null,
      readingScript: READING_SCRIPT,
    });
  } catch (err) {
    console.error("[voice-clone] status failed:", err);
    return NextResponse.json({ success: true, available: false, clone: null, readingScript: READING_SCRIPT });
  }
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const db = adminDb();
  if (!(await allowed(db, user.id))) {
    return NextResponse.json({ success: false, error: "Your own voice is available after your first credit pack." }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ success: false, error: "Upload failed. Please try again." }, { status: 400 });
  if (form.get("consent") !== "true") {
    return NextResponse.json({ success: false, error: "Please confirm this is your voice or that you have permission to use it." }, { status: 400 });
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof Blob && f.size > 0) as File[];
  if (!files.length) return NextResponse.json({ success: false, error: "Add a recording first." }, { status: 400 });
  if (files.length > CLONE_MAX_FILES) return NextResponse.json({ success: false, error: `Up to ${CLONE_MAX_FILES} recordings.` }, { status: 400 });
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > CLONE_MAX_BYTES) return NextResponse.json({ success: false, error: "Recordings must be under 4 MB in total." }, { status: 400 });
  if (total < CLONE_MIN_BYTES) return NextResponse.json({ success: false, error: "The recording is too short. Aim for 30 seconds or more." }, { status: 400 });
  if (files.some((f) => f.type && !/^(audio|video)\//.test(f.type))) {
    return NextResponse.json({ success: false, error: "Use audio files (MP3, WAV, M4A or a browser recording)." }, { status: 400 });
  }

  const name = cleanVoiceName(form.get("name"));
  const { cloneVoice, deleteVoice, freeLibrarySlot } = await import("@/lib/pipeline/elevenlabs");
  const clone = () =>
    cloneVoice({
      name: `Norveko · ${name} · ${user.id.slice(0, 8)}`,
      description: "Creator's own voice (Norveko instant clone).",
      files: files.map((f, i) => ({ data: f, filename: f.name || `sample-${i + 1}.webm` })),
    });
  let voiceId: string;
  try {
    try {
      voiceId = await clone();
    } catch (err) {
      // Slots full (ElevenLabs Starter has 10): make room by removing a library voice
      // the account added for a narration (clones are never removed), then try once more.
      if ((err as { code?: string }).code !== "slots_full") throw err;
      const { cloneOwners } = await import("@/lib/voice/clones");
      const owners = await cloneOwners(db).catch(() => new Map<string, string>());
      const freed = await freeLibrarySlot(new Set(owners.keys()));
      if (!freed) throw err;
      voiceId = await clone();
    }
  } catch (err) {
    console.error("[voice-clone] clone failed:", err);
    const code = (err as { code?: string }).code;
    if (code === "slots_full") {
      // Every slot holds a creator's clone: the ElevenLabs plan needs more voice slots.
      const { captureError } = await import("@/lib/observability");
      await captureError(new Error("ElevenLabs voice slots full: upgrade the plan for more voice clones"), { route: "voices/clone" });
    }
    const error =
      code === "slots_full"
        ? "We can't create new voices right now. Please try again later."
        : code === "bad_audio"
          ? "We couldn't use that recording. Try a clear recording of 30 seconds or more, with no music."
          : "Creating your voice failed. Please try again.";
    return NextResponse.json({ success: false, error }, { status: code === "bad_audio" ? 400 : 502 });
  }

  const previous = await userClone(db, user.id).catch(() => null);
  const { error } = await db.from("voice_clones").upsert({ user_id: user.id, voice_id: voiceId, name, created_at: new Date().toISOString() });
  if (error) {
    await deleteVoice(voiceId);
    return NextResponse.json({ success: false, error: "Couldn't save your voice. Please try again." }, { status: 500 });
  }
  if (previous && previous.voice_id !== voiceId) await deleteVoice(previous.voice_id);
  return NextResponse.json({ success: true, clone: { voiceId, name, createdAt: new Date().toISOString() } });
}

export async function DELETE() {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const db = adminDb();
  const clone = await userClone(db, user.id).catch(() => null);
  if (clone) {
    const { deleteVoice } = await import("@/lib/pipeline/elevenlabs");
    await deleteVoice(clone.voice_id);
    await db.from("voice_clones").delete().eq("user_id", user.id);
  }
  return NextResponse.json({ success: true, clone: null });
}
