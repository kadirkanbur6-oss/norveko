// app/api/series/[id]/route.ts — update (pause/resume or full edit) and delete a series.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/series/run";
import { validateSeries } from "@/lib/series/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // validated below
  }
  let update: Record<string, unknown>;
  if (Object.keys(body).length === 1 && typeof body.active === "boolean") {
    update = { active: body.active };
  } else {
    const v = validateSeries(body);
    if (!v.ok) return NextResponse.json({ success: false, error: v.error }, { status: 400 });
    update = { ...v.value, ...(typeof body.active === "boolean" ? { active: body.active } : {}) };
  }
  const { data, error } = await adminDb()
    .from("series")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ success: false, error: "Series not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  // Episodes go with it (FK cascade); finished projects and videos stay.
  await adminDb().from("series").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ success: true });
}
