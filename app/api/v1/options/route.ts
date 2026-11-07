// app/api/v1/options/route.ts — the values the API accepts (public, no key needed).
import { NextResponse } from "next/server";
import { DURATIONS, LANGUAGE_OPTIONS, PLATFORMS, STYLES } from "@/lib/pipeline/options";
import { FOOTAGE_MODES, OFFERED_CLIP_MODES } from "@/lib/pipeline/steps";
import { VISUAL_STYLES, CAPTION_STYLES } from "@/lib/pipeline/visual-styles";
import { GEMINI_VOICES } from "@/lib/pipeline/gemini-tts";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    platforms: PLATFORMS,
    styles: STYLES,
    durations: DURATIONS,
    languages: LANGUAGE_OPTIONS.map((l) => ({ value: l.label, english: l.english, code: l.code })),
    footage: FOOTAGE_MODES,
    clipModes: OFFERED_CLIP_MODES,
    visualStyles: VISUAL_STYLES.map((v) => v.id),
    captionStyles: CAPTION_STYLES.map((c) => c.id),
    voices: GEMINI_VOICES.map((v) => ({ id: `gemini:${v.name}`, name: v.name, style: v.style, gender: v.gender })),
  });
}
