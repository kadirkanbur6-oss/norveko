// lib/storage/r2-url.ts — pure helpers for our R2 video URLs (safe in the browser).

/** Path prefix of R2 videos on our own domain (inside the TikTok-verified /media/videos/). */
export const R2_URL_PATH = "/media/videos/r2/";

/** Object key from one of our R2 URLs, or null for anything else. */
export function r2KeyFromUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    if (!u.pathname.startsWith(R2_URL_PATH)) return null;
    const key = u.pathname.slice(R2_URL_PATH.length).split("/").map(decodeURIComponent).join("/");
    // Keys are "<userId>/<jobId>/final….mp4": no traversal, no empty segments.
    if (!key || key.split("/").some((s) => !s || s === "." || s === "..")) return null;
    return key;
  } catch {
    return null;
  }
}
