// app/api/billing/portal/route.ts — a Paddle customer portal link for the
// user's subscription (cancel, change card, invoices). Links are short-lived,
// so the page asks for a fresh one on every click.

import { NextResponse } from "next/server";
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/supabase-admin";
import { getPaddleEnvironment } from "@/lib/paddle-env";
import { subscriptionForUser } from "@/lib/subscriptions-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const row = await subscriptionForUser(adminDb(), user.id).catch(() => null);
  if (!row?.customer_id) return NextResponse.json({ success: false, error: "No subscription found." }, { status: 404 });
  try {
    const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
      environment: getPaddleEnvironment() === "production" ? Environment.production : Environment.sandbox,
    });
    const session = await paddle.customerPortalSessions.create(row.customer_id, [row.paddle_subscription_id]);
    const sub = session.urls.subscriptions.find((s) => s.id === row.paddle_subscription_id);
    return NextResponse.json({
      success: true,
      url: session.urls.general.overview,
      cancelUrl: sub?.cancelSubscription ?? null,
      paymentMethodUrl: sub?.updateSubscriptionPaymentMethod ?? null,
    });
  } catch (err) {
    console.error("[billing] portal session failed:", err);
    return NextResponse.json({ success: false, error: "Couldn't open the subscription portal. Please try again." }, { status: 502 });
  }
}
