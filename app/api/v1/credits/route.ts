// app/api/v1/credits/route.ts — your credit balance.
import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/api-keys";
import { apiAuth } from "../_auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const { data } = await adminDb().from("user_credits").select("credits").eq("user_id", auth.user.id).maybeSingle();
  return NextResponse.json({ balance: data?.credits ?? 0 });
}
