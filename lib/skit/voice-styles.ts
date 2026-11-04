// lib/skit/voice-styles.ts
// Character voices for skits and talking characters (4 Nov 2026, Kadir: "in
// these animations only these 3 options"). Client-safe: the UI imports the
// list; the server also uses applyVoiceStyle() on Gemini's WAV output.
//
//   cartoon — high and quick, like the viral cockroach / chick videos: the take
//             is pitched up by resampling (faster + higher, the classic effect)
//   comic   — over-the-top acting in a natural voice (no processing)
//   gruff   — deep, husky older voice: pitched down a little

export type VoiceStyle = "cartoon" | "comic" | "gruff";
export type VoiceGender = "male" | "female";

export const VOICE_STYLES: Array<{ id: VoiceStyle; label: string; hint: string }> = [
  { id: "cartoon", label: "Cartoon", hint: "High and quick, like the viral animal videos" },
  { id: "comic", label: "Comic", hint: "Natural voice, over-the-top acting" },
  { id: "gruff", label: "Gruff", hint: "Deep and husky, an older voice" },
];

export const DEFAULT_VOICE_STYLE: VoiceStyle = "cartoon";

export function isVoiceStyle(v: unknown): v is VoiceStyle {
  return v === "cartoon" || v === "comic" || v === "gruff";
}

/** Gemini narrators that suit each style (several, so characters sound different). */
const STYLE_VOICES: Record<VoiceStyle, Record<VoiceGender, string[]>> = {
  cartoon: { male: ["Puck", "Fenrir", "Iapetus"], female: ["Zephyr", "Aoede", "Kore"] },
  comic: { male: ["Fenrir", "Puck", "Orus"], female: ["Kore", "Zephyr", "Aoede"] },
  gruff: { male: ["Algenib", "Charon", "Orus"], female: ["Gacrux", "Sulafat", "Kore"] },
};

/** The n-th voice for this style and gender (n = how many such characters came before). */
export function voiceFor(style: VoiceStyle, gender: VoiceGender, n = 0): string {
  const list = STYLE_VOICES[style][gender];
  return list[n % list.length];
}

/** Playback-speed factor of the take (> 1 = higher and faster). */
export const STYLE_RATE: Record<VoiceStyle, number> = { cartoon: 1.3, comic: 1, gruff: 0.9 };

/** How the TTS should act the line before any processing. */
export function styleDirection(style: VoiceStyle, who: string, tone?: string): string {
  const how = tone || "expressively";
  if (style === "cartoon")
    return `Perform this line as ${who}, a silly cartoon character in a comedy sketch, ${how} — bouncy, playful, exaggerated, quick. Acted, not narrated. Say only the line`;
  if (style === "gruff")
    return `Perform this line as ${who}, a gruff, husky, older character in a comedy sketch, ${how} — low, raspy, heavy, unhurried. Acted, not narrated. Say only the line`;
  return `Perform this line as ${who} in a comedy sketch, ${how} — big, over-the-top comic acting with lots of emotion, like a sitcom. Acted, not narrated. Say only the line`;
}

/**
 * Pitch the take up or down by resampling 16-bit mono PCM (keeps the file's
 * sample rate, so every player and lip-sync model reads it normally). Returns
 * the input unchanged when it isn't a plain PCM WAV or the style needs nothing.
 */
export function applyVoiceStyle(wav: Buffer, style: VoiceStyle): Buffer {
  const factor = STYLE_RATE[style];
  if (factor === 1) return wav;
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return wav;
  let offset = 12;
  let fmt = -1;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") fmt = offset + 8;
    else if (id === "data" && fmt >= 0) {
      const format = wav.readUInt16LE(fmt);
      const channels = wav.readUInt16LE(fmt + 2);
      const bits = wav.readUInt16LE(fmt + 14);
      if (format !== 1 || channels !== 1 || bits !== 16) return wav;
      const start = offset + 8;
      const count = Math.floor(Math.min(size, wav.length - start) / 2);
      const outCount = Math.floor(count / factor);
      const out = Buffer.alloc(outCount * 2);
      for (let i = 0; i < outCount; i++) {
        const pos = i * factor;
        const j = Math.floor(pos);
        const a = wav.readInt16LE(start + j * 2);
        const b = j + 1 < count ? wav.readInt16LE(start + (j + 1) * 2) : a;
        out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * (pos - j)))), i * 2);
      }
      const header = Buffer.from(wav.subarray(0, start));
      header.writeUInt32LE(header.length - 8 + out.length, 4);
      header.writeUInt32LE(out.length, start - 4);
      return Buffer.concat([header, out]);
    }
    offset += 8 + size + (size % 2);
  }
  return wav;
}
