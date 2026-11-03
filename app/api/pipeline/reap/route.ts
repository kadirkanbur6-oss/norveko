// app/api/pipeline/reap/route.ts
// Cron + heartbeat (every minute via Supabase pg_cron): fail + refund jobs whose step timed out, re-kick jobs that were never
// picked up. Vercel calls this with "Authorization: Bearer $CRON_SECRET".

import { NextResponse } from "next/server";
import { reapStuckJobs } from "@/lib/pipeline/runner";
import { isCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const summary = await reapStuckJobs();
  // Character swaps move along on the same heartbeat.
  let swaps = 0;
  try {
    const { advanceSwapJobs } = await import("@/lib/swap/swap");
    const { adminDb } = await import("@/lib/api-keys");
    swaps = await advanceSwapJobs(adminDb());
  } catch (err) {
    console.error("[reap] swaps failed:", err);
  }
  // Skits: one step each.
  let skits = 0;
  try {
    const { advanceSkitJobs } = await import("@/lib/skit/skit");
    const { adminDb } = await import("@/lib/api-keys");
    skits = await advanceSkitJobs(adminDb());
  } catch (err) {
    console.error("[reap] skits failed:", err);
  }
  return NextResponse.json({ success: true, ...summary, swaps, skits });
}
