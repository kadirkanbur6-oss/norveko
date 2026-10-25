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

/** ISO 639-1 code for each output language (used to pick matching voices). */
export const LANGUAGE_CODES: Record<(typeof LANGUAGES)[number], string> = {
  English: "en",
  "Türkçe": "tr",
  "Español": "es",
  Deutsch: "de",
  "Français": "fr",
  "Português": "pt",
};

export function languageCode(language: string): string {
  return (LANGUAGE_CODES as Record<string, string>)[language] ?? "en";
}

export function isOneOf<T extends readonly string[]>(
  list: T,
  value: unknown
): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Output orientation. Decides thumbnail/scene framing and the Kling aspect ratio. */
export const ORIENTATIONS = [
  { id: "vertical", label: "Vertical 9:16", hint: "Shorts · TikTok · Reels" },
  { id: "horizontal", label: "Horizontal 16:9", hint: "YouTube · desktop" },
] as const;

export type OrientationId = (typeof ORIENTATIONS)[number]["id"];

/** Sensible default for a platform; the user can override it. */
export function defaultOrientation(platform: string): OrientationId {
  return /short|tiktok|reel/i.test(platform) ? "vertical" : "horizontal";
}
