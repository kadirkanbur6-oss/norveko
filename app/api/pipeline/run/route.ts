// app/api/pipeline/run/route.ts
// Internal worker: runs ONE step of a pipeline job, then kicks itself for the
// next step. Protected by PIPELINE_WORKER_SECRET (falls back to CRON_SECRET).

import { NextRequest, NextResponse, after } from "next/server";
import { getWorkerSecret, kickJob, runNextStep } from "@/lib/pipeline/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One external provider call per invocation; 60s is plenty.
export const maxDuration = 300; // script step = draft + editor pass (two LLM calls)

export async function POST(req: NextRequest) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token || token !== getWorkerSecret()) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let jobId: unknown;
  try {
    ({ jobId } = await req.json());
  } catch {
    return NextResponse.json({ success: false, error: "Invalid body" }, { status: 400 });
  }
  if (typeof jobId !== "string" || !jobId) {
    return NextResponse.json({ success: false, error: "jobId required" }, { status: 400 });
  }

  const outcome = await runNextStep(jobId);

  if (outcome === "advanced") {
    // Chain the next step after this response is sent.
    after(() => kickJob(jobId as string));
  }
  // Async steps in flight and unattended jobs are advanced by the heartbeat
  // (Supabase pg_cron → /api/pipeline/reap every minute), not by chaining:
  // Vercel cuts long self-call chains with 508 INFINITE_LOOP_DETECTED.

  return NextResponse.json({ success: true, outcome });
}
