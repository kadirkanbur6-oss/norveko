// lib/pipeline/audio-cut.ts
// Cut a stretch of the narration (no ffmpeg on the server): exact for our
// WAV voice-overs (Gemini), frame-approximate for constant-bitrate MP3
// (ElevenLabs) — decoders resync on the next frame header.

/** Seconds from..to of a WAV file, as a new WAV. */
export function cutWav(wav: Buffer, from: number, to: number): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Not a WAV file");
  let offset = 12;
  let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = { channels: wav.readUInt16LE(body + 2), sampleRate: wav.readUInt32LE(body + 4), bits: wav.readUInt16LE(body + 14) };
    } else if (id === "data" && fmt) {
      const frame = fmt.channels * (fmt.bits / 8);
      const dataEnd = Math.min(wav.length, body + size);
      const start = body + Math.max(0, Math.floor(from * fmt.sampleRate)) * frame;
      const end = Math.min(dataEnd, body + Math.ceil(to * fmt.sampleRate) * frame);
      const pcm = wav.subarray(Math.min(start, end), end);
      const header = Buffer.alloc(44);
      header.write("RIFF", 0);
      header.writeUInt32LE(36 + pcm.length, 4);
      header.write("WAVE", 8);
      header.write("fmt ", 12);
      header.writeUInt32LE(16, 16);
      header.writeUInt16LE(1, 20);
      header.writeUInt16LE(fmt.channels, 22);
      header.writeUInt32LE(fmt.sampleRate, 24);
      header.writeUInt32LE(fmt.sampleRate * frame, 28);
      header.writeUInt16LE(frame, 32);
      header.writeUInt16LE(fmt.bits, 34);
      header.write("data", 36);
      header.writeUInt32LE(pcm.length, 40);
      return Buffer.concat([header, pcm]);
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no audio data");
}

/** Seconds from..to of a constant-bitrate MP3 that lasts `totalSeconds`. */
export function cutMp3(mp3: Buffer, from: number, to: number, totalSeconds: number): Buffer {
  if (!(totalSeconds > 0)) throw new Error("Unknown MP3 length");
  const perSecond = mp3.length / totalSeconds;
  const start = Math.max(0, Math.floor(from * perSecond));
  const end = Math.min(mp3.length, Math.ceil(to * perSecond));
  // Start on a frame header (0xFFE sync word) so players don't choke.
  let s = start;
  while (s < Math.min(end, start + 4096) && !(mp3[s] === 0xff && (mp3[s + 1] & 0xe0) === 0xe0)) s++;
  return mp3.subarray(s < end ? s : start, end);
}

export function cutAudio(buf: Buffer, ext: string, from: number, to: number, totalSeconds: number): Buffer {
  return ext === "wav" ? cutWav(buf, from, to) : cutMp3(buf, from, to, totalSeconds);
}
