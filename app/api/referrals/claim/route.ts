// app/api/referrals/claim/route.ts — link a fresh account to the invite code in
// the nv_ref cookie (set by middleware from ?ref=). Called once by the dashboard.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { claimReferral, isReferralCode, REFERRAL_COOKIE } from "@/lib/referrals/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const jar = await cookies();
  const code = jar.get(REFERRAL_COOKIE)?.value?.toLowerCase();
  if (!isReferralCode(code)) return NextResponse.json({ success: true, result: "no_code" });
  let result: string;
  try {
    result = await claimReferral(adminDb(), { id: user.id, created_at: user.created_at }, code);
  } catch (err) {
    console.error("[referrals] claim failed:", err);
    return NextResponse.json({ success: false, error: "Claim failed." }, { status: 500 });
  }
  const res = NextResponse.json({ success: true, result });
  res.cookies.delete(REFERRAL_COOKIE);
  return res;
}
