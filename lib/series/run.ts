// lib/series/run.ts
// Series autopilot (31 Oct 2026): a series = topic + look + voice + schedule
// + where to publish. The tick (cron) turns upcoming post times into episodes:
// the next idea is picked by the writer model (never repeating earlier
// episodes), credits are charged like a normal generation and a full-video
// job starts. When the job completes (runner afterComplete) the episode is
// published: YouTube scheduled for the post time, TikTok as soon as ready
// (TikTok's API cannot schedule).

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildPipelineSteps,
  initialStepsState,
  resolvePipelineOptions,
  totalPipelineCredits,
  type FootageMode,
  type PipelineOptions,
} from "@/lib/pipeline/steps";
import { kickJob } from "@/lib/pipeline/runner";
import { isFullVideoEnabled, isGenerationEnabled } from "@/lib/pipeline/features";
import { hasPurchased, isWatermarkExempt } from "@/lib/pipeline/watermark-policy";
import { chatJSON, SCRIPT_MODEL } from "@/lib/pipeline/llm";
import { validPublishAt, type YouTubePrivacy } from "@/lib/youtube/metadata";
import type { TikTokPrivacy } from "@/lib/tiktok/client";
import { upcomingSlots } from "./schedule";

/** How far ahead the tick creates episodes. Daily cron (Hobby): 26 h; hourly cron: set SERIES_LOOKAHEAD_HOURS=2. */
export const LOOKAHEAD_HOURS = Number(process.env.SERIES_LOOKAHEAD_HOURS) || 26;

export interface SeriesSettings {
  platform: string;
  style: string;
  duration: "30 seconds" | "60 seconds";
  language: string;
  orientation: "vertical" | "horizontal";
  visualStyle: string;
  captionStyle: string;
  voiceId: string;
  footage: FootageMode;
  research: boolean;
  notes?: string | null;
}

export interface SeriesPublish {
  youtube?: { enabled: boolean; privacy: YouTubePrivacy };
  tiktok?: { enabled: boolean; privacy: TikTokPrivacy; allowComment: boolean; allowDuet: boolean; allowStitch: boolean };
}

export interface SeriesRow {
  id: string;
  user_id: string;
  name: string;
  topic: string;
  settings: SeriesSettings;
  days: number[];
  post_time: string;
  timezone: string;
  publish: SeriesPublish;
  active: boolean;
}

export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export function episodeOptions(s: SeriesSettings): PipelineOptions {
  return {
    research: s.research,
    voiceover: true,
    subtitles: true,
    video: false,
    fullVideo: true,
    footage: s.footage,
    clipMode: "image",
    duration: s.duration,
    voiceEngine: s.voiceId.startsWith("gemini:") ? "gemini" : "elevenlabs",
  };
}

export function episodeCost(s: SeriesSettings): number {
  return totalPipelineCredits(episodeOptions(s));
}

/** Series are a paid feature (and need full-video access). */
export async function seriesAllowed(db: SupabaseClient, userId: string): Promise<string | null> {
  if (!isGenerationEnabled(userId)) return "Generation isn't open yet.";
  if (!isFullVideoEnabled(userId)) return "Series need full-video access.";
  if (!isWatermarkExempt(userId) && !(await hasPurchased(db, userId))) return "Series are available after your first credit pack.";
  return null;
}

/** Next episode idea, different from the previous ones. Falls back to the topic. */
export async function pickNextIdea(series: SeriesRow, previous: string[]): Promise<string> {
  try {
    const { data } = await chatJSON<{ idea?: string }>({
      model: SCRIPT_MODEL,
      effort: "low",
      timeoutMs: 45_000,
      system:
        "You plan the next episode of a faceless short-video series. Pick ONE specific, well-documented subject that fits the series and has a real story with a hook. Never repeat or closely paraphrase a previous episode. Return JSON only.",
      user: `Series: ${series.name}
What the series is about: ${series.topic}
Genre/style: ${series.settings.style}
Language of the video: ${series.settings.language}
Previous episodes (do NOT repeat these subjects):
${previous.length ? previous.map((p) => `- ${p}`).join("\n") : "- (none yet)"}

Return {"idea": "<one sentence video idea, written in ${series.settings.language}, naming the specific subject>"}`,
    });
    const idea = typeof data.idea === "string" ? data.idea.trim().slice(0, 300) : "";
    return idea.length >= 3 ? idea : series.topic.slice(0, 300);
  } catch (err) {
    console.warn("[series] idea pick failed, using topic:", err instanceof Error ? err.message : err);
    return series.topic.slice(0, 300);
  }
}

