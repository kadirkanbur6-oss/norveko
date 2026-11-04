// app/api/pipeline/active/route.ts — the user's generation that is still
// running, in any studio (series episodes and Shorts excluded), so the AI
// Workspace can open the right mode and bring its progress back after the
// user navigates away (5 Nov 2026: skits, talking characters and swaps too).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ActiveMode = "video" | "skit" | "talk" | "swap";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const [video, skit, creative] = await Promise.all([
    db
      .from("pipeline_jobs")
      .select("id, created_at")
      .eq("user_id", user.id)
      .eq("status", "running")
      .is("options->series", null)
      .is("options->short", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("skit_jobs").select("id, created_at").eq("user_id", user.id).eq("status", "running").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("swap_jobs").select("id, kind, created_at").eq("user_id", user.id).eq("status", "running").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  // The newest running job decides which studio opens.
  const candidates: Array<{ mode: ActiveMode; id: string; at: string }> = [];
  if (video.data) candidates.push({ mode: "video", id: video.data.id, at: video.data.created_at });
  if (skit.data) candidates.push({ mode: "skit", id: skit.data.id, at: skit.data.created_at });
  if (creative.data) candidates.push({ mode: creative.data.kind === "talk" ? "talk" : "swap", id: creative.data.id, at: creative.data.created_at });
  candidates.sort((a, b) => (a.at < b.at ? 1 : -1));
  const top = candidates[0];

  return NextResponse.json({
    success: true,
    // Kept for older callers: the running narrated video, if any.
    jobId: video.data?.id ?? null,
    active: top ? { mode: top.mode, id: top.id } : null,
  });
}
