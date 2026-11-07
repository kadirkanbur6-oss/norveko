// lib/pipeline/tts.ts
// One entry point for narration, routed by voice id:
//   "gemini:<Name>" → Gemini TTS (WAV) + ElevenLabs forced alignment for captions
//   anything else    → ElevenLabs /with-timestamps (MP3, timings included)
// The runner calls this through deps.providers.generateSpeech.

import "server-only";
import type { CharacterAlignment } from "./captions";
import { estimateAlignment } from "./tts-estimate";
import { mapLimit, mergeAlignments, mp3Seconds, splitForTts } from "./tts-chunks";
import { NARRATION_TEMPO } from "./narration";
import { stretchPcm16 } from "./tempo";

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
  options: { speed?: number; direction?: string | null; /** false: skip the paid forced alignment (skits, talk — no captions). */ align?: boolean } = {}
): Promise<NarrationResult> {
  const { isGeminiVoiceId, geminiVoiceName, generateGeminiSpeech, pcmToWav, GEMINI_TTS_MODEL } = await import("./gemini-tts");
  if (isGeminiVoiceId(voiceId)) {
    const name = geminiVoiceName(voiceId);
    if (!name) throw new Error(`Unknown Gemini voice: ${voiceId}`);
    const speed = options.speed ?? 1;
    const direction = options.direction ?? null;
    const pace = speed > 1.03 ? "faster" : speed < 0.97 ? "slower" : null;
    const chunks = splitForTts(text);
    let speech: { audio: Buffer; contentType: "audio/wav"; seconds: number };
    // Narration (no acting direction) plays at NARRATION_TEMPO; skits/talk keep the natural pace.
    const tempo = direction ? 1 : NARRATION_TEMPO;
    if (chunks.length <= 1) {
      const one = await generateGeminiSpeech(text, name, { pace, direction });
      const pcm = stretchPcm16(one.pcm, one.sampleRate, tempo);
      speech = { audio: pcmToWav(pcm, one.sampleRate), contentType: "audio/wav", seconds: pcm.length / (one.sampleRate * 2) };
    } else {
      // Long narration: speak the chunks (a few at a time), join the PCM with
      // a short breath between them, then align the whole thing once.
      const parts = await mapLimit(chunks, 4, (chunk) => generateGeminiSpeech(chunk, name, { pace, direction }));
      const rate = parts[0].sampleRate;
      const gap = Buffer.alloc(Math.round(rate * 0.35) * 2);
      const pcm = stretchPcm16(Buffer.concat(parts.flatMap((p, i) => (i ? [gap, p.pcm] : [p.pcm]))), rate, tempo);
      speech = { audio: pcmToWav(pcm, rate), contentType: "audio/wav", seconds: pcm.length / (rate * 2) };
    }
    let alignment: CharacterAlignment | null = null;
    if (options.align !== false) try {
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
  // ElevenLabs tops out at 1.2 (clamped in generateSpeech); the duration fix multiplies on top.
  const elSpeed = options.direction ? options.speed : NARRATION_TEMPO * (options.speed ?? 1);
  const chunks = splitForTts(text);
  if (chunks.length > 1) {
    // ElevenLabs caps one request; speak in order and stitch MP3 + timings.
    const parts = await mapLimit(chunks, 2, (chunk) => generateSpeech(chunk, voiceId, { speed: elSpeed }));
    const offsets: number[] = [];
    let t = 0;
    for (const p of parts) {
      offsets.push(t);
      t += mp3Seconds(p.audio.byteLength);
    }
    const aligned = parts.every((p) => p.alignment);
    return {
      audio: Buffer.concat(parts.map((p) => p.audio)),
      alignment: aligned ? mergeAlignments(parts.map((p) => p.alignment!), offsets) : estimateAlignment(text, t),
      contentType: "audio/mpeg",
      ext: "mp3",
      usageKey: "elevenlabs:eleven_multilingual_v2",
    };
  }
  const out = await generateSpeech(text, voiceId, { speed: elSpeed });
  return { audio: out.audio, alignment: out.alignment, contentType: "audio/mpeg", ext: "mp3", usageKey: "elevenlabs:eleven_multilingual_v2" };
}


