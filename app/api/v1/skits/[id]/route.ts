// GET /api/v1/skits/:id — one skit (polling also moves it along).
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/api-keys";
import { advanceSkitJob, type SkitRow } from "@/lib/skit/skit";
import { apiAuth, apiError } from "../../_auth";
import { skitApiView } from "../view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const db = adminDb();
  const { data } = await db.from("skit_jobs").select("*").eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (!data || data.status === "draft") return apiError(404, "not_found", "No such skit.");
  const row = await advanceSkitJob(db, data as SkitRow);
  return NextResponse.json(skitApiView(row as unknown as Record<string, unknown>));
}
