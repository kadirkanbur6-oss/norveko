// lib/project-content.ts
// Shape of projects.content and a strict sanitiser used by PATCH /api/projects/[id].
// Unknown keys are dropped, strings are trimmed and capped, arrays are bounded,
// and media URLs must be https. Keeps the JSONB column from becoming a dump.

import { cuesToSrt, cuesToVtt } from "@/lib/pipeline/captions";

export interface ProjectScene {
  sceneNumber: number;
  description: string;
  videoPrompt: string;
  videoUrl?: string;
  videoDuration?: number;
}

export interface ProjectCaption {
  /** Seconds from the start of the voiceover. */
  start: number;
  end: number;
  /** One or two lines, joined with "\n". */
  text: string;
}

export interface ProjectContent {
  hook?: string;
  script?: string;
  scenes?: ProjectScene[];
  titles?: string[];
  description?: string;
  tags?: string[];
  thumbnailIdea?: string;
  thumbnailUrl?: string;
  voiceoverUrl?: string;
  audio_url?: string;
  /** Word-timed subtitle cues from the voiceover (see lib/pipeline/captions.ts). */
  captions?: ProjectCaption[];
}

const LIMITS = {
  hook: 1_000,
  script: 40_000,
  description: 6_000,
  thumbnailIdea: 2_000,
  sceneDescription: 2_000,
  videoPrompt: 3_000,
  title: 200,
  tag: 60,
  scenes: 60,
  titles: 20,
  tags: 60,
  url: 2_000,
  captions: 2_000,
  captionText: 200,
} as const;

/** Total serialized size allowed for one content object. */
export const MAX_CONTENT_BYTES = 200_000;

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length ? t.slice(0, max) : undefined;
}

function url(value: unknown): string | undefined {
  const s = str(value, LIMITS.url);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? s : undefined;
  } catch {
    return undefined;
  }
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1000) / 1000
    : undefined;
}

function strList(value: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((v) => str(v, maxLen))
    .filter((v): v is string => Boolean(v))
    .slice(0, maxItems);
  return out;
}

/**
 * Returns a cleaned copy, or an error string when the input is not an object
 * or is too large. Fields that fail validation are simply omitted.
 */
export function sanitizeProjectContent(
  input: unknown
): { ok: true; content: ProjectContent } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "content must be an object." };
  }
  if (JSON.stringify(input).length > MAX_CONTENT_BYTES) {
    return { ok: false, error: "content is too large." };
  }

  const raw = input as Record<string, unknown>;
  const content: ProjectContent = {};

  const hook = str(raw.hook, LIMITS.hook);
  if (hook) content.hook = hook;
  const script = str(raw.script, LIMITS.script);
  if (script) content.script = script;
  const description = str(raw.description, LIMITS.description);
  if (description) content.description = description;
  const thumbnailIdea = str(raw.thumbnailIdea, LIMITS.thumbnailIdea);
  if (thumbnailIdea) content.thumbnailIdea = thumbnailIdea;

  const titles = strList(raw.titles, LIMITS.titles, LIMITS.title);
  if (titles) content.titles = titles;
  const tags = strList(raw.tags, LIMITS.tags, LIMITS.tag);
  if (tags) content.tags = tags;

  if (Array.isArray(raw.scenes)) {
    const scenes: ProjectScene[] = [];
    for (const [i, s] of raw.scenes.slice(0, LIMITS.scenes).entries()) {
      if (!s || typeof s !== "object") continue;
      const sc = s as Record<string, unknown>;
      const scene: ProjectScene = {
        sceneNumber:
          typeof sc.sceneNumber === "number" && Number.isFinite(sc.sceneNumber)
            ? Math.max(1, Math.floor(sc.sceneNumber))
            : i + 1,
        description: str(sc.description, LIMITS.sceneDescription) ?? "",
        videoPrompt: str(sc.videoPrompt, LIMITS.videoPrompt) ?? "",
      };
      const videoUrl = url(sc.videoUrl);
      if (videoUrl) scene.videoUrl = videoUrl;
      if (typeof sc.videoDuration === "number" && Number.isFinite(sc.videoDuration)) {
        scene.videoDuration = sc.videoDuration;
      }
      scenes.push(scene);
    }
    content.scenes = scenes;
  }

  const thumbnailUrl = url(raw.thumbnailUrl);
  if (thumbnailUrl) content.thumbnailUrl = thumbnailUrl;
  const voiceoverUrl = url(raw.voiceoverUrl) ?? url(raw.audio_url);
  if (voiceoverUrl) {
    content.voiceoverUrl = voiceoverUrl;
    content.audio_url = voiceoverUrl; // legacy readers
  }

  if (Array.isArray(raw.captions)) {
    const captions: ProjectCaption[] = [];
    for (const c of raw.captions.slice(0, LIMITS.captions)) {
      if (!c || typeof c !== "object") continue;
      const cue = c as Record<string, unknown>;
      const start = num(cue.start);
      const end = num(cue.end);
      const text = str(cue.text, LIMITS.captionText);
      if (start === undefined || end === undefined || !text || end <= start) continue;
      captions.push({ start, end, text });
    }
    if (captions.length) content.captions = captions;
  }

  return { ok: true, content };
}

