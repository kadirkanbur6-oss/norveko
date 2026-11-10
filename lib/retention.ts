// lib/retention.ts
// How long generated files are kept (6 Nov 2026, Yağmur):
//   - Working files (scene clips and pictures, maps, archive copies, presenter audio,
//     skit portraits / lines / effects, shot pictures) are removed 30 days after a
//     video is made, for every account. The finished MP4, its cover and the
//     voice-over stay; the timeline editor, re-render, translate and "cut Shorts"
//     need the working files, so they switch off for that video.
//   - Accounts that never paid (lib/pipeline/watermark-policy hasPurchased, beta and
//     internal accounts count as paid) lose their finished videos after 7 days.
//     The project stays with its script, voice-over and cover.
//   - Paid accounts keep finished videos as long as the account exists.
// Runs in small batches from the hourly heartbeat (/api/series/tick). Showcase and
// hero clips on the landing page are never touched. `dryRun` only lists.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HERO_LOOP_CLIPS, SHOWCASE_VIDEOS } from "@/lib/showcase";

/** Live since 6 Nov 2026 (dry run checked: nothing old enough yet). false = the heartbeat only lists. */
export const RETENTION_LIVE = true;

export const WORKING_FILES_DAYS = 30;
export const FREE_VIDEO_DAYS = 7;
const BATCH = 25;

export interface RetentionMark {
  /** Working files removed (editor, re-render, translate and Shorts are off). */
  working_at?: string;
  /** Finished video removed (free account after FREE_VIDEO_DAYS). */
  video_at?: string;
}

/** True when the video's working files are gone, so editing tools must refuse. */
export function workingFilesRemoved(mark: unknown): boolean {
  return Boolean(mark && typeof mark === "object" && (mark as RetentionMark).working_at);
}

export const WORKING_FILES_GONE_MESSAGE = `This video is more than ${WORKING_FILES_DAYS} days old, so its working files were removed. The finished video is still here; editing, re-rendering, translating and cutting Shorts are no longer available for it.`;

/** Jobs whose files the landing page shows. */
function protectedIds(): Set<string> {
  const ids = new Set<string>(SHOWCASE_VIDEOS.map((v) => v.id));
  for (const clip of HERO_LOOP_CLIPS) {
    const job = clip.split("/")[1];
    if (job) ids.add(job);
  }
  return ids;
}

const isFinal = (name: string) => /^final(-v\d+)?\.mp4$/i.test(name);

/** Every file path under `prefix` in a Supabase bucket (recursive). */
async function listBucket(db: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const { data } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  const out: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null || (entry as { metadata?: unknown }).metadata == null) out.push(...(await listBucket(db, bucket, path)));
    else out.push(path);
  }
  return out;
}

/** Remove files under a folder in Supabase and R2; `keep` spares some by file name. */
async function removeFolder(db: SupabaseClient, folder: string, keep: (name: string) => boolean, dryRun: boolean): Promise<number> {
  let count = 0;
  const files = (await listBucket(db, "videos", folder)).filter((p) => !keep(p.split("/").pop() ?? ""));
  count += files.length;
  if (!dryRun) for (let i = 0; i < files.length; i += 100) await db.storage.from("videos").remove(files.slice(i, i + 100));
  const r2 = await import("@/lib/storage/r2");
  if (r2.r2Configured()) count += await r2.deleteR2Prefix(`${folder}/`, { keep: (key) => keep(key.split("/").pop() ?? ""), dryRun });
  return count;
}

async function markProject(db: SupabaseClient, projectId: unknown, patch: Record<string, unknown>, removeVideo: boolean) {
  if (typeof projectId !== "string") return;
  const { data } = await db.from("projects").select("content").eq("id", projectId).maybeSingle();
  if (!data) return;
  const content = { ...((data.content ?? {}) as Record<string, unknown>) };
  content.retention = { ...((content.retention as Record<string, unknown>) ?? {}), ...patch };
  if (removeVideo) {
    delete content.finalVideoUrl;
    delete content.cleanAssets;
  }
  await db.from("projects").update({ content }).eq("id", projectId);
}