type EpisodeOutcome = { status: "created" | "exists" | "skipped"; episodeId?: string; reason?: string };

/** Create (once) the episode for one post time and start its video. */
export async function createEpisode(db: SupabaseClient, series: SeriesRow, scheduledFor: Date): Promise<EpisodeOutcome> {
  const { data: episode, error: insertError } = await db
    .from("series_episodes")
    .insert({ series_id: series.id, user_id: series.user_id, scheduled_for: scheduledFor.toISOString(), status: "pending" })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") return { status: "exists" };
    throw new Error(insertError.message);
  }
  const skip = async (reason: string): Promise<EpisodeOutcome> => {
    await db.from("series_episodes").update({ status: "skipped", error: reason }).eq("id", episode.id);
    return { status: "skipped", episodeId: episode.id, reason };
  };

  const blocked = await seriesAllowed(db, series.user_id);
  if (blocked) return skip(blocked);

  const { data: prev } = await db
    .from("series_episodes")
    .select("idea")
    .eq("series_id", series.id)
    .not("idea", "is", null)
    .order("scheduled_for", { ascending: false })
    .limit(40);
  const idea = await pickNextIdea(series, (prev ?? []).map((p: { idea: string }) => p.idea));
  await db.from("series_episodes").update({ idea }).eq("id", episode.id);

  const options = episodeOptions(series.settings);
  const resolved = resolvePipelineOptions(options);
  const cost = totalPipelineCredits(options);
  const { data: paid, error: deductError } = await db.rpc("deduct_credits", {
    p_user_id: series.user_id,
    p_amount: cost,
    p_reason: `Series "${series.name.slice(0, 60)}": episode (full video, ${series.settings.duration})`,
  });
  if (deductError) return skip("Could not charge credits.");
  if (!paid) return skip(`Not enough credits (an episode costs ${cost}).`);

  const steps = initialStepsState(options) as Record<string, Record<string, unknown>>;
  const first = buildPipelineSteps(options)[0];
  steps[first.id] = { ...steps[first.id], queued_at: new Date().toISOString() };
  steps.voiceover = { ...steps.voiceover, voice_id: series.settings.voiceId };

  const { data: job, error: jobError } = await db
    .from("pipeline_jobs")
    .insert({
      user_id: series.user_id,
      idea,
      platform: series.settings.platform,
      style: series.settings.style,
      duration: series.settings.duration,
      output_language: series.settings.language,
      options: {
        orientation: series.settings.orientation,
        template: null,
        notes: series.settings.notes ?? null,
        visualStyle: series.settings.visualStyle,
        captionStyle: series.settings.captionStyle,
        fullVideo: resolved.fullVideo,
        footage: series.settings.footage,
        clipMode: "image",
        series: { id: series.id, episodeId: episode.id },
      },
      status: "running",
      current_step: first.id,
      steps,
      credits_charged: cost,
    })
    .select("id")
    .single();
  if (jobError || !job) {
    await db.rpc("add_credits", { p_user_id: series.user_id, p_amount: cost, p_type: "refund", p_reason: "Refund: series episode could not start" });
    return skip("The video could not be started.");
  }
  await db.from("series_episodes").update({ job_id: job.id, status: "generating" }).eq("id", episode.id);
  await kickJob(job.id);
  return { status: "created", episodeId: episode.id };
}

