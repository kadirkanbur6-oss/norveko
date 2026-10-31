// app/api/series/[id]/run/route.ts — "Make an episode now" (publishes as soon as it is ready).

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb, createEpisode, type SeriesRow } from "@/lib/series/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  const { data: series } = await db.from("series").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!series) return NextResponse.json({ success: false, error: "Series not found." }, { status: 404 });
  const at = new Date();
  at.setSeconds(0, 0);
  const r = await createEpisode(db, series as SeriesRow, at);
  if (r.status === "exists") return NextResponse.json({ success: false, error: "An episode was just started — wait a minute." }, { status: 409 });
  if (r.status === "skipped") return NextResponse.json({ success: false, error: r.reason ?? "Skipped." }, { status: 400 });
  return NextResponse.json({ success: true, episodeId: r.episodeId });
}