/** Paid status per user, cached for one run. */
function paidLookup(db: SupabaseClient) {
  const cache = new Map<string, Promise<boolean>>();
  return async (userId: string) => {
    if (!cache.has(userId)) {
      cache.set(
        userId,
        (async () => {
          const { hasPurchased, isWatermarkExempt } = await import("@/lib/pipeline/watermark-policy");
          if (isWatermarkExempt(userId) || (await hasPurchased(db, userId))) return true;
          // Owners and admins are never treated as free accounts.
          const { isAdmin } = await import("@/lib/admin");
          const { data } = await db.auth.admin.getUserById(userId);
          return isAdmin(data?.user ?? null);
        })()
      );
    }
    return cache.get(userId)!;
  };
}

export interface RetentionSummary {
  dryRun: boolean;
  workingCleaned: number;
  videosRemoved: number;
  files: number;
  jobs: Array<{ kind: string; id: string; action: "working" | "video"; files: number }>;
}

export async function runRetention(db: SupabaseClient, opts: { dryRun?: boolean; now?: Date } = {}): Promise<RetentionSummary> {
  const dryRun = Boolean(opts.dryRun);
  const now = (opts.now ?? new Date()).getTime();
  const workingCutoff = new Date(now - WORKING_FILES_DAYS * 86400_000).toISOString();
  const freeCutoff = new Date(now - FREE_VIDEO_DAYS * 86400_000).toISOString();
  const keepSafe = protectedIds();
  const isPaid = paidLookup(db);
  const summary: RetentionSummary = { dryRun, workingCleaned: 0, videosRemoved: 0, files: 0, jobs: [] };
  const at = new Date(now).toISOString();
  const note = (kind: string, id: string, action: "working" | "video", files: number) => {
    summary.jobs.push({ kind, id, action, files });
    summary.files += files;
    if (action === "working") summary.workingCleaned++;
    else summary.videosRemoved++;
  };

  // ---- Narrated videos (pipeline_jobs) ----
  {
    const cols = "id, user_id, status, created_at, steps";
    // A: older than 30 days with working files still there. B: 7–30 days, video not yet removed.
    const [a, b] = await Promise.all([
      db.from("pipeline_jobs").select(cols).in("status", ["completed", "failed"]).lt("created_at", workingCutoff).is("steps->retention->>working_at", null).order("created_at", { ascending: true }).limit(200),
      db.from("pipeline_jobs").select(cols).in("status", ["completed", "failed"]).gte("created_at", workingCutoff).lt("created_at", freeCutoff).is("steps->retention->>video_at", null).order("created_at", { ascending: true }).limit(1000),
    ]);
    const jobs = [...(a.data ?? []), ...(b.data ?? [])];
    let done = 0;
    for (const job of jobs) {
      if (done >= BATCH) break;
      if (keepSafe.has(job.id)) continue;
      const steps = (job.steps ?? {}) as Record<string, Record<string, unknown>>;
      const mark = (steps.retention ?? {}) as RetentionMark;
      const folder = `${job.user_id}/${job.id}`;
      const projectId = (steps.result as { project_id?: unknown } | undefined)?.project_id;
      // Content packages (no video) have nothing to remove: mark them so they leave the queue.
      if (!steps.video && !steps.render) {
        if (!dryRun && !mark.working_at && job.created_at < workingCutoff) {
          await db.from("pipeline_jobs").update({ steps: { ...steps, retention: { ...mark, working_at: at } } }).eq("id", job.id);
        }
        continue;
      }
      const free = !(await isPaid(job.user_id));
      if (free && !mark.video_at && typeof steps.render?.video_url === "string") {
        const files = await removeFolder(db, folder, () => false, dryRun);
        note("video", job.id, "video", files);
        done++;
        if (!dryRun) {
          const retention = { ...mark, working_at: mark.working_at ?? at, video_at: at };
          const render = steps.render ? { ...steps.render, video_url: null, history: [] } : steps.render;
          await db.from("pipeline_jobs").update({ steps: { ...steps, retention, ...(render ? { render } : {}) } }).eq("id", job.id);
          await markProject(db, projectId, retention, true);
        }
        continue;
      }
      if (!mark.working_at && job.created_at < workingCutoff) {
        const files = await removeFolder(db, folder, isFinal, dryRun);
        note("video", job.id, "working", files);
        done++;
        if (!dryRun) {
          const retention = { ...mark, working_at: at };
          await db.from("pipeline_jobs").update({ steps: { ...steps, retention } }).eq("id", job.id);
          await markProject(db, projectId, retention, false);
        }
      }
    }
  }

  // ---- Skits (skit_jobs): finals in <user>/skit/<id>/, pictures in <user>/skit-<id>/ ----
  {
    const cols = "id, user_id, status, created_at, plan, project_id";
    const [a, b] = await Promise.all([
      db.from("skit_jobs").select(cols).in("status", ["completed", "failed"]).lt("created_at", workingCutoff).is("plan->retention->>working_at", null).order("created_at", { ascending: true }).limit(200),
      db.from("skit_jobs").select(cols).in("status", ["completed", "failed"]).gte("created_at", workingCutoff).lt("created_at", freeCutoff).is("plan->retention->>video_at", null).order("created_at", { ascending: true }).limit(1000),
    ]);
    const rows = [...(a.data ?? []), ...(b.data ?? [])];
    let done = 0;
    for (const row of rows) {
      if (done >= BATCH) break;
      if (keepSafe.has(row.id)) continue;
      const plan = (row.plan ?? {}) as Record<string, unknown>;
      const mark = (plan.retention ?? {}) as RetentionMark;
      const free = !(await isPaid(row.user_id));
      const clean = async (keepFinal: boolean) =>
        (await removeFolder(db, `${row.user_id}/skit/${row.id}`, keepFinal ? isFinal : () => false, dryRun)) +
        (await removeFolder(db, `${row.user_id}/skit-${row.id}`, () => false, dryRun));
      if (free && !mark.video_at) {
        const files = await clean(false);
        note("skit", row.id, "video", files);
        done++;
        if (!dryRun) {
          const retention = { ...mark, working_at: mark.working_at ?? at, video_at: at };
          await db.from("skit_jobs").update({ plan: { ...plan, retention } }).eq("id", row.id);
          await markProject(db, row.project_id, retention, true);
        }
        continue;
      }
      if (!mark.working_at && row.created_at < workingCutoff) {
        const files = await clean(true);
        note("skit", row.id, "working", files);
        done++;
        if (!dryRun) {
          const retention = { ...mark, working_at: at };
          await db.from("skit_jobs").update({ plan: { ...plan, retention } }).eq("id", row.id);
          await markProject(db, row.project_id, retention, false);
        }
      }
    }
  }

  // ---- Talking characters and swaps: only the free-account rule (their working files are one picture) ----
  {
    const { data: rows } = await db
      .from("swap_jobs")
      .select("id, user_id, kind, status, created_at, output_url, project_id")
      .eq("status", "completed")
      .not("output_url", "is", null)
      .lt("created_at", freeCutoff)
      // Paid rows stay in this list (no marker column), so look back a bounded window.
      .gte("created_at", new Date(now - (FREE_VIDEO_DAYS + 90) * 86400_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(1000);
    let done = 0;
    for (const row of rows ?? []) {
      if (done >= BATCH) break;
      if (keepSafe.has(row.id)) continue;
      if (await isPaid(row.user_id)) continue;
      const kind = row.kind === "talk" ? "talk" : row.kind === "animate" ? "animate" : "swap";
      const files =
        (await removeFolder(db, `${row.user_id}/${kind}/${row.id}`, () => false, dryRun)) +
        (await removeFolder(db, `${row.user_id}/${kind}-${row.id}`, () => false, dryRun));
      note(kind, row.id, "video", files);
      done++;
      if (!dryRun) {
        await db.from("swap_jobs").update({ output_url: null, swapped_url: null }).eq("id", row.id);
        await markProject(db, row.project_id, { working_at: at, video_at: at }, true);
      }
    }
  }

  return summary;
}
