// app/api/youtube/route.ts
// GET: is a channel connected for direct uploads? DELETE: disconnect (revokes the grant).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb, decryptToken, getConnection, revokeToken, youtubeUploadConfigured } from "@/lib/youtube/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  if (!youtubeUploadConfigured()) return NextResponse.json({ success: true, available: false, connection: null });
  try {
    const c = await getConnection(adminDb(), user.id);
    return NextResponse.json({
      success: true,
      available: true,
      connection: c ? { channelId: c.channel_id, channelTitle: c.channel_title, channelThumbnail: c.channel_thumbnail, connectedAt: c.created_at ?? null } : null,
    });
  } catch (err) {
    console.error("[youtube] status failed:", err);
    // Table missing / DB hiccup: hide the feature instead of breaking the page.
    return NextResponse.json({ success: true, available: false, connection: null });
  }
}

export async function DELETE() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  const c = await getConnection(db, user.id).catch(() => null);
  if (c) {
    try {
      await revokeToken(decryptToken(c.refresh_token_enc));
    } catch {
      // still delete locally
    }
    await db.from("youtube_connections").delete().eq("user_id", user.id);
  }
  return NextResponse.json({ success: true });
}
