// lib/pipeline/visual-styles.ts
// Look presets (31 Oct 2026): the visual style drives every generated image
// (scene stills, image→video clips, text→video clips, thumbnail); the caption
// style drives the burned-in subtitles of full videos. Pure — shared by the
// /chat UI, the start route, the runner and the Shotstack edit builder.

export interface VisualStyle {
  id: string;
  label: string;
  hint: string;
  /** Leads the scene-still prompt (the scene description follows). */
  still: string;
  /** Appended to text→video / image→video clip prompts. */
  clip: string;
  /** Appended to the thumbnail prompt. */
  thumbnail: string;
}

const NO_TEXT = "Absolutely no text, letters, captions, subtitles, watermarks or logos anywhere in the image.";

export const VISUAL_STYLES: readonly VisualStyle[] = [
  {
    id: "cinematic",
    label: "Cinematic",
    hint: "Photoreal, film lighting",
    still:
      "Photorealistic cinematic film still from a high-budget documentary, shot on a full-frame cinema camera with a 35mm lens, shallow depth of field, volumetric light, rich colour grading, fine surface texture, strong subject in focus.",
    clip: "Photorealistic, cinematic lighting, smooth camera movement.",
    thumbnail: "Photorealistic, cinematic lighting.",
  },
  {
    id: "archive",
    label: "Archival film",
    hint: "Grainy 1960s footage",
    still:
      "Authentic archival photograph from the 1950s–1970s, shot on 16mm film, heavy film grain, faded colours, slight vignette, soft focus edges, documentary realism.",
    clip: "Vintage 16mm archival film look, film grain, faded colours, slight flicker.",
    thumbnail: "Vintage archival film photo look with grain.",
  },
  {
    id: "dark",
    label: "Dark & eerie",
    hint: "Moody horror atmosphere",
    still:
      "Dark atmospheric horror film still, low-key lighting, deep shadows, cold desaturated blue-green palette, fog and haze, unsettling stillness, photorealistic.",
    clip: "Dark eerie atmosphere, low-key lighting, fog, slow creeping camera movement.",
    thumbnail: "Dark, eerie, high-contrast horror atmosphere.",
  },
  {
    id: "anime",
    label: "Anime",
    hint: "Hand-drawn Japanese animation",
    still:
      "High-quality Japanese anime illustration, detailed hand-painted background, clean line art, cel shading, vibrant but natural colours, dramatic composition.",
    clip: "Anime style animation, cel shading, hand-painted background.",
    thumbnail: "Anime illustration style, bold colours.",
  },
  {
    id: "3d",
    label: "3D animation",
    hint: "Soft stylised 3D render",
    still:
      "Stylised 3D animated film still, soft global illumination, rounded friendly shapes, subsurface scattering, warm colour palette, high-end animation studio quality, original characters only.",
    clip: "Stylised 3D animation, soft lighting, smooth motion.",
    thumbnail: "Stylised 3D render, soft lighting, vivid colours.",
  },
  {
    id: "painting",
    label: "Oil painting",
    hint: "Classical painted look",
    still:
      "Classical oil painting on canvas, visible brush strokes, rich chiaroscuro lighting, museum-quality fine art, dramatic historical composition.",
    clip: "Living oil painting, visible brush strokes, gentle painterly motion.",
    thumbnail: "Classical oil painting style.",
  },
  {
    id: "comic",
    label: "Graphic novel",
    hint: "Inked comic panels",
    still:
      "Graphic novel illustration, bold black ink outlines, cross-hatching, flat shadows, limited dramatic colour palette, cinematic panel composition.",
    clip: "Graphic novel style, bold ink lines, flat colours.",
    thumbnail: "Bold graphic novel illustration style.",
  },
  {
    id: "watercolor",
    label: "Watercolour",
    hint: "Soft storybook paint",
    still:
      "Delicate watercolour illustration, soft bleeding pigments on textured paper, light airy palette, storybook feel.",
    clip: "Watercolour illustration style, soft gentle motion.",
    thumbnail: "Soft watercolour illustration style.",
  },
] as const;

