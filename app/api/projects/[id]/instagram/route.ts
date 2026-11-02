// app/api/projects/[id]/instagram/route.ts — POST {caption, shareToFeed}: post the video as a Reel.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { publishProjectToInstagram } from "@/lib/instagram/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { caption?: unknown; shareToFeed?: unknown };
  const caption = typeof body.caption === "string" ? body.caption.replace(/\r/g, "").trim().slice(0, 2200) : "";
  const result = await publishProjectToInstagram(adminDb(), user.id, id, { caption, shareToFeed: body.shareToFeed !== false });
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : result.code === "failed" ? 502 : 400;
    return NextResponse.json({ success: false, code: result.code, error: result.error }, { status });
  }
  return NextResponse.json({ success: true, instagram: result.instagram });
}
