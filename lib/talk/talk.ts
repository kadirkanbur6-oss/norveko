// lib/talk/talk.ts
// Talking character (3 Nov 2026, Kadir — "like the other sites, simple"): the
// way Hedra-style tools and the viral talking-animal / historical-figure
// videos work. One character + one line (typed and voiced, or an uploaded
// recording) + an optional setting → one picture of the character in that
// setting → lip-synced video (VEED Fabric on fal). No timeline, no edit.
//
// Stored in swap_jobs with kind = "talk" (source_path = the audio), advanced by
// the same heartbeat and polling as swaps (lib/swap/swap.ts).

import "server-only";
import { mp4Seconds } from "@/lib/swap/mp4";

export const TALK_MAX_SECONDS = 30;
export const TALK_MAX_BYTES = 8 * 1024 * 1024;
export const TALK_MAX_CHARS = 450;

export const TALK_LOOKS = [
  { id: "cinematic", label: "Realistic" },
  { id: "3d", label: "3D cartoon" },
  { id: "anime", label: "Anime" },
  { id: "painting", label: "Painting" },
] as const;

export { talkCreditsFor as talkCredits } from "@/lib/skit/pricing";
import { TALK_VIDEO_ENABLED, talkClipSeconds } from "@/lib/pipeline/fal-video";

export const AUDIO_TYPES: Record<string, "mp3" | "wav" | "m4a"> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
};

export const CONTENT_TYPES = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4" } as const;

function wavSeconds(buf: Buffer): number {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("This isn't a WAV file.");
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(offset + 16);
    else if (id === "data" && byteRate) return Math.min(size, buf.length - offset - 8) / byteRate;
    offset += 8 + size + (size % 2);
  }
  throw new Error("The WAV file has no sound.");
}

const MP3_KBPS = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG1 layer III
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG2/2.5 layer III
];
const MP3_RATES = [
  [44100, 48000, 32000], // MPEG1
  [22050, 24000, 16000], // MPEG2
  [11025, 12000, 8000], // MPEG2.5
];

/** MP3 length: Xing/Info frame count when present (VBR), else bitrate × size. */
function mp3Seconds(buf: Buffer): number {
  let pos = 0;
  if (buf.toString("latin1", 0, 3) === "ID3") {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    pos = 10 + size;
  }
  for (const end = Math.min(buf.length - 4, pos + 64 * 1024); pos < end; pos++) {
    if (buf[pos] !== 0xff || (buf[pos + 1] & 0xe0) !== 0xe0) continue;
    const version = (buf[pos + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[pos + 1] >> 1) & 3; // 1 = layer III
    const bitrateIdx = buf[pos + 2] >> 4;
    const rateIdx = (buf[pos + 2] >> 2) & 3;
    if (version === 1 || layer !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || rateIdx === 3) continue;
    const v1 = version === 3;
    const kbps = MP3_KBPS[v1 ? 0 : 1][bitrateIdx];
    const sampleRate = MP3_RATES[v1 ? 0 : version === 2 ? 1 : 2][rateIdx];
    const samplesPerFrame = v1 ? 1152 : 576;
    const mono = buf[pos + 3] >> 6 === 3;
    const side = v1 ? (mono ? 17 : 32) : mono ? 9 : 17;
    const tag = buf.toString("latin1", pos + 4 + side, pos + 8 + side);
    if ((tag === "Xing" || tag === "Info") && buf.readUInt32BE(pos + 8 + side) & 1) {
      const frames = buf.readUInt32BE(pos + 12 + side);
      if (frames > 0) return (frames * samplesPerFrame) / sampleRate;
    }
    return ((buf.length - pos) * 8) / (kbps * 1000);
  }
  throw new Error("This doesn't look like an MP3 file.");
}

export function audioSeconds(buf: Buffer, ext: "mp3" | "wav" | "m4a"): number {
  return ext === "wav" ? wavSeconds(buf) : ext === "m4a" ? mp4Seconds(buf) : mp3Seconds(buf);
}

/** The scene picture prompt: the character, where they are, talking to camera. */
export function talkImagePrompt(name: string, description: string, scene: string): string {
  const where = scene || "in a setting that suits them";
  return `${name}${description ? ` (${description})` : ""}, ${where}. ${name} is the only main subject, centred, facing the camera from the chest up, the face large, clearly visible and evenly lit, mouth slightly open as if in the middle of speaking, natural expression. Nothing covers the face or mouth.`;
}

/**
 * A typed line (TTS take "talk/aud-…") short enough for one clip is spoken by Veo
 * itself; an uploaded recording ("talk/rec-…") keeps lip-sync to the creator's own voice.
 */
export function talkClipFor(path: unknown, seconds: number): number | null {
  if (typeof path !== "string" || !/\/talk\/aud-/.test(path)) return null;
  if (!TALK_VIDEO_ENABLED) return null;
  return talkClipSeconds(seconds);
}

const STYLE_SOUND: Record<string, string> = {
  cartoon: "a high-pitched, quick, bouncy cartoon voice",
  comic: "a natural voice with big, over-the-top comic acting",
  gruff: "a deep, husky, gravelly older voice at a natural pace",
};

/** Veo prompt: the picture comes alive and says the line in the chosen voice. */
export function talkVideoPrompt(name: string, description: string, voiceId: unknown, line: string): string {
  const [, style, gender] = typeof voiceId === "string" ? voiceId.split(":") : [];
  const voice = STYLE_SOUND[style ?? ""] ?? "a natural, expressive voice";
  const who = gender === "female" ? "female" : gender === "male" ? "male" : "";
  return [
    `${name}${description ? ` (${description})` : ""} talks straight to the camera in the language of the line, with ${voice}${who ? ` (${who})` : ""}.`,
    `${name} says exactly: "${line.replace(/"/g, "'")}"`,
    "Natural lip movement matching every word, lively face, head movement and small hand gestures.",
    "Keep the character, look and framing exactly as in the picture. Light room sound only, no music, no subtitles, no text on screen.",
  ]
    .join(" ")
    .slice(0, 1800);
}

export const TALK_AVATAR_PROMPT =
  "The character speaks directly to the camera with lively, natural expressions, head movement and occasional hand gestures that match the voice. Keep the character's look exactly the same.";
