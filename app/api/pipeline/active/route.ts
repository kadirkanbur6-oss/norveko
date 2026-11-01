// app/api/pipeline/active/route.ts — the user's generation that is still
// running (series episodes excluded), so the AI Workspace can bring its
// progress back after the user navigates away and blocks a second start.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await db
    .from("pipeline_jobs")
    .select("id, created_at")
    .eq("user_id", user.id)
    .eq("status", "running")
    .is("options->series", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ success: true, jobId: data?.id ?? null });
}