export const DEFAULT_VISUAL_STYLE = "cinematic";

export function visualStyle(id: string | null | undefined): VisualStyle {
  return VISUAL_STYLES.find((s) => s.id === id) ?? VISUAL_STYLES[0];
}

export function isVisualStyle(id: unknown): id is string {
  return typeof id === "string" && VISUAL_STYLES.some((s) => s.id === id);
}

/** Full prompt for a scene still in the chosen style. */
export function stillPrompt(scene: string, styleId: string | null | undefined, aspectRatio: string): string {
  return `${visualStyle(styleId).still} ${aspectRatio} aspect ratio. ${NO_TEXT} ${scene}`;
}

/** Clip prompt in the chosen style (the cinematic default leaves prompts unchanged). */
export function clipPrompt(scene: string, styleId: string | null | undefined): string {
  if (!styleId || styleId === DEFAULT_VISUAL_STYLE) return scene;
  return `${scene}. ${visualStyle(styleId).clip}`;
}

/* ---------------- Caption styles (burned-in subtitles) ---------------- */

export interface CaptionStyle {
  id: string;
  label: string;
  hint: string;
  /** Uppercase the SRT (locale-aware, done server-side). */
  uppercase: boolean;
  font: string;
  /** Size for vertical; horizontal uses ~0.76×. */
  size: number;
  color: string;
  /** Shotstack rich-caption animation style. */
  animation: "karaoke" | "highlight" | "pop" | "none";
  /** Colour of the spoken word; null = same as the rest. */
  active: string | null;
  /** Box behind the spoken word (TikTok-style highlight); null = none. */
  activeBackground: string | null;
  stroke: { width: number; color: string } | null;
  /** UI preview colours. */
  preview: { text: string; accent: string; box?: string };
}

export const CAPTION_STYLES: readonly CaptionStyle[] = [
  {
    id: "bold",
    label: "Bold pop",
    hint: "Caps, yellow spoken word",
    uppercase: true,
    font: "Montserrat ExtraBold",
    size: 58,
    color: "#ffffff",
    animation: "karaoke",
    active: "#FFD60A",
    activeBackground: null,
    stroke: { width: 5, color: "#000000" },
    preview: { text: "#ffffff", accent: "#FFD60A" },
  },
  {
    id: "neon",
    label: "Neon",
    hint: "Caps, green spoken word",
    uppercase: true,
    font: "Montserrat ExtraBold",
    size: 58,
    color: "#ffffff",
    animation: "karaoke",
    active: "#39FF88",
    activeBackground: null,
    stroke: { width: 5, color: "#000000" },
    preview: { text: "#ffffff", accent: "#39FF88" },
  },
  {
    id: "box",
    label: "Highlight box",
    hint: "Spoken word in a purple box",
    uppercase: true,
    font: "Montserrat ExtraBold",
    size: 56,
    color: "#ffffff",
    animation: "highlight",
    active: "#ffffff",
    activeBackground: "#7C3AED",
    stroke: { width: 4, color: "#000000" },
    preview: { text: "#ffffff", accent: "#ffffff", box: "#7C3AED" },
  },
  {
    id: "clean",
    label: "Clean",
    hint: "Sentence case, no highlight",
    uppercase: false,
    font: "Montserrat SemiBold",
    size: 50,
    color: "#ffffff",
    animation: "none",
    active: null,
    activeBackground: null,
    stroke: { width: 3, color: "#000000" },
    preview: { text: "#ffffff", accent: "#ffffff" },
  },
] as const;

export const DEFAULT_CAPTION_STYLE = "bold";

export function captionStyle(id: string | null | undefined): CaptionStyle {
  return CAPTION_STYLES.find((s) => s.id === id) ?? CAPTION_STYLES[0];
}

export function isCaptionStyle(id: unknown): id is string {
  return typeof id === "string" && CAPTION_STYLES.some((s) => s.id === id);
}
