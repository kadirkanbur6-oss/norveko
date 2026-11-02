// app/api/keys/route.ts — the signed-in user's API keys (Settings → API).
//   GET → list (prefix, name, dates) · POST {name} → create (the key is returned ONCE) · DELETE ?id → revoke

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { MAX_API_KEYS, adminDb, apiAllowed, newApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  const [{ data }, allowed] = await Promise.all([
    db.from("api_keys").select("id, name, prefix, created_at, last_used_at").eq("user_id", user.id).is("revoked_at", null).order("created_at"),
    apiAllowed(db, user.id),
  ]);
  return NextResponse.json({ success: true, allowed, max: MAX_API_KEYS, keys: data ?? [] });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  if (!(await apiAllowed(db, user.id))) {
    return NextResponse.json({ success: false, error: "The API is available on any plan or pack." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 40) : "API key";
  const { count } = await db.from("api_keys").select("id", { count: "exact", head: true }).eq("user_id", user.id).is("revoked_at", null);
  if ((count ?? 0) >= MAX_API_KEYS) {
    return NextResponse.json({ success: false, error: `You can have up to ${MAX_API_KEYS} keys. Revoke one first.` }, { status: 400 });
  }
  const { key, prefix, hash } = newApiKey();
  const { data, error } = await db
    .from("api_keys")
    .insert({ user_id: user.id, name, prefix, key_hash: hash })
    .select("id, name, prefix, created_at, last_used_at")
    .single();
  if (error || !data) return NextResponse.json({ success: false, error: "Could not create the key." }, { status: 500 });
  return NextResponse.json({ success: true, key, record: data });
}

export async function DELETE(req: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ success: false, error: "Unknown key." }, { status: 400 });
  await adminDb().from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ success: true });
}
