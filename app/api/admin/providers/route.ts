// app/api/admin/providers/route.ts
// POST { provider, balanceUsd, lowUsd? }: the owner types in a provider's current balance
// after a top-up (OpenAI, Gemini, Shotstack have no balance API). Stored in
// `provider_balances` (SQL in supabase/README.md) and logged in `admin_actions`.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { adminDb } from "@/lib/api-keys";
import { TRACKED } from "@/lib/admin-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

export async function POST(req: NextRequest) {
  const { user } = await requireUser();
  if (!user || !isAdmin(user)) return bad("Not found.", 404);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON.");
  }
  const provider = typeof body.provider === "string" ? body.provider : "";
  if (!(TRACKED as string[]).includes(provider)) return bad("Unknown provider.");
  const balance = Number(body.balanceUsd);
  if (!Number.isFinite(balance) || balance < 0 || balance > 100_000) return bad("Enter the balance in USD.");
  const lowRaw = body.lowUsd;
  const low = lowRaw === undefined || lowRaw === null || lowRaw === "" ? null : Number(lowRaw);
  if (low !== null && (!Number.isFinite(low) || low < 0)) return bad("Warning level must be a positive number.");

  const db = adminDb();
  const asOf = new Date().toISOString();
  const { error } = await db.from("provider_balances").upsert({ provider, balance_usd: balance, low_usd: low, as_of: asOf }, { onConflict: "provider" });
  if (error) return bad(/does not exist|schema cache|relation/i.test(error.message) ? "The provider_balances table is missing. Run the SQL in supabase/README.md first." : error.message, 500);
  await db.from("admin_actions").insert({ admin_id: user.id, action: "provider_balance", amount: balance, note: provider, created_at: asOf });
  return NextResponse.json({ success: true });
}
