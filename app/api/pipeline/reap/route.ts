// app/api/pipeline/reap/route.ts
// Cron: fail + refund jobs whose step timed out, re-kick jobs that were never
// picked up. Vercel calls this with "Authorization: Bearer $CRON_SECRET".

import { NextResponse } from "next/server";
import { reapStuckJobs } from "@/lib/pipeline/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const secret = process.env.CRON_SECRET;
  if (!secret || token !== secret) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const summary = await reapStuckJobs();
  return NextResponse.json({ success: true, ...summary });
}
