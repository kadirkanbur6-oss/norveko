// app/api/waitlist/route.ts
// "Notify me when plans open" — one row per user in plan_waitlist (SQL in
// supabase/README.md). Service role, because the table has no RLS policies for
// users. GET says whether the current user is already on the list.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/supabase-admin";
import { captureError } from "@/lib/observability";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const db = adminDb();
  const { data, error } = await db.from("plan_waitlist").select("created_at").eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ success: true, joined: false, unavailable: true });
  return NextResponse.json({ success: true, joined: Boolean(data) });
}

export async function POST() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const db = adminDb();
  const { error } = await db
    .from("plan_waitlist")
    .upsert({ user_id: user.id, email: user.email ?? null }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) {
    captureError(error, { step: "waitlist" });
    return NextResponse.json({ success: false, error: "Could not save that right now. We'll still e-mail every account when plans open." }, { status: 500 });
  }
  return NextResponse.json({ success: true, joined: true });
}
