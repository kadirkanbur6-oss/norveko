// lib/pipeline/elevenlabs.ts
// ElevenLabs voice list + TTS helperleri. Server-side only.

import type { CharacterAlignment } from "./captions";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

if (!process.env.ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY is not set.");
}

export interface ElevenLabsVoiceSummary {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  preview_url: string | null;
  /** ISO 639-1 codes the voice is verified/labelled for (lowercase). */
  languages: string[];
  /** "premade" for ElevenLabs defaults, otherwise cloned/professional/generated. */
  category: string;
}

/** A Voice Library (shared) voice that is not in the account yet. */
export interface ElevenLabsLibraryVoice {
  voice_id: string;
  public_owner_id: string;
  name: string;
  labels: Record<string, string>;
  preview_url: string | null;
  languages: string[];
}

function normalizeLanguages(voice: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const labelLang = (voice.labels as Record<string, string> | undefined)?.language;
  if (typeof labelLang === "string" && labelLang) out.add(labelLang.slice(0, 2).toLowerCase());
  const verified = Array.isArray(voice.verified_languages) ? voice.verified_languages : [];
  for (const v of verified as Array<Record<string, unknown>>) {
    if (typeof v?.language === "string" && v.language) out.add(v.language.slice(0, 2).toLowerCase());
  }
  return [...out];
}

function getAuthHeaders() {
  return {
    "xi-api-key": process.env.ELEVENLABS_API_KEY!,
  };
}

export async function listVoices(): Promise<ElevenLabsVoiceSummary[]> {
  const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/voices`, {
    method: "GET",
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`ElevenLabs voices API error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const voices = Array.isArray(data?.voices) ? data.voices : [];

  return voices
    .map((voice: Record<string, unknown>) => ({
      voice_id: String(voice.voice_id ?? ""),
      name: String(voice.name ?? "Unnamed voice"),
      labels: (voice.labels as Record<string, string>) ?? {},
      preview_url:
        typeof voice.preview_url === "string" ? voice.preview_url : null,
      languages: normalizeLanguages(voice),
      category: String(voice.category ?? "premade"),
    }))
    .filter((voice: ElevenLabsVoiceSummary) => voice.voice_id.length > 0);
}

/**
 * Subscription tier of the account behind the API key ("free", "starter",
 * "creator", ...). Library voices can only be used via the API on paid tiers.
 * Returns null when the key lacks the user_read permission.
 */
export async function getSubscriptionTier(): Promise<string | null> {
  const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/user/subscription`, {
    headers: getAuthHeaders(),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { tier?: string };
  return typeof data.tier === "string" ? data.tier.toLowerCase() : null;
}

/**
 * Voice Library search for a language. These voices are usable for TTS only
 * after being added to the account (see addLibraryVoice); we add them lazily
 * when a user actually picks one.
 */
export async function listLibraryVoices(
  languageCode: string,
  pageSize = 24
): Promise<ElevenLabsLibraryVoice[]> {
  const params = new URLSearchParams({
    language: languageCode,
    page_size: String(pageSize),
    sort: "trending",
  });
  const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/shared-voices?${params}`, {
    headers: getAuthHeaders(),
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`ElevenLabs library API error (${res.status}): ${errBody.slice(0, 300)}`);
  }
  const data = await res.json();
  const voices = Array.isArray(data?.voices) ? data.voices : [];
  return voices
    .map((v: Record<string, unknown>) => {
      const labels: Record<string, string> = {};
      for (const k of ["accent", "gender", "age", "descriptive", "use_case"] as const) {
        if (typeof v[k] === "string" && v[k]) labels[k] = v[k] as string;
      }
      return {
        voice_id: String(v.voice_id ?? ""),
        public_owner_id: String(v.public_owner_id ?? ""),
        name: String(v.name ?? "Unnamed voice"),
        labels,
        preview_url: typeof v.preview_url === "string" ? v.preview_url : null,
        languages: [String(v.language ?? languageCode).slice(0, 2).toLowerCase()],
      } satisfies ElevenLabsLibraryVoice;
    })
    .filter((v: ElevenLabsLibraryVoice) => v.voice_id && v.public_owner_id);
}

/**
 * Add a library voice to the account so TTS can use it. Returns the account
 * voice id (normally identical to the shared id). When the plan's custom-voice
 * slots are full, the oldest non-premade voice is removed and the add retried.
 */
export async function addLibraryVoice(
  publicOwnerId: string,
  voiceId: string,
  name: string
): Promise<string> {
  const existing = await listVoices();
  const already = existing.find((v) => v.voice_id === voiceId);
  if (already) return already.voice_id;

  const attempt = () =>
    fetch(
      `${ELEVENLABS_BASE_URL}/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ new_name: name.slice(0, 80) }),
      }
    );

  let res = await attempt();
  if (!res.ok) {
    let body = await res.text();
    const slotsFull = /voice_limit|limit_reached|maximum|quota/i.test(body) || res.status === 400;
    const removable = existing.filter((v) => v.category !== "premade");
    if (slotsFull && removable.length > 0) {
      await fetch(`${ELEVENLABS_BASE_URL}/v1/voices/${encodeURIComponent(removable[0].voice_id)}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      res = await attempt();
      if (!res.ok) body = await res.text();
    }
    if (!res.ok) {
      throw new Error(`Could not add this voice to the account (${res.status}): ${body.slice(0, 200)}`);
    }
  }
  const data = (await res.json()) as { voice_id?: string };
  return data.voice_id || voiceId;
}

export interface SpeechResult {
  audio: Buffer;
  /** Character-level timing from ElevenLabs; null when the API omitted it. */
  alignment: CharacterAlignment | null;
}

/**
 * TTS with word timings. Uses the `/with-timestamps` variant of the endpoint:
 * same price as plain TTS, but the response is JSON with base64 audio plus a
 * character alignment that lib/pipeline/captions.ts turns into subtitles.
 */
export async function generateSpeech(
  text: string,
  voiceId: string
): Promise<SpeechResult> {
  const res = await fetch(
    `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`ElevenLabs TTS error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    audio_base64?: string;
    alignment?: CharacterAlignment | null;
    normalized_alignment?: CharacterAlignment | null;
  };
  if (typeof data.audio_base64 !== "string" || !data.audio_base64) {
    throw new Error("ElevenLabs TTS returned no audio.");
  }
  // `alignment` maps to the text we sent; `normalized_alignment` is the
  // spoken form (numbers expanded etc.). Captions should show the original.
  const alignment = isAlignment(data.alignment)
    ? data.alignment
    : isAlignment(data.normalized_alignment)
    ? data.normalized_alignment
    : null;

  return { audio: Buffer.from(data.audio_base64, "base64"), alignment };
}

function isAlignment(value: unknown): value is CharacterAlignment {
  if (!value || typeof value !== "object") return false;
  const a = value as Record<string, unknown>;
  return (
    Array.isArray(a.characters) &&
    Array.isArray(a.character_start_times_seconds) &&
    Array.isArray(a.character_end_times_seconds) &&
    a.characters.length > 0 &&
    a.characters.length === a.character_start_times_seconds.length
  );
}
