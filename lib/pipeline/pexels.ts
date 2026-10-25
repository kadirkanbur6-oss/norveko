// lib/pipeline/pexels.ts
// Stock B-roll search (Pexels). Server-only. Free API, attribution required
// ("Photos/Videos provided by Pexels") — the UI shows the photographer link.
//
// Env: PEXELS_API_KEY

import "server-only";

export interface StockClip {
  id: number;
  url: string;         // Pexels page (for attribution)
  previewImage: string;
  videoUrl: string;    // best mp4 that fits the requested orientation, ≤1080p
  width: number;
  height: number;
  durationSeconds: number;
  author: string;
  authorUrl: string;
}

interface PexelsVideoFile {
  id: number;
  quality: "hd" | "sd" | "uhd";
  file_type: string;
  width: number | null;
  height: number | null;
  link: string;
}

interface PexelsVideo {
  id: number;
  url: string;
  image: string;
  duration: number;
  width: number;
  height: number;
  user: { name: string; url: string };
  video_files: PexelsVideoFile[];
}

function key(): string {
  const k = process.env.PEXELS_API_KEY;
  if (!k) throw new Error("PEXELS_API_KEY is not set.");
  return k;
}

/**
 * Turn a cinematic scene prompt into a short stock-search query:
 * keep the first clause, drop camera/lighting jargon.
 */
export function stockQueryFromPrompt(prompt: string): string {
  const first = prompt.split(/[.;:\n]/)[0] ?? prompt;
  return first
    .replace(/\b(cinematic|slow[- ]?motion|close[- ]?up|wide shot|drone|aerial|4k|8k|hyper[- ]?realistic|dramatic lighting|golden hour|volumetric|bokeh|depth of field|dolly|pan|tilt|tracking shot|film grain|photorealistic|ultra[- ]?detailed)\b/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 6)
    .join(" ") || "abstract background";
}

export async function searchStockClips(
  query: string,
  orientation: "vertical" | "horizontal",
  perPage = 6
): Promise<StockClip[]> {
  const params = new URLSearchParams({
    query,
    orientation: orientation === "vertical" ? "portrait" : "landscape",
    size: "medium",
    per_page: String(perPage),
  });
  const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
    headers: { Authorization: key() },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Pexels API error (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { videos?: PexelsVideo[] };

  return (data.videos ?? [])
    .map((v) => {
      const files = v.video_files
        .filter((f) => f.file_type === "video/mp4" && f.width && f.height)
        .filter((f) => Math.max(f.width!, f.height!) <= 1920)
        .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));
      const best = files[0];
      if (!best) return null;
      return {
        id: v.id,
        url: v.url,
        previewImage: v.image,
        videoUrl: best.link,
        width: best.width!,
        height: best.height!,
        durationSeconds: v.duration,
        author: v.user.name,
        authorUrl: v.user.url,
      } satisfies StockClip;
    })
    .filter((c): c is StockClip => c !== null);
}
