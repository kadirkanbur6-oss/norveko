// app/api/projects/[id]/feedback/route.ts
// POST { rating: "up" | "down", note? } — the creator's verdict on a generated
// script. Stored in projects.content.feedback next to scriptMeta (model +
// prompt version), so ratings can be compared per writer/prompt version:
//   select content->'scriptMeta'->>'promptVersion' v, content->'feedback'->>'rating' r, count(*)
//   from projects where content ? 'feedback' group by 1, 2;

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as { rating?: unknown; note?: unknown };
    if (body.rating !== "up" && body.rating !== "down") {
      return NextResponse.json({ success: false, error: "rating must be 'up' or 'down'." }, { status: 400 });
    }
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;

    const { data: project, error: readError } = await supabase
      .from("projects")
      .select("content")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!project) return NextResponse.json({ success: false, error: "Project not found." }, { status: 404 });

    const feedback = { rating: body.rating, ...(note ? { note } : {}), at: new Date().toISOString() };
    const content = { ...((project.content ?? {}) as Record<string, unknown>), feedback };
    const { error } = await supabase.from("projects").update({ content }).eq("id", id).eq("user_id", user.id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true, feedback });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
