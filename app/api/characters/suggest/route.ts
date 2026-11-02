// POST {idea} → historical people at the heart of the idea that aren't characters yet.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { listCharacters, suggestHistoricalCast } from "@/lib/characters/characters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { idea?: unknown };
  const idea = typeof body.idea === "string" ? body.idea.trim() : "";
  if (idea.length < 8) return NextResponse.json({ success: true, people: [] });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const [people, existing] = await Promise.all([suggestHistoricalCast(idea), listCharacters(db, user.id).catch(() => [])]);
  const have = new Set(existing.map((c) => c.name.toLowerCase()));
  return NextResponse.json({ success: true, people: people.filter((p) => !have.has(p.toLowerCase())) });
}
