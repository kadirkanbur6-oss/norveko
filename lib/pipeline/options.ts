// lib/pipeline/options.ts
// Allowed values for the generation form — shared by the UI and the API so
// the server can validate exactly what the client offers.

export const PLATFORMS = [
  "YouTube Shorts",
  "TikTok",
  "Instagram Reels",
  "YouTube Long-form",
] as const;

export const STYLES = [
  "Mystery",
  "Documentary",
  "Horror",
  "Educational",
  "Ad / Promo",
  "Cinematic",
] as const;

export const DURATIONS = ["30 seconds", "60 seconds", "3 minutes", "8 minutes"] as const;

export const LANGUAGES = [
  "English",
  "Türkçe",
  "Español",
  "Deutsch",
  "Français",
  "Português",
] as const;

export function isOneOf<T extends readonly string[]>(
  list: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
