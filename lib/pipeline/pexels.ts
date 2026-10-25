// lib/pipeline/pexels.ts
// Stock B-roll search. Server-only. Two free providers are supported and the
// first one with a key configured wins:
//   - Pexels  (PEXELS_API_KEY)  — attribution "Videos provided by Pexels"
//   - Pixabay (PIXABAY_API_KEY) — attribution "Videos provided by Pixabay"
// Both require showing where the clip comes from; the UI shows the author
// link and the provider name returned on each clip.

import "server-only";

export type StockProvider = "pexels" | "pixabay";

export interface StockClip {
  id: number;
  provider: StockProvider;
  url: string;         // provider page (for attribution)
  previewImage: string;
  videoUrl: string;    // best mp4 that fits the requested orientation, ≤1080p
  width: number;
  height: number;
  durationSeconds: number;
  author: string;
  authorUrl: string;
}

export type StockOrientation = "vertical" | "horizontal";

/** Which provider is configured on this deployment, if any. */
export function stockProvider(): StockProvider | null {
  if (process.env.PEXELS_API_KEY) return "pexels";
  if (process.env.PIXABAY_API_KEY) return "pixabay";
  return null;
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
  orientation: StockOrientation,
  perPage = 6
): Promise<StockClip[]> {
  const provider = stockProvider();
  if (provider === "pexels") return searchPexels(query, orientation, perPage);
  if (provider === "pixabay") return searchPixabay(query, orientation, perPage);
  throw new Error("No stock footage provider is configured (PEXELS_API_KEY or PIXABAY_API_KEY).");
}

// ---------------------------------------------------------------- Pexels

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

async function searchPexels(
  query: string,
  orientation: StockOrientation,
  perPage: number
): Promise<StockClip[]> {
  const params = new URLSearchParams({
    query,
    orientation: orientation === "vertical" ? "portrait" : "landscape",
    size: "medium",
    per_page: String(perPage),
  });
  const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Pexels API error (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { videos?: PexelsVideo[] };

  return (data.videos ?? [])
    .map((v): StockClip | null => {
      const files = v.video_files
        .filter((f) => f.file_type === "video/mp4" && f.width && f.height)
        .filter((f) => Math.max(f.width!, f.height!) <= 1920)
        .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));
      const best = files[0];
      if (!best) return null;
      return {
        id: v.id,
        provider: "pexels" as const,
        url: v.url,
        previewImage: v.image,
        videoUrl: best.link,
        width: best.width!,
        height: best.height!,
        durationSeconds: v.duration,
        author: v.user.name,
        authorUrl: v.user.url,
      };
    })
    .filter((c): c is StockClip => c !== null);
}

// --------------------------------------------------------------- Pixabay

interface PixabayRendition {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}

interface PixabayVideo {
  id: number;
  pageURL: string;
  duration: number;
  user: string;
  user_id: number;
  videos: Partial<Record<"large" | "medium" | "small" | "tiny", PixabayRendition>>;
}

async function searchPixabay(
  query: string,
  orientation: StockOrientation,
  perPage: number
): Promise<StockClip[]> {
  // The videos endpoint has no orientation filter, so over-fetch and filter
  // by aspect ratio locally. Minimum per_page allowed by Pixabay is 3.
  const params = new URLSearchParams({
    key: process.env.PIXABAY_API_KEY!,
    q: query.slice(0, 100),
    per_page: "40",
    safesearch: "true",
  });
  const res = await fetch(`https://pixabay.com/api/videos/?${params}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Pixabay API error (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { hits?: PixabayVideo[] };

  const wantVertical = orientation === "vertical";
  const mapped: StockClip[] = (data.hits ?? [])
    .map((v): StockClip | null => {
      // Prefer the largest rendition that stays ≤1080p on its long edge.
      const renditions = [v.videos.large, v.videos.medium, v.videos.small, v.videos.tiny]
        .filter((r): r is PixabayRendition => !!r && r.width > 0 && r.height > 0)
        .filter((r) => Math.max(r.width, r.height) <= 1920)
        .sort((a, b) => b.width * b.height - a.width * a.height);
      const best = renditions[0];
      if (!best) return null;
      return {
        id: v.id,
        provider: "pixabay" as const,
        url: v.pageURL,
        previewImage: best.thumbnail,
        videoUrl: best.url,
        width: best.width,
        height: best.height,
        durationSeconds: v.duration,
        author: v.user,
        authorUrl: `https://pixabay.com/users/${encodeURIComponent(v.user)}-${v.user_id}/`,
      };
    })
    .filter((c): c is StockClip => c !== null);

  const matching = mapped.filter((c) => (c.height > c.width) === wantVertical);
  // Fall back to any orientation rather than returning nothing.
  return (matching.length >= 3 ? matching : mapped).slice(0, perPage);
}
