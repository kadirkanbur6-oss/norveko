// app/api/v1/videos/[id]/route.ts — one video's status and, when finished, its files.
import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/api-keys";
import { reconcileJob } from "@/lib/pipeline/runner";
import { apiAuth, apiError } from "../../_auth";
import { jobView } from "../view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return apiError(404, "not_found", "No such video.");
  const db = adminDb();
  const select = "id, idea, status, error, duration, output_language, created_at, current_step, credits_charged, credits_refunded, steps, options";
  let { data } = await db.from("pipeline_jobs").select(select).eq("id", id).eq("user_id", auth.user.id).maybeSingle();
  if (!data) return apiError(404, "not_found", "No such video.");
  // Polling also moves the job along (same as the workspace's status endpoint).
  if (data.status === "running") {
    await reconcileJob(data as never).catch(() => undefined);
    ({ data } = await db.from("pipeline_jobs").select(select).eq("id", id).maybeSingle());
  }
  return NextResponse.json(jobView(data as never));
}
