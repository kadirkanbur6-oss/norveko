// lib/pipeline/elevenlabs.ts
// ElevenLabs voice list + TTS helperleri. Server-side only.

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
const ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";

if (!process.env.ELEVENLABS_API_KEY) {
  throw new Error("ELEVENLABS_API_KEY environment değişkeni tanımlı değil.");
}

export interface ElevenLabsVoiceSummary {
  voice_id: string;
  name: string;
  labels: Record<string, string>;
  preview_url: string | null;
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
    throw new Error(`ElevenLabs voices API hatası (${res.status}): ${errBody.slice(0, 300)}`);
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
    }))
    .filter((voice: ElevenLabsVoiceSummary) => voice.voice_id.length > 0);
}

export async function generateSpeech(
  text: string,
  voiceId: string
): Promise<Buffer> {
  const res = await fetch(
    `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL_ID,
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`ElevenLabs TTS hatası (${res.status}): ${errBody.slice(0, 300)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}