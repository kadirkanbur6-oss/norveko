// lib/pipeline/gemini-tts.ts
// Gemini text-to-speech (default narrator since 31 Oct 2026 — picked in the
// model lab over ElevenLabs for natural Turkish documentary delivery, at
// ~$0.03 per 60 s). Gemini returns raw 24 kHz PCM, which we wrap as WAV. It
// gives no timings, so word-timed subtitles come from ElevenLabs forced
// alignment (see tts.ts). Server-only; env is checked at call time.

import "server-only";

export const GEMINI_TTS_MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-pro-preview-tts";

/** Voice ids are stored as "gemini:<Name>" so the runner can route them. */
export const GEMINI_VOICE_PREFIX = "gemini:";

export interface GeminiVoice {
  name: string;
  style: string;
  gender: "male" | "female";
}

/** Curated narration voices (Gemini prebuilt voices; all multilingual). */
export const GEMINI_VOICES: GeminiVoice[] = [
  { name: "Charon", style: "Informative documentary narrator", gender: "male" },
  { name: "Orus", style: "Firm, authoritative", gender: "male" },
  { name: "Algenib", style: "Gravelly, cinematic", gender: "male" },
  { name: "Iapetus", style: "Clear, steady", gender: "male" },
  { name: "Sadaltager", style: "Knowledgeable storyteller", gender: "male" },
  { name: "Fenrir", style: "Excitable, energetic", gender: "male" },
  { name: "Puck", style: "Upbeat, social", gender: "male" },
  { name: "Enceladus", style: "Breathy, intimate", gender: "male" },
  { name: "Kore", style: "Firm, confident", gender: "female" },
  { name: "Gacrux", style: "Mature, warm narrator", gender: "female" },
  { name: "Sulafat", style: "Warm storyteller", gender: "female" },
  { name: "Erinome", style: "Clear, educational", gender: "female" },
  { name: "Despina", style: "Smooth, calm", gender: "female" },
  { name: "Zephyr", style: "Bright, lively", gender: "female" },
  { name: "Aoede", style: "Breezy, friendly", gender: "female" },
  { name: "Achernar", style: "Soft, gentle", gender: "female" },
];

export function isGeminiVoiceId(voiceId: string | null | undefined): boolean {
  return typeof voiceId === "string" && voiceId.startsWith(GEMINI_VOICE_PREFIX);
}

export function geminiVoiceName(voiceId: string): string | null {
  const name = voiceId.slice(GEMINI_VOICE_PREFIX.length);
  return GEMINI_VOICES.some((v) => v.name === name) ? name : null;
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface GeminiSpeech {
  audio: Buffer;
  contentType: "audio/wav";
  seconds: number;
}

/**
 * Speak `text` with a Gemini voice. `pace` nudges delivery for the
 * duration fix (Gemini has no numeric speed control).
 */
export async function generateGeminiSpeech(
  text: string,
  voiceName: string,
  options: { pace?: "slower" | "faster" | null } = {}
): Promise<GeminiSpeech> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set.");
  const pace =
    options.pace === "faster"
      ? " at a slightly brisker pace than usual, without rushing"
      : options.pace === "slower"
        ? " at a slightly slower, more deliberate pace"
        : "";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_TTS_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Read this as a calm, gripping documentary narrator${pace}: ${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
    }
  );
  if (!res.ok) {
    const body = (await res.text()).replace(/\s+/g, " ").slice(0, 300);
    throw new Error(`Gemini TTS error (${res.status}): ${body}`);
  }
  const data = await res.json();
  const part = (data?.candidates?.[0]?.content?.parts ?? []).find(
    (p: { inlineData?: { data?: string } }) => p?.inlineData?.data
  );
  if (!part) throw new Error("Gemini TTS returned no audio.");
  const mime: string = part.inlineData.mimeType ?? "audio/L16;rate=24000";
  const rate = Number(mime.match(/rate=(\d+)/)?.[1] ?? 24000);
  const pcm = Buffer.from(part.inlineData.data, "base64");
  return { audio: pcmToWav(pcm, rate), contentType: "audio/wav", seconds: pcm.length / (rate * 2) };
}
