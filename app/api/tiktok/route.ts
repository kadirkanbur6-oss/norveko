// app/api/tiktok/route.ts
// GET: connection + live creator info (posting UI must show it, per TikTok's rules).
// DELETE: disconnect (revokes at TikTok).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { creatorInfo, getTikTokConnection, revokeTikTok, tiktokAccessToken, tiktokConfigured } from "@/lib/tiktok/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  if (!tiktokConfigured()) return NextResponse.json({ success: true, available: false, connection: null });
  const db = adminDb();
  try {
    const c = await getTikTokConnection(db, user.id);
    if (!c) return NextResponse.json({ success: true, available: true, connection: null });
    const connection = { displayName: c.display_name, avatarUrl: c.avatar_url, connectedAt: c.created_at ?? null };
    // Creator info only when the posting form asks for it (rate-limited at TikTok).
    if (new URL(req.url).searchParams.get("creator") !== "1") {
      return NextResponse.json({ success: true, available: true, connection });
    }
    const auth = await tiktokAccessToken(db, user.id);
    if (!auth) return NextResponse.json({ success: true, available: true, connection: null });
    const creator = await creatorInfo(auth.token);
    return NextResponse.json({ success: true, available: true, connection, creator });
  } catch (err) {
    console.error("[tiktok] status failed:", err);
    return NextResponse.json({ success: true, available: false, connection: null });
  }
}

export async function DELETE() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  try {
    const auth = await tiktokAccessToken(db, user.id);
    if (auth) await revokeTikTok(auth.token);
  } catch {
    // still delete locally
  }
  await db.from("tiktok_connections").delete().eq("user_id", user.id);
  return NextResponse.json({ success: true });
}
