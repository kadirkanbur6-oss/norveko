// lib/youtube/publish.ts
// Upload a project's finished MP4 to the user's connected YouTube channel and
// record the result on the project (content.youtube). Shared by the project
// page route and series autopilot.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectYouTubeUpload } from "@/lib/project-content";
import { accessTokenFor } from "./oauth";
import { PRIVACY_OPTIONS, buildVideoResource, type YouTubePrivacy } from "./metadata";
import { friendlyUploadError, setThumbnail, uploadVideo } from "./upload";

const MAX_VIDEO_BYTES = 256 * 1024 * 1024;

/** Only our own Supabase Storage files are fetched server-side (no SSRF). */
export function ownStorageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    const own = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return u.protocol === "https:" && u.host === own.host && u.pathname.startsWith("/storage/v1/object/public/") ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function downloadOwn(url: string, max: number): Promise<{ bytes: Buffer; type: string }> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Could not read the file (${res.status}).`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > max) throw new Error("The file is too large to upload.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > max) throw new Error("The file is too large to upload.");
  return { bytes, type: res.headers.get("content-type") ?? "" };
}

export interface PublishInput {
  title?: string | null;
  description?: string | null;
  tags?: string[] | null;
  privacy: YouTubePrivacy;
  /** Already validated ISO time (validPublishAt), or null to publish now. */
  publishAt?: string | null;
  thumbnail?: boolean;
}

export type PublishResult =
  | { ok: true; youtube: ProjectYouTubeUpload }
  | { ok: false; code: "not_found" | "no_video" | "not_connected" | "failed"; error: string };

export async function publishProjectToYouTube(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  input: PublishInput
): Promise<PublishResult> {
  const { data: project } = await db
    .from("projects")
    .select("id, title, style, content")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project) return { ok: false, code: "not_found", error: "Project not found." };
  const content = (project.content ?? {}) as Record<string, unknown>;
  const videoUrl = ownStorageUrl(content.finalVideoUrl);
  if (!videoUrl) return { ok: false, code: "no_video", error: "This project has no finished video to publish yet." };

  let auth: Awaited<ReturnType<typeof accessTokenFor>>;
  try {
    auth = await accessTokenFor(db, userId);
  } catch (err) {
    console.error("[youtube] token refresh failed:", err);
    return { ok: false, code: "failed", error: "Could not reach YouTube. Please try again." };
  }
  if (!auth) return { ok: false, code: "not_connected", error: "Connect your YouTube channel first." };

  const title = input.title?.trim() ? input.title : String(project.title ?? "");
  const description = typeof input.description === "string" ? input.description : String(content.description ?? "");
  const tags = input.tags ?? (Array.isArray(content.tags) ? (content.tags as unknown[]).filter((t): t is string => typeof t === "string") : []);
  const publishAt = input.publishAt ?? null;

  try {
    const video = await downloadOwn(videoUrl, MAX_VIDEO_BYTES);
    const resource = buildVideoResource({ title, description, tags, privacy: input.privacy, publishAt, style: project.style as string | null });
    const uploaded = await uploadVideo(auth.token, resource, video.bytes);

    let thumbnailSet = false;
    const thumbUrl = input.thumbnail === false ? null : ownStorageUrl(content.thumbnailUrl);
    if (thumbUrl) {
      try {
        const img = await downloadOwn(thumbUrl, 2 * 1024 * 1024);
        thumbnailSet = await setThumbnail(auth.token, uploaded.id, img.bytes, img.type.startsWith("image/") ? img.type : "image/jpeg");
      } catch (err) {
        console.warn("[youtube] thumbnail skipped:", err);
      }
    }

    const wanted = publishAt ? "private" : input.privacy;
    const record: ProjectYouTubeUpload = {
      videoId: uploaded.id,
      url: `https://youtu.be/${uploaded.id}`,
      privacy: (PRIVACY_OPTIONS as readonly string[]).includes(uploaded.privacyStatus) ? (uploaded.privacyStatus as YouTubePrivacy) : wanted,
      channelTitle: auth.connection.channel_title ?? undefined,
      publishAt: publishAt ?? undefined,
      uploadedAt: new Date().toISOString(),
      // Unaudited Google projects get every upload locked to private.
      privacyApplied: !uploaded.privacyStatus || uploaded.privacyStatus === wanted,
      thumbnailSet,
    };

    // Re-read so a concurrent edit to the project isn't overwritten.
    const { data: fresh } = await db.from("projects").select("content").eq("id", projectId).maybeSingle();
    await db
      .from("projects")
      .update({ content: { ...((fresh?.content ?? content) as Record<string, unknown>), youtube: record }, updated_at: new Date().toISOString() })
      .eq("id", projectId)
      .eq("user_id", userId);
    return { ok: true, youtube: record };
  } catch (err) {
    console.error("[youtube] upload failed:", err);
    return { ok: false, code: "failed", error: friendlyUploadError(err) };
  }
}
