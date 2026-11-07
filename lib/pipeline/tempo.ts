// lib/pipeline/tempo.ts
// Speed up narration without changing the voice's pitch (WSOLA time-stretch on
// 16-bit mono PCM). Gemini TTS has no numeric speed control and its narrators
// read slowly; 1.25× sounded right (7 Nov 2026, Yağmur). Pure, no dependencies.

/**
 * Time-stretch little-endian 16-bit mono PCM by `tempo` (> 1 = faster, same pitch).
 * Waveform-similarity overlap-add: 30 ms Hann frames, 50 % overlap, each next
 * frame picked within ±10 ms where it best continues the previous one.
 */
export function stretchPcm16(pcm: Buffer, sampleRate: number, tempo: number): Buffer {
  if (!(tempo > 0) || Math.abs(tempo - 1) < 0.01) return pcm;
  const n = Math.floor(pcm.length / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = pcm.readInt16LE(i * 2);

  const frame = Math.max(64, Math.round(sampleRate * 0.03) & ~1);
  const hop = frame / 2; // synthesis hop
  const delta = Math.round(sampleRate * 0.01);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  if (n < frame * 2) return pcm;

  const outLen = Math.ceil(n / tempo) + frame;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);

  // Similarity of x[a..] and x[b..] over the overlap, on every `step`-th sample.
  const corr = (a: number, b: number, step: number) => {
    let s = 0;
    for (let i = 0; i < hop; i += step) s += x[a + i] * x[b + i];
    return s;
  };

  let prev = 0;
  let written = 0;
  for (let k = 0; ; k++) {
    const outPos = k * hop;
    const nominal = Math.round(k * hop * tempo);
    let pos = nominal;
    if (k > 0) {
      const want = prev + hop; // where the previous frame naturally continues
      if (want + hop > n) break;
      const lo = Math.max(0, nominal - delta);
      const hi = Math.min(n - frame, nominal + delta);
      if (lo > hi) break;
      // Coarse search, then refine around the best match.
      let best = lo;
      let bestScore = -Infinity;
      for (let p = lo; p <= hi; p += 2) {
        const sc = corr(p, want, 4);
        if (sc > bestScore) { bestScore = sc; best = p; }
      }
      const rLo = Math.max(lo, best - 2);
      const rHi = Math.min(hi, best + 2);
      bestScore = -Infinity;
      for (let p = rLo; p <= rHi; p++) {
        const sc = corr(p, want, 1);
        if (sc > bestScore) { bestScore = sc; pos = p; }
      }
    }
    if (pos + frame > n || outPos + frame > outLen) break;
    for (let i = 0; i < frame; i++) {
      out[outPos + i] += x[pos + i] * win[i];
      norm[outPos + i] += win[i];
    }
    prev = pos;
    written = outPos + frame;
  }

  // Trim the faded tail of the last frame to where the overlap is complete.
  const len = Math.max(0, written - hop);
  const res = Buffer.alloc(len * 2);
  for (let i = 0; i < len; i++) {
    const v = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
    res.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v))), i * 2);
  }
  return res;
}
