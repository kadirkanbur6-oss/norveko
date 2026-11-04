// lib/swap/mp4.ts
// Just enough ISO-BMFF (MP4 / MOV) reading to price and frame a character
// swap without ffmpeg: duration, video frame count, size and rotation.

export interface Mp4Info {
  seconds: number;
  frames: number;
  fps: number;
  width: number;
  height: number;
  /** Width/height as shown (rotation applied). */
  vertical: boolean;
}

type Box = { type: string; start: number; end: number; body: number };

function* boxes(buf: Buffer, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield { type, start: pos, end: pos + size, body: pos + header };
    pos += size;
  }
}

function find(buf: Buffer, parent: Box | { body: number; end: number }, type: string): Box | null {
  for (const b of boxes(buf, parent.body, parent.end)) if (b.type === type) return b;
  return null;
}

/** Length in seconds of any MP4/MOV/M4A file (movie header). */
export function mp4Seconds(buf: Buffer): number {
  const moov = find(buf, { body: 0, end: buf.length }, "moov");
  if (!moov) throw new Error("This doesn't look like an MP4/MOV/M4A file (or its index is missing).");
  const mvhd = find(buf, moov, "mvhd");
  if (!mvhd) throw new Error("The file has no duration.");
  const v = buf.readUInt8(mvhd.body);
  const timescale = v === 1 ? buf.readUInt32BE(mvhd.body + 20) : buf.readUInt32BE(mvhd.body + 12);
  const duration = v === 1 ? Number(buf.readBigUInt64BE(mvhd.body + 24)) : buf.readUInt32BE(mvhd.body + 16);
  if (timescale && duration) return duration / timescale;
  // Fragmented MP4 (e.g. Pixabay downloads): the movie header says 0; use mvex/mehd, else the fragments.
  const mvex = find(buf, moov, "mvex");
  const mehd = mvex && find(buf, mvex, "mehd");
  if (mehd && timescale) {
    const mv = buf.readUInt8(mehd.body);
    const d = mv === 1 ? Number(buf.readBigUInt64BE(mehd.body + 4)) : buf.readUInt32BE(mehd.body + 4);
    if (d) return d / timescale;
  }
  const frag = fragmentStats(buf, moov);
  return frag ? frag.seconds : 0;
}

/** Video-track sample count and length from the fragments (moof/traf/trun) of a fragmented MP4. */
function fragmentStats(buf: Buffer, moov: Box): { seconds: number; frames: number } | null {
  // The video track's id and media timescale.
  let trackId = 0;
  let timescale = 0;
  for (const trak of boxes(buf, moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = find(buf, trak, "mdia");
    const hdlr = mdia && find(buf, mdia, "hdlr");
    if (!mdia || !hdlr || buf.toString("latin1", hdlr.body + 8, hdlr.body + 12) !== "vide") continue;
    const tkhd = find(buf, trak, "tkhd");
    const mdhd = find(buf, mdia, "mdhd");
    if (!tkhd || !mdhd) continue;
    trackId = buf.readUInt32BE(tkhd.body + (buf.readUInt8(tkhd.body) === 1 ? 20 : 12));
    timescale = buf.readUInt32BE(mdhd.body + (buf.readUInt8(mdhd.body) === 1 ? 20 : 12));
    break;
  }
  if (!trackId || !timescale) return null;
  // Defaults from trex (mvex), overridden per fragment by tfhd.
  let trexDuration = 0;
  const mvex = find(buf, moov, "mvex");
  if (mvex) for (const b of boxes(buf, mvex.body, mvex.end)) {
    if (b.type === "trex" && buf.readUInt32BE(b.body + 4) === trackId) trexDuration = buf.readUInt32BE(b.body + 12);
  }
  let ticks = 0;
  let frames = 0;
  for (const moof of boxes(buf, 0, buf.length)) {
    if (moof.type !== "moof") continue;
    for (const traf of boxes(buf, moof.body, moof.end)) {
      if (traf.type !== "traf") continue;
      const tfhd = find(buf, traf, "tfhd");
      if (!tfhd || buf.readUInt32BE(tfhd.body + 4) !== trackId) continue;
      const tfFlags = buf.readUInt32BE(tfhd.body) & 0xffffff;
      let o = tfhd.body + 8;
      if (tfFlags & 0x01) o += 8;
      if (tfFlags & 0x02) o += 4;
      const defDuration = tfFlags & 0x08 ? buf.readUInt32BE(o) : trexDuration;
      for (const trun of boxes(buf, traf.body, traf.end)) {
        if (trun.type !== "trun") continue;
        const flags = buf.readUInt32BE(trun.body) & 0xffffff;
        const count = buf.readUInt32BE(trun.body + 4);
        let q = trun.body + 8;
        if (flags & 0x01) q += 4;
        if (flags & 0x04) q += 4;
        const per = (flags & 0x100 ? 4 : 0) + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
        frames += count;
        if (flags & 0x100) {
          for (let i = 0; i < count && q + 4 <= trun.end; i++, q += per) ticks += buf.readUInt32BE(q);
        } else ticks += count * defDuration;
      }
    }
  }
  return frames ? { seconds: ticks / timescale, frames } : null;
}

export function readMp4(buf: Buffer): Mp4Info {
  const moov = find(buf, { body: 0, end: buf.length }, "moov");
  if (!moov) throw new Error("This doesn't look like an MP4/MOV video (or its index is missing).");
  const seconds = mp4Seconds(buf);

  for (const trak of boxes(buf, moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = find(buf, trak, "mdia");
    const hdlr = mdia && find(buf, mdia, "hdlr");
    if (!hdlr || buf.toString("latin1", hdlr.body + 8, hdlr.body + 12) !== "vide") continue;
    const tkhd = find(buf, trak, "tkhd");
    let width = 0;
    let height = 0;
    let rotated = false;
    if (tkhd) {
      const tv = buf.readUInt8(tkhd.body);
      const matrix = tkhd.body + (tv === 1 ? 52 : 40);
      const a = buf.readInt32BE(matrix);
      const b = buf.readInt32BE(matrix + 4);
      rotated = a === 0 && b !== 0;
      width = buf.readUInt32BE(matrix + 36) / 65536;
      height = buf.readUInt32BE(matrix + 40) / 65536;
    }
    const stbl = mdia && find(buf, mdia, "minf") && find(buf, find(buf, mdia, "minf")!, "stbl");
    let frames = 0;
    if (stbl) {
      const stsz = find(buf, stbl, "stsz") ?? find(buf, stbl, "stz2");
      if (stsz) frames = buf.readUInt32BE(stsz.body + 8);
    }
    if (!frames) frames = fragmentStats(buf, moov)?.frames ?? 0;
    const shownW = rotated ? height : width;
    const shownH = rotated ? width : height;
    return {
      seconds,
      frames: frames || Math.round(seconds * 30),
      fps: seconds ? (frames || seconds * 30) / seconds : 30,
      width: Math.round(shownW),
      height: Math.round(shownH),
      vertical: shownH > shownW,
    };
  }
  throw new Error("The file has no video track.");
}
