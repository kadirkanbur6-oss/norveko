// app/api/pipeline/[id]/route.ts
// Job durumunu döndürür — UI ilerleme kartı bunu poll eder.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { reconcileJob } from "@/lib/pipeline/runner";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { supabase, user } = await requireUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  // RLS applies too, but filter by user_id explicitly.
  const { data: job, error } = await supabase
    .from("pipeline_jobs")
    .select("id, status, current_step, steps, error, created_at, credits_charged, credits_refunded, options")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !job) {
    return NextResponse.json(
      { success: false, error: "Job not found" },
      { status: 404 }
    );
  }

  // Self-healing: while the job is polled, time out dead steps (refunding
  // credits) or re-kick a step the worker never picked up.
  if (job.status === "running") {
    const action = await reconcileJob(job);
    if (action === "failed") {
      const { data: refreshed } = await supabase
        .from("pipeline_jobs")
        .select("id, status, current_step, steps, error, created_at, credits_charged, credits_refunded, options")
        .eq("id", id)
        .single();
      return NextResponse.json({ success: true, job: refreshed ?? job });
    }
  }

  return NextResponse.json({ success: true, job });
}