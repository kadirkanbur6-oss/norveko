// lib/tiktok/publish.ts
// Post a project's finished MP4 to the user's connected TikTok account and
// record the result (content.tiktok). Shared by the project route and series.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectTikTokPost } from "@/lib/project-content";
import { downloadOwn, ownStorageUrl } from "@/lib/youtube/publish";
import { creatorInfo, friendlyTikTokError, postStatus, postVideo, tiktokAccessToken, type TikTokPostInput } from "./client";

export type TikTokPublishResult =
  | { ok: true; tiktok: ProjectTikTokPost }
  | { ok: false; code: "not_found" | "no_video" | "not_connected" | "bad_privacy" | "failed"; error: string };

export async function publishProjectToTikTok(
  db: SupabaseClient,
  userId: string,
  projectId: string,
  input: TikTokPostInput
): Promise<TikTokPublishResult> {
  const { data: project } = await db.from("projects").select("id, title, content").eq("id", projectId).eq("user_id", userId).maybeSingle();
  if (!project) return { ok: false, code: "not_found", error: "Project not found." };
  const content = (project.content ?? {}) as Record<string, unknown>;
  const videoUrl = ownStorageUrl(content.finalVideoUrl);
  if (!videoUrl) return { ok: false, code: "no_video", error: "This project has no finished video to post yet." };

  let auth: Awaited<ReturnType<typeof tiktokAccessToken>>;
  try {
    auth = await tiktokAccessToken(db, userId);
  } catch (err) {
    console.error("[tiktok] token refresh failed:", err);
    return { ok: false, code: "failed", error: "Could not reach TikTok. Please try again." };
  }
  if (!auth) return { ok: false, code: "not_connected", error: "Connect your TikTok account first." };

  try {
    const creator = await creatorInfo(auth.token);
    if (!creator.privacy_level_options.includes(input.privacy)) {
      return { ok: false, code: "bad_privacy", error: "That visibility isn't available for this TikTok account. Pick another one." };
    }
    const video = await downloadOwn(videoUrl, 64 * 1024 * 1024);
    const publishId = await postVideo(auth.token, video.bytes, {
      ...input,
      allowComment: input.allowComment && !creator.comment_disabled,
      allowDuet: input.allowDuet && !creator.duet_disabled,
      allowStitch: input.allowStitch && !creator.stitch_disabled,
    });

    // TikTok processes the upload asynchronously; wait briefly for a final state.
    let status = "PROCESSING_UPLOAD";
    let postId: string | undefined;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const s = await postStatus(auth.token, publishId).catch(() => null);
      if (!s) continue;
      status = s.status;
      postId = s.publicaly_available_post_id?.[0] !== undefined ? String(s.publicaly_available_post_id[0]) : undefined;
      if (status === "FAILED") throw Object.assign(new Error(`TikTok processing failed: ${s.fail_reason ?? ""}`), { code: s.fail_reason });
      if (status === "PUBLISH_COMPLETE") break;
    }

    const record: ProjectTikTokPost = {
      publishId,
      status,
      privacy: input.privacy,
      displayName: auth.connection.display_name ?? undefined,
      postId,
      postedAt: new Date().toISOString(),
    };
    const { data: fresh } = await db.from("projects").select("content").eq("id", projectId).maybeSingle();
    await db
      .from("projects")
      .update({ content: { ...((fresh?.content ?? content) as Record<string, unknown>), tiktok: record }, updated_at: new Date().toISOString() })
      .eq("id", projectId)
      .eq("user_id", userId);
    return { ok: true, tiktok: record };
  } catch (err) {
    console.error("[tiktok] post failed:", err);
    return { ok: false, code: "failed", error: friendlyTikTokError(err) };
  }
}
