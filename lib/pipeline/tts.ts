// lib/pipeline/tts.ts
// One entry point for narration, routed by voice id:
//   "gemini:<Name>" → Gemini TTS (WAV) + ElevenLabs forced alignment for captions
//   anything else    → ElevenLabs /with-timestamps (MP3, timings included)
// The runner calls this through deps.providers.generateSpeech.

import "server-only";
import type { CharacterAlignment } from "./captions";
import { estimateAlignment } from "./tts-estimate";

export interface NarrationResult {
  audio: Buffer;
  alignment: CharacterAlignment | null;
  contentType: string;
  ext: "mp3" | "wav";
  /** "provider:model" for the cost log. */
  usageKey: string;
}

export async function synthesizeNarration(
  text: string,
  voiceId: string,
  options: { speed?: number } = {}
): Promise<NarrationResult> {
  const { isGeminiVoiceId, geminiVoiceName, generateGeminiSpeech, GEMINI_TTS_MODEL } = await import("./gemini-tts");
  if (isGeminiVoiceId(voiceId)) {
    const name = geminiVoiceName(voiceId);
    if (!name) throw new Error(`Unknown Gemini voice: ${voiceId}`);
    const speed = options.speed ?? 1;
    const pace = speed > 1.03 ? "faster" : speed < 0.97 ? "slower" : null;
    const speech = await generateGeminiSpeech(text, name, { pace });
    let alignment: CharacterAlignment | null = null;
    try {
      const { forceAlign } = await import("./elevenlabs");
      alignment = await forceAlign(speech.audio, text, speech.contentType);
    } catch (err) {
      console.warn("[tts] forced alignment failed:", err instanceof Error ? err.message : err);
    }
    // Never ship a narration without timings: spread the characters over the
    // real audio length (pauses at punctuation), so captions, the duration
    // check and the timeline still work if alignment is unavailable.
    if (!alignment) alignment = estimateAlignment(text, speech.seconds);
    return { audio: speech.audio, alignment, contentType: speech.contentType, ext: "wav", usageKey: `gemini:${GEMINI_TTS_MODEL}` };
  }
  const { generateSpeech } = await import("./elevenlabs");
  const out = await generateSpeech(text, voiceId, { speed: options.speed });
  return { audio: out.audio, alignment: out.alignment, contentType: "audio/mpeg", ext: "mp3", usageKey: "elevenlabs:eleven_multilingual_v2" };
}


