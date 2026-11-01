// app/api/billing/subscription/route.ts — the user's current plan (lib/subscriptions-server.ts).

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { isActive, subscriptionForUser } from "@/lib/subscriptions-server";
import { getSubscriptionPlan } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  try {
    const row = await subscriptionForUser(adminDb(), user.id);
    const plan = getSubscriptionPlan(row?.plan_id);
    return NextResponse.json({
      success: true,
      subscription:
        row && plan
          ? {
              planId: plan.id,
              name: plan.name,
              period: plan.period,
              credits: plan.credits,
              grantEvery: plan.grantEvery,
              priceUsd: plan.priceUsd,
              status: row.status,
              active: isActive(row),
              renewsAt: row.cancel_at ? null : row.current_period_end,
              endsAt: row.cancel_at,
              nextMonthlyCreditsAt: row.next_grant_at,
            }
          : null,
    });
  } catch (err) {
    console.error("[billing] subscription load failed:", err);
    return NextResponse.json({ success: true, subscription: null });
  }
}
