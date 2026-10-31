// app/api/projects/[id]/tiktok/route.ts — direct-post a project's MP4 to TikTok.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { TIKTOK_PRIVACY, type TikTokPrivacy } from "@/lib/tiktok/client";
import { publishProjectToTikTok } from "@/lib/tiktok/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STATUS = { not_found: 404, no_video: 400, not_connected: 409, bad_privacy: 400, failed: 502 } as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // handled below
  }
  // TikTok requires the creator to pick the visibility themselves (no default).
  if (!TIKTOK_PRIVACY.includes(body.privacy as TikTokPrivacy)) {
    return NextResponse.json({ success: false, error: "Choose who can view this post." }, { status: 400 });
  }
  if (body.consent !== true) {
    return NextResponse.json({ success: false, error: "Please confirm TikTok's Music Usage terms." }, { status: 400 });
  }
  const result = await publishProjectToTikTok(adminDb(), user.id, id, {
    caption: typeof body.caption === "string" ? body.caption : "",
    privacy: body.privacy as TikTokPrivacy,
    allowComment: body.allowComment === true,
    allowDuet: body.allowDuet === true,
    allowStitch: body.allowStitch === true,
  });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error, code: result.code }, { status: STATUS[result.code] });
  return NextResponse.json({ success: true, tiktok: result.tiktok });
}