/* ---------------- Export helpers (used by the project page) ---------------- */

/** Markdown export of the whole package. */
export function contentToMarkdown(title: string, c: ProjectContent): string {
  const lines: string[] = [`# ${title}`, ""];
  if (c.hook) lines.push("## Hook", "", c.hook, "");
  if (c.script) lines.push("## Script", "", c.script, "");
  if (c.scenes?.length) {
    lines.push("## Scene plan", "");
    for (const s of c.scenes) {
      lines.push(`### Scene ${s.sceneNumber}`, "", s.description, "");
      if (s.videoPrompt) lines.push("**Video prompt**", "", "```", s.videoPrompt, "```", "");
      if (s.videoUrl) lines.push(`Clip: ${s.videoUrl}`, "");
    }
  }
  if (c.titles?.length) lines.push("## Title options", "", ...c.titles.map((t) => `- ${t}`), "");
  if (c.description) lines.push("## Description", "", c.description, "");
  if (c.tags?.length) lines.push("## Tags", "", c.tags.join(", "), "");
  if (c.thumbnailIdea) lines.push("## Thumbnail concept", "", c.thumbnailIdea, "");
  if (c.thumbnailUrl) lines.push(`Thumbnail image: ${c.thumbnailUrl}`, "");
  if (c.voiceoverUrl) lines.push(`Voiceover: ${c.voiceoverUrl}`, "");
  return lines.join("\n");
}

/** Plain-text export: just the narration, for teleprompters / TTS. */
export function contentToPlainText(c: ProjectContent): string {
  return [c.hook, c.script].filter(Boolean).join("\n\n");
}

/** True when the project has word-timed captions from the voiceover. */
export function hasTimedCaptions(c: ProjectContent): boolean {
  return Array.isArray(c.captions) && c.captions.length > 0;
}

/**
 * SRT export. Uses the voiceover's word-timed cues when present. Without
 * them we distribute the script across sentences by character count over an
 * estimated duration (≈150 words/min) — a starting point for an editor.
 */
export function contentToSrt(c: ProjectContent): string {
  if (hasTimedCaptions(c)) return cuesToSrt(c.captions!);
  return cuesToSrt(estimatedCues(c));
}

/** WebVTT export (YouTube, web players). Same source rules as SRT. */
export function contentToVtt(c: ProjectContent): string {
  if (hasTimedCaptions(c)) return cuesToVtt(c.captions!);
  return cuesToVtt(estimatedCues(c));
}

function estimatedCues(c: ProjectContent): ProjectCaption[] {
  const script = contentToPlainText(c);
  if (!script) return [];
  const sentences = script
    .replace(/\s+/g, " ")
    .match(/[^.!?]+[.!?]+["']?|[^.!?]+$/g)
    ?.map((s) => s.trim())
    .filter(Boolean) ?? [script];
  const words = script.split(/\s+/).length;
  const total = Math.max(5, (words / 150) * 60);
  const totalChars = sentences.reduce((n, s) => n + s.length, 0) || 1;

  let t = 0;
  return sentences.map((s) => {
    const dur = Math.max(1.2, (s.length / totalChars) * total);
    const start = t;
    t += dur;
    return { start, end: t, text: s };
  });
}