/** Cron: create episodes for every active series' upcoming post times. */
export async function runSeriesTick(db: SupabaseClient = adminDb(), now = new Date()) {
  const { data: rows, error } = await db.from("series").select("*").eq("active", true).limit(500);
  if (error) throw new Error(error.message);
  const summary = { series: rows?.length ?? 0, created: 0, skipped: 0, errors: 0 };
  for (const series of (rows ?? []) as SeriesRow[]) {
    const slots = upcomingSlots({ days: series.days, time: series.post_time, timezone: series.timezone }, now, LOOKAHEAD_HOURS);
    for (const at of slots) {
      try {
        const r = await createEpisode(db, series, at);
        if (r.status === "created") summary.created++;
        if (r.status === "skipped") summary.skipped++;
      } catch (err) {
        summary.errors++;
        console.error(`[series] ${series.id} episode failed:`, err);
      }
    }
  }
  return summary;
}

/** Runner hook: publish a finished episode (only the first completion — not re-renders). */
export async function onJobCompleted(jobId: string): Promise<void> {
  const db = adminDb();
  const { data: job } = await db.from("pipeline_jobs").select("id, user_id, options, steps").eq("id", jobId).maybeSingle();
  const ref = (job?.options as { series?: { id?: string; episodeId?: string } } | null)?.series;
  if (!job || !ref?.episodeId) return;
  const { data: episode } = await db.from("series_episodes").select("*").eq("id", ref.episodeId).maybeSingle();
  if (!episode || episode.status !== "generating") return;
  const projectId = (job.steps as { result?: { project_id?: string } })?.result?.project_id ?? null;
  const { data: series } = await db.from("series").select("*").eq("id", ref.id).maybeSingle();
  // Claim it first so a concurrent completion can't publish twice.
  const { data: claimed } = await db
    .from("series_episodes")
    .update({ status: "publishing", project_id: projectId })
    .eq("id", episode.id)
    .eq("status", "generating")
    .select("id")
    .maybeSingle();
  if (!claimed) return;
  if (!projectId || !series) {
    await db.from("series_episodes").update({ status: "ready" }).eq("id", episode.id);
    return;
  }

  const publish = (series as SeriesRow).publish ?? {};
  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  if (publish.youtube?.enabled) {
    const { publishProjectToYouTube } = await import("@/lib/youtube/publish");
    // Scheduled for the series' post time when it is still ahead, otherwise now.
    const publishAt = validPublishAt(episode.scheduled_for);
    const r = await publishProjectToYouTube(db, job.user_id, projectId, { privacy: publish.youtube.privacy, publishAt });
    if (r.ok) results.youtube = r.youtube;
    else errors.push(`YouTube: ${r.error}`);
  }
  if (publish.tiktok?.enabled) {
    const { publishProjectToTikTok } = await import("@/lib/tiktok/publish");
    const { data: project } = await db.from("projects").select("title, content").eq("id", projectId).maybeSingle();
    const content = (project?.content ?? {}) as { titles?: string[]; tags?: string[] };
    const caption = [content.titles?.[0] ?? project?.title ?? "", (content.tags ?? []).slice(0, 5).map((t) => `#${t.replace(/[^\p{L}\p{N}_]/gu, "")}`).join(" ")]
      .filter(Boolean)
      .join("\n\n");
    const r = await publishProjectToTikTok(db, job.user_id, projectId, {
      caption,
      privacy: publish.tiktok.privacy,
      allowComment: publish.tiktok.allowComment,
      allowDuet: publish.tiktok.allowDuet,
      allowStitch: publish.tiktok.allowStitch,
    });
    if (r.ok) results.tiktok = r.tiktok;
    else errors.push(`TikTok: ${r.error}`);
  }
  const anyTarget = Boolean(publish.youtube?.enabled || publish.tiktok?.enabled);
  await db
    .from("series_episodes")
    .update({
      status: !anyTarget ? "ready" : errors.length ? "publish_failed" : "published",
      publish: results,
      error: errors.length ? errors.join(" · ").slice(0, 500) : null,
    })
    .eq("id", episode.id);
}
