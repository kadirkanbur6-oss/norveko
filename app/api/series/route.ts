// app/api/series/route.ts — list (with recent episodes) and create series.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb, episodeCost, seriesAllowed, type SeriesRow } from "@/lib/series/run";
import { nextSlot } from "@/lib/series/schedule";
import { MAX_SERIES_PER_USER, validateSeries } from "@/lib/series/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  const blocked = await seriesAllowed(db, user.id);
  const { data: rows, error } = await db.from("series").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
  if (error) {
    // Table not created yet → feature hidden.
    return NextResponse.json({ success: true, available: false, series: [] });
  }
  const ids = (rows ?? []).map((r: SeriesRow) => r.id);
  const { data: episodes } = ids.length
    ? await db
        .from("series_episodes")
        .select("id, series_id, scheduled_for, idea, status, error, job_id, project_id, publish")
        .in("series_id", ids)
        .order("scheduled_for", { ascending: false })
        .limit(200)
    : { data: [] };
  // Episodes still "generating" whose job failed show as failed.
  const jobIds = (episodes ?? []).filter((e) => e.status === "generating" && e.job_id).map((e) => e.job_id as string);
  const { data: jobs } = jobIds.length ? await db.from("pipeline_jobs").select("id, status, error").in("id", jobIds) : { data: [] };
  const jobStatus = new Map((jobs ?? []).map((j: { id: string; status: string; error: string | null }) => [j.id, j]));

  const now = new Date();
  return NextResponse.json({
    success: true,
    available: true,
    blocked,
    series: (rows ?? []).map((r: SeriesRow) => ({
      ...r,
      cost: episodeCost(r.settings),
      nextAt: r.active ? nextSlot({ days: r.days, time: r.post_time, timezone: r.timezone }, now)?.toISOString() ?? null : null,
      episodes: (episodes ?? [])
        .filter((e) => e.series_id === r.id)
        .slice(0, 10)
        .map((e) => {
          const j = e.job_id ? jobStatus.get(e.job_id) : undefined;
          return j?.status === "failed" ? { ...e, status: "failed", error: j.error } : e;
        }),
    })),
  });
}

export async function POST(req: NextRequest) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  const blocked = await seriesAllowed(db, user.id);
  if (blocked) return NextResponse.json({ success: false, error: blocked }, { status: 403 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // validated below
  }
  const v = validateSeries(body);
  if (!v.ok) return NextResponse.json({ success: false, error: v.error }, { status: 400 });
  const { count } = await db.from("series").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) >= MAX_SERIES_PER_USER) {
    return NextResponse.json({ success: false, error: `You can have up to ${MAX_SERIES_PER_USER} series.` }, { status: 400 });
  }
  const { data, error } = await db.from("series").insert({ ...v.value, user_id: user.id, active: true }).select("id").single();
  if (error) return NextResponse.json({ success: false, error: "Could not save the series." }, { status: 500 });
  return NextResponse.json({ success: true, id: data.id });
}
