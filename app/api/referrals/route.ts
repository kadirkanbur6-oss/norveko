// app/api/referrals/route.ts — the user's invite link + stats (lib/referrals/referrals.ts).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb, siteUrl } from "@/lib/youtube/oauth";
import { codeFor, referralStats, REFERRAL_MONTHS, REFERRAL_SHARE } from "@/lib/referrals/referrals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const db = adminDb();
  try {
    const code = await codeFor(db, user.id);
    const stats = await referralStats(db, user.id);
    return NextResponse.json({
      success: true,
      link: `${siteUrl()}/?ref=${code}`,
      code,
      sharePercent: Math.round(REFERRAL_SHARE * 100),
      months: REFERRAL_MONTHS,
      ...stats,
    });
  } catch (err) {
    console.error("[referrals] load failed:", err);
    return NextResponse.json({ success: false, error: "Couldn't load your invite link." }, { status: 500 });
  }
}
