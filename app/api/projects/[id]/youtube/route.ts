// app/api/projects/[id]/youtube/route.ts
// Publish a project's finished MP4 straight to the creator's connected
// YouTube channel (title/description/tags from the project, editable in the UI).

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { accessTokenFor, adminDb } from "@/lib/youtube/oauth";
import { PRIVACY_OPTIONS, buildVideoResource, validPublishAt, type YouTubePrivacy } from "@/lib/youtube/metadata";
import { friendlyUploadError, setThumbnail, uploadVideo } from "@/lib/youtube/upload";
import type { ProjectYouTubeUpload } from "@/lib/project-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_VIDEO_BYTES = 256 * 1024 * 1024;

/** Only our own Supabase Storage files are fetched server-side (no SSRF). */
function ownStorageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    const own = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return u.protocol === "https:" && u.host === own.host && u.pathname.startsWith("/storage/v1/object/public/") ? u.toString() : null;
  } catch {
    return null;
  }
}

async function download(url: string, max: number): Promise<{ bytes: Buffer; type: string }> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Could not read the file (${res.status}).`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > max) throw new Error("The file is too large to upload.");
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > max) throw new Error("The file is too large to upload.");
  return { bytes, type: res.headers.get("content-type") ?? "" };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // empty body is fine
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, title, style, content")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (projectError || !project) return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });

  const content = (project.content ?? {}) as Record<string, unknown>;
  const videoUrl = ownStorageUrl(content.finalVideoUrl);
  if (!videoUrl) {
    return NextResponse.json({ success: false, error: "This project has no finished video to publish yet." }, { status: 400 });
  }
  if (content.youtube && body.again !== true) {
    return NextResponse.json({ success: false, error: "This video is already on YouTube.", code: "already_uploaded" }, { status: 409 });
  }

  const privacy: YouTubePrivacy = PRIVACY_OPTIONS.includes(body.privacy as YouTubePrivacy) ? (body.privacy as YouTubePrivacy) : "private";
  const publishAt = typeof body.publishAt === "string" && body.publishAt ? validPublishAt(body.publishAt) : null;
  if (typeof body.publishAt === "string" && body.publishAt && !publishAt) {
    return NextResponse.json({ success: false, error: "Pick a publish time at least 15 minutes from now." }, { status: 400 });
  }
  const title = typeof body.title === "string" && body.title.trim() ? body.title : String(project.title ?? "");
  const description = typeof body.description === "string" ? body.description : String(content.description ?? "");
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string")
    : Array.isArray(content.tags)
      ? (content.tags as unknown[]).filter((t): t is string => typeof t === "string")
      : [];

  const db = adminDb();
  let auth: Awaited<ReturnType<typeof accessTokenFor>>;
  try {
    auth = await accessTokenFor(db, user.id);
  } catch (err) {
    console.error("[youtube] token refresh failed:", err);
    return NextResponse.json({ success: false, error: "Could not reach YouTube. Please try again." }, { status: 502 });
  }
  if (!auth) {
    return NextResponse.json({ success: false, error: "Connect your YouTube channel first.", code: "not_connected" }, { status: 409 });
  }

  try {
    const video = await download(videoUrl, MAX_VIDEO_BYTES);
    const resource = buildVideoResource({ title, description, tags, privacy, publishAt, style: project.style as string | null });
    const uploaded = await uploadVideo(auth.token, resource, video.bytes);

    let thumbnailSet = false;
    const thumbUrl = body.thumbnail === false ? null : ownStorageUrl(content.thumbnailUrl);
    if (thumbUrl) {
      try {
        const img = await download(thumbUrl, 2 * 1024 * 1024);
        thumbnailSet = await setThumbnail(auth.token, uploaded.id, img.bytes, img.type.startsWith("image/") ? img.type : "image/jpeg");
      } catch (err) {
        console.warn("[youtube] thumbnail skipped:", err);
      }
    }

    const wanted = publishAt ? "private" : privacy;
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
    const { data: fresh } = await db.from("projects").select("content").eq("id", id).maybeSingle();
    await db
      .from("projects")
      .update({ content: { ...((fresh?.content ?? content) as Record<string, unknown>), youtube: record }, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);

    return NextResponse.json({ success: true, youtube: record });
  } catch (err) {
    console.error("[youtube] upload failed:", err);
    return NextResponse.json({ success: false, error: friendlyUploadError(err) }, { status: 502 });
  }
}
