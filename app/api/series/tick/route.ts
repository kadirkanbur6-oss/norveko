// app/api/series/tick/route.ts
// Cron (vercel.json): create episodes for upcoming post times of every active
// series. Vercel calls it with "Authorization: Bearer $CRON_SECRET".

import { NextResponse } from "next/server";
import { runSeriesTick } from "@/lib/series/run";
import { isCronRequest } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  // Hourly heartbeat passes ?lookahead=2 (episodes made ~1–2 h before posting);
  // the daily Vercel cron keeps the 26 h default as a safety net.
  const raw = Number(new URL(request.url).searchParams.get("lookahead"));
  const lookahead = Number.isFinite(raw) && raw >= 1 && raw <= 26 ? raw : undefined;
  const summary = await runSeriesTick(undefined, new Date(), lookahead);
  // Same hourly heartbeat: monthly credits of yearly subscription plans.
  let grants = 0;
  try {
    const { runSubscriptionGrants } = await import("@/lib/subscriptions-server");
    const { adminDb } = await import("@/lib/series/run");
    grants = (await runSubscriptionGrants(adminDb())).granted;
    // Plan credits that weren't used in their period don't roll over.
    const { expireSubscriptionCredits } = await import("@/lib/subscriptions-server");
    await expireSubscriptionCredits(adminDb());
  } catch (err) {
    console.error("[tick] subscription grants failed:", err);
  }
  return NextResponse.json({ success: true, ...summary, subscriptionGrants: grants });
}
