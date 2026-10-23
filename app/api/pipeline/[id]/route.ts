// app/api/pipeline/[id]/route.ts
// Job durumunu döndürür — UI ilerleme kartı bunu poll eder.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { reconcileJob } from "@/lib/pipeline/runner";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 }
    );
  }

  // RLS applies too, but filter by user_id explicitly.
  const { data: job, error } = await supabase
    .from("pipeline_jobs")
    .select("id, status, current_step, steps, error, created_at")
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
        .select("id, status, current_step, steps, error, created_at")
        .eq("id", id)
        .single();
      return NextResponse.json({ success: true, job: refreshed ?? job });
    }
  }

  return NextResponse.json({ success: true, job });
}