import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { listVoices } from "@/lib/pipeline/elevenlabs";
import { isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";

// ElevenLabs voice list changes rarely; cache per server instance to avoid
// hitting the provider on every page open.
const VOICES_TTL_MS = 10 * 60 * 1000;
let voicesCache: { at: number; voices: Awaited<ReturnType<typeof listVoices>> } | null = null;

async function getVoicesCached() {
  if (voicesCache && Date.now() - voicesCache.at < VOICES_TTL_MS) return voicesCache.voices;
  const voices = await listVoices();
  voicesCache = { at: Date.now(), voices };
  return voices;
}

export async function GET() {
  try {
    const { user } = await requireUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (!isGenerationEnabled(user.id)) {
      return NextResponse.json(
        { success: false, error: LAUNCH_LOCK_MESSAGE },
        { status: 403 }
      );
    }

    const voices = await getVoicesCached();

    return NextResponse.json({
      success: true,
      voices: voices.map((voice) => ({
        voice_id: voice.voice_id,
        name: voice.name,
        labels: voice.labels,
        preview_url: voice.preview_url,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}