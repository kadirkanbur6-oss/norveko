// lib/series/validate.ts — validate a series create/update body (server).

import { DURATIONS, LANGUAGES, ORIENTATIONS, PLATFORMS, STYLES, isOneOf } from "@/lib/pipeline/options";
import { FOOTAGE_MODES, type FootageMode } from "@/lib/pipeline/steps";
import { isCaptionStyle, isVisualStyle } from "@/lib/pipeline/visual-styles";
import { geminiVoiceName } from "@/lib/pipeline/gemini-tts";
import { PRIVACY_OPTIONS, type YouTubePrivacy } from "@/lib/youtube/metadata";
import { TIKTOK_PRIVACY, type TikTokPrivacy } from "@/lib/tiktok/client";
import { isValidTime, isValidTimeZone } from "./schedule";
import type { SeriesPublish, SeriesSettings } from "./run";

export const MAX_SERIES_PER_USER = 5;

export interface SeriesInput {
  name: string;
  topic: string;
  settings: SeriesSettings;
  days: number[];
  post_time: string;
  timezone: string;
  publish: SeriesPublish;
}

export function validateSeries(body: Record<string, unknown>): { ok: true; value: SeriesInput } | { ok: false; error: string } {
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const topic = typeof body.topic === "string" ? body.topic.trim().replace(/\s+/g, " ").slice(0, 1000) : "";
  if (name.length < 2) return { ok: false, error: "Give the series a name." };
  if (topic.length < 10) return { ok: false, error: "Describe what the series is about (at least a sentence)." };

  const s = (body.settings ?? {}) as Record<string, unknown>;
  if (!isOneOf(PLATFORMS, s.platform) || !isOneOf(STYLES, s.style) || !isOneOf(LANGUAGES, s.language)) {
    return { ok: false, error: "Invalid platform, style or language." };
  }
  if (!isOneOf(DURATIONS, s.duration) || (s.duration !== "30 seconds" && s.duration !== "60 seconds")) {
    return { ok: false, error: "Series videos are 30 or 60 seconds." };
  }
  const orientation = ORIENTATIONS.some((o) => o.id === s.orientation) ? (s.orientation as "vertical" | "horizontal") : "vertical";
  const voiceId = typeof s.voiceId === "string" ? s.voiceId : "";
  if (!voiceId.startsWith("gemini:") || !geminiVoiceName(voiceId)) return { ok: false, error: "Pick a narrator." };
  const footage = FOOTAGE_MODES.includes(s.footage as FootageMode) ? (s.footage as FootageMode) : "hybrid";
  const notes = typeof s.notes === "string" && s.notes.trim() ? s.notes.trim().slice(0, 500) : null;

  const days = Array.isArray(body.days)
    ? [...new Set(body.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  if (!days.length) return { ok: false, error: "Pick at least one day." };
  if (!isValidTime(body.post_time)) return { ok: false, error: "Pick a posting time." };
  if (!isValidTimeZone(body.timezone)) return { ok: false, error: "Unknown time zone." };

  const p = (body.publish ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const publish: SeriesPublish = {};
  if (p.youtube?.enabled === true) {
    if (!PRIVACY_OPTIONS.includes(p.youtube.privacy as YouTubePrivacy)) return { ok: false, error: "Pick the YouTube visibility." };
    publish.youtube = { enabled: true, privacy: p.youtube.privacy as YouTubePrivacy };
  }
  if (p.tiktok?.enabled === true) {
    if (!TIKTOK_PRIVACY.includes(p.tiktok.privacy as TikTokPrivacy)) return { ok: false, error: "Pick who can view the TikTok posts." };
    if (p.tiktok.consent !== true) return { ok: false, error: "Please confirm TikTok's Music Usage terms." };
    publish.tiktok = {
      enabled: true,
      privacy: p.tiktok.privacy as TikTokPrivacy,
      allowComment: p.tiktok.allowComment === true,
      allowDuet: p.tiktok.allowDuet === true,
      allowStitch: p.tiktok.allowStitch === true,
    };
  }

  return {
    ok: true,
    value: {
      name,
      topic,
      settings: {
        platform: s.platform as string,
        style: s.style as string,
        duration: s.duration as "30 seconds" | "60 seconds",
        language: s.language as string,
        orientation,
        visualStyle: isVisualStyle(s.visualStyle) ? s.visualStyle : "cinematic",
        captionStyle: isCaptionStyle(s.captionStyle) ? s.captionStyle : "bold",
        voiceId,
        footage,
        research: s.research !== false,
        notes,
      },
      days,
      post_time: body.post_time as string,
      timezone: body.timezone as string,
      publish,
    },
  };
}
