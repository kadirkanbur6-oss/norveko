// lib/instagram/publish.ts
// Post a project's finished MP4 as an Instagram Reel and record it (content.instagram).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectInstagramPost } from "@/lib/project-content";
import { ownStorageUrl } from "@/lib/youtube/publish";
import { friendlyInstagramError, instagramAccessToken, publishReel, type ReelInput } from "./client";

export type InstagramPublishResult =
  | { ok: true; instagram: ProjectInstagramPost }
  | { ok: false; code: "not_found" | "no_video" | "not_connected" | "watermarked" | "not_vertical" | "failed"; error: string };

export async function publishProjectToInstagram(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  input: ReelInput
): Promise<InstagramPublishResult> {
  const { data: project } = await db.from("projects").select("id, platform, content").eq("id", projectId).eq("user_id", userId).maybeSingle();
  if (!project) return { ok: false, code: "not_found", error: "Project not found." };
  const content = (project.content ?? {}) as Record<string, unknown>;
  const videoUrl = ownStorageUrl(content.finalVideoUrl);
  if (!videoUrl) return { ok: false, code: "no_video", error: "This project has no finished video to post yet." };
  if (project.platform === "YouTube Long-form") {
    return { ok: false, code: "not_vertical", error: "Reels are vertical. Cut a Short from this video first, then post the Short." };
  }
  if (content.watermarked === true) {
    return { ok: false, code: "watermarked", error: "Free-trial videos carry the Norveko badge and can't be posted. Remove it with any plan or pack." };
  }
  const auth = await instagramAccessToken(db, userId).catch(() => null);
  if (!auth) return { ok: false, code: "not_connected", error: "Connect your Instagram account in Settings first." };
  try {
    const { mediaId, permalink } = await publishReel(auth.token, auth.connection.ig_user_id, videoUrl, {
      ...input,
      coverUrl: input.coverUrl ?? (typeof content.thumbnailUrl === "string" ? content.thumbnailUrl : undefined),
    });
    const record: ProjectInstagramPost = {
      mediaId,
      permalink,
      username: auth.connection.username ?? undefined,
      postedAt: new Date().toISOString(),
    };
    const { data: fresh } = await db.from("projects").select("content").eq("id", projectId).maybeSingle();
    await db
      .from("projects")
      .update({ content: { ...((fresh?.content ?? content) as Record<string, unknown>), instagram: record }, updated_at: new Date().toISOString() })
      .eq("id", projectId)
      .eq("user_id", userId);
    return { ok: true, instagram: record };
  } catch (err) {
    console.error("[instagram] post failed:", err);
    return { ok: false, code: "failed", error: friendlyInstagramError(err) };
  }
}
