// app/api/projects/[id]/youtube/route.ts
// Publish a project's finished MP4 straight to the creator's connected
// YouTube channel (title/description/tags from the project, editable in the UI).

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { PRIVACY_OPTIONS, validPublishAt, type YouTubePrivacy } from "@/lib/youtube/metadata";
import { publishProjectToYouTube } from "@/lib/youtube/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS = { not_found: 404, no_video: 400, not_connected: 409, failed: 502 } as const;

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

  const { data: project } = await supabase.from("projects").select("content").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!project) return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });
  if ((project.content as Record<string, unknown> | null)?.youtube && body.again !== true) {
    return NextResponse.json({ success: false, error: "This video is already on YouTube.", code: "already_uploaded" }, { status: 409 });
  }

  const privacy: YouTubePrivacy = PRIVACY_OPTIONS.includes(body.privacy as YouTubePrivacy) ? (body.privacy as YouTubePrivacy) : "private";
  const publishAt = typeof body.publishAt === "string" && body.publishAt ? validPublishAt(body.publishAt) : null;
  if (typeof body.publishAt === "string" && body.publishAt && !publishAt) {
    return NextResponse.json({ success: false, error: "Pick a publish time at least 15 minutes from now." }, { status: 400 });
  }

  const result = await publishProjectToYouTube(adminDb(), user.id, id, {
    title: typeof body.title === "string" ? body.title : null,
    description: typeof body.description === "string" ? body.description : null,
    tags: Array.isArray(body.tags) ? body.tags.filter((t): t is string => typeof t === "string") : null,
    privacy,
    publishAt,
    thumbnail: body.thumbnail !== false,
  });
  if (!result.ok) {
    return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: STATUS[result.code] });
  }
  return NextResponse.json({ success: true, youtube: result.youtube });
}
