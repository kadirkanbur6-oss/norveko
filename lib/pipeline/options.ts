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

/**
 * Output languages. Every entry is supported by ElevenLabs Multilingual v2
 * (script + voiceover) — the native label is what the user sees, the English
 * name goes into the LLM prompt, the ISO code drives voice matching.
 */
export const LANGUAGE_OPTIONS = [
  { label: "English", english: "English", code: "en", flag: "🇬🇧" },
  { label: "Türkçe", english: "Turkish", code: "tr", flag: "🇹🇷" },
  { label: "Español", english: "Spanish", code: "es", flag: "🇪🇸" },
  { label: "Deutsch", english: "German", code: "de", flag: "🇩🇪" },
  { label: "Français", english: "French", code: "fr", flag: "🇫🇷" },
  { label: "Português", english: "Portuguese", code: "pt", flag: "🇧🇷" },
  { label: "Italiano", english: "Italian", code: "it", flag: "🇮🇹" },
  { label: "Nederlands", english: "Dutch", code: "nl", flag: "🇳🇱" },
  { label: "Polski", english: "Polish", code: "pl", flag: "🇵🇱" },
  { label: "Русский", english: "Russian", code: "ru", flag: "🇷🇺" },
  { label: "Українська", english: "Ukrainian", code: "uk", flag: "🇺🇦" },
  { label: "العربية", english: "Arabic", code: "ar", flag: "🇸🇦" },
  { label: "हिन्दी", english: "Hindi", code: "hi", flag: "🇮🇳" },
  { label: "日本語", english: "Japanese", code: "ja", flag: "🇯🇵" },
  { label: "中文", english: "Chinese", code: "zh", flag: "🇨🇳" },
  { label: "한국어", english: "Korean", code: "ko", flag: "🇰🇷" },
  { label: "Bahasa Indonesia", english: "Indonesian", code: "id", flag: "🇮🇩" },
  { label: "Bahasa Melayu", english: "Malay", code: "ms", flag: "🇲🇾" },
  { label: "Filipino", english: "Filipino", code: "fil", flag: "🇵🇭" },
  { label: "Svenska", english: "Swedish", code: "sv", flag: "🇸🇪" },
  { label: "Dansk", english: "Danish", code: "da", flag: "🇩🇰" },
  { label: "Suomi", english: "Finnish", code: "fi", flag: "🇫🇮" },
  { label: "Čeština", english: "Czech", code: "cs", flag: "🇨🇿" },
  { label: "Slovenčina", english: "Slovak", code: "sk", flag: "🇸🇰" },
  { label: "Română", english: "Romanian", code: "ro", flag: "🇷🇴" },
  { label: "Български", english: "Bulgarian", code: "bg", flag: "🇧🇬" },
  { label: "Hrvatski", english: "Croatian", code: "hr", flag: "🇭🇷" },
  { label: "Ελληνικά", english: "Greek", code: "el", flag: "🇬🇷" },
  { label: "தமிழ்", english: "Tamil", code: "ta", flag: "🇮🇳" },
] as const;

export type LanguageLabel = (typeof LANGUAGE_OPTIONS)[number]["label"];

export const LANGUAGES = LANGUAGE_OPTIONS.map((l) => l.label) as unknown as readonly LanguageLabel[] & string[];

export function languageOption(label: string) {
  return LANGUAGE_OPTIONS.find((l) => l.label === label) ?? LANGUAGE_OPTIONS[0];
}

/** ISO 639-1 code (used to pick matching voices). */
export function languageCode(label: string): string {
  return languageOption(label).code;
}

/** English name for prompts, e.g. "Turkish (Türkçe)". */
export function languagePromptName(label: string): string {
  const l = languageOption(label);
  return l.english === l.label ? l.english : `${l.english} (${l.label})`;
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
