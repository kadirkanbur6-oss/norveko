// app/api/pipeline/reap/route.ts
// Cron + heartbeat (every minute via Supabase pg_cron): fail + refund jobs whose step timed out, re-kick jobs that were never
// picked up. Vercel calls this with "Authorization: Bearer $CRON_SECRET".

import { NextResponse } from "next/server";
import { reapStuckJobs } from "@/lib/pipeline/runner";
import { isCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const summary = await reapStuckJobs();
  return NextResponse.json({ success: true, ...summary });
}
