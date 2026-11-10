// lib/ambient/playlist.ts — pure helpers for the ambient music video (no I/O, unit tested).

/** Small deterministic PRNG so a job's playlist is the same on every retry. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/**
 * Track order for a video of `totalSeconds`: every song once in a shuffled order, then again in
 * a new shuffled order (never the same song twice in a row), until the total is covered.
 */
export function buildPlaylist(durations: number[], totalSeconds: number, seed: string): number[] {
  const usable = durations.map((d, i) => ({ d, i })).filter((t) => t.d >= 5);
  if (usable.length === 0) return [];
  const rand = rng(seed);
  const order: number[] = [];
  let covered = 0;
  let last = -1;
  while (covered < totalSeconds) {
    const round = usable.map((t) => t.i);
    for (let k = round.length - 1; k > 0; k--) {
      const j = Math.floor(rand() * (k + 1));
      [round[k], round[j]] = [round[j], round[k]];
    }
    if (round.length > 1 && round[0] === last) [round[0], round[1]] = [round[1], round[0]];
    for (const i of round) {
      order.push(i);
      covered += durations[i];
      last = i;
      if (covered >= totalSeconds) break;
    }
  }
  return order;
}

export interface Chunk {
  /** Indexes into the track list, in play order. */
  items: number[];
  /** Length of this part of the video, seconds. */
  seconds: number;
}

/** Cut the playlist into parts of about `chunkSeconds`; the last part ends exactly at `totalSeconds`. */
export function chunkPlaylist(order: number[], durations: number[], totalSeconds: number, chunkSeconds: number): Chunk[] {
  const chunks: Chunk[] = [];
  let items: number[] = [];
  let sum = 0;
  let elapsed = 0;
  for (const i of order) {
    items.push(i);
    sum += durations[i];
    if (sum >= chunkSeconds && elapsed + sum < totalSeconds) {
      chunks.push({ items, seconds: sum });
      elapsed += sum;
      items = [];
      sum = 0;
    }
  }
  if (items.length) chunks.push({ items, seconds: Math.min(sum, totalSeconds - elapsed) });
  return chunks;
}
