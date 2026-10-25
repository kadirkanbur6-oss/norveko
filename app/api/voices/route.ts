// app/api/voices/route.ts
// GET /api/voices?language=Türkçe
// Returns voices for the voiceover picker, split into:
//   voices  — voices already in the ElevenLabs account that match the language
//             (all account voices when none are tagged for it)
//   library — Voice Library voices for that language, usable once picked
//             (they are added to the account on demand by /api/pipeline/start)

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { listLibraryVoices, listVoices } from "@/lib/pipeline/elevenlabs";
import { isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { LANGUAGES, isOneOf, languageCode } from "@/lib/pipeline/options";

export const dynamic = "force-dynamic";

// Voice lists change rarely; cache per server instance.
const VOICES_TTL_MS = 10 * 60 * 1000;
let accountCache: { at: number; voices: Awaited<ReturnType<typeof listVoices>> } | null = null;
const libraryCache = new Map<string, { at: number; voices: Awaited<ReturnType<typeof listLibraryVoices>> }>();

async function getAccountVoices() {
  if (accountCache && Date.now() - accountCache.at < VOICES_TTL_MS) return accountCache.voices;
  const voices = await listVoices();
  accountCache = { at: Date.now(), voices };
  return voices;
}

async function getLibraryVoices(code: string) {
  const hit = libraryCache.get(code);
  if (hit && Date.now() - hit.at < VOICES_TTL_MS) return hit.voices;
  const voices = await listLibraryVoices(code);
  libraryCache.set(code, { at: Date.now(), voices });
  return voices;
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    if (!isGenerationEnabled(user.id)) {
      return NextResponse.json({ success: false, error: LAUNCH_LOCK_MESSAGE }, { status: 403 });
    }

    const langParam = req.nextUrl.searchParams.get("language");
    const language = isOneOf(LANGUAGES, langParam) ? langParam : LANGUAGES[0];
    const code = languageCode(language);

    const account = await getAccountVoices();
    const tagged = account.filter((v) => v.languages.includes(code));

    // Library voices in the user's language (skip for English: the account
    // defaults already cover it). Failures here must not break the picker.
    let library: Awaited<ReturnType<typeof listLibraryVoices>> = [];
    if (code !== "en") {
      try {
        const inAccount = new Set(account.map((v) => v.voice_id));
        library = (await getLibraryVoices(code)).filter((v) => !inAccount.has(v.voice_id));
      } catch (err) {
        console.warn("[voices] library lookup failed:", err);
      }
    }

    // Only voices for the selected language. If neither the account nor the
    // library has any, fall back to every account voice (the multilingual
    // model still speaks the language) and say so via nativeMatch=false.
    const nativeMatch = tagged.length > 0 || library.length > 0;
    const voices = nativeMatch ? tagged : account;

    return NextResponse.json({
      success: true,
      language,
      languageCode: code,
      nativeMatch,
      voices: voices.map((voice) => ({
        voice_id: voice.voice_id,
        name: voice.name,
        labels: voice.labels,
        preview_url: voice.preview_url,
        languages: voice.languages,
        source: "account" as const,
      })),
      library: library.map((voice) => ({
        voice_id: voice.voice_id,
        public_owner_id: voice.public_owner_id,
        name: voice.name,
        labels: voice.labels,
        preview_url: voice.preview_url,
        languages: voice.languages,
        source: "library" as const,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
