// app/api/instagram/route.ts — GET connection status, DELETE disconnect.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { getInstagramConnection, instagramConfigured } from "@/lib/instagram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  if (!instagramConfigured()) return NextResponse.json({ success: true, available: false, connection: null });
  const c = await getInstagramConnection(adminDb(), user.id).catch(() => null);
  return NextResponse.json({
    success: true,
    available: true,
    connection: c ? { username: c.username, avatarUrl: c.avatar_url, expiresAt: c.expires_at, expired: Date.parse(c.expires_at) < Date.now() } : null,
  });
}

export async function DELETE() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  // Instagram Login tokens have no revoke endpoint; the user can also remove Norveko under
  // Instagram → Settings → Apps and websites.
  await adminDb().from("instagram_connections").delete().eq("user_id", user.id);
  return NextResponse.json({ success: true });
}
