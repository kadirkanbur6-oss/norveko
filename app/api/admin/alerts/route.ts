// app/api/admin/alerts/route.ts
// Light check for the red dot next to "Admin" in the sidebar: which providers are low
// or out of credit. Owner only (everyone else gets 404). See lib/admin-providers.ts.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { adminDb } from "@/lib/api-keys";
import { alertsOf, loadProviders } from "@/lib/admin-providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const { user } = await requireUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  try {
    const { providers } = await loadProviders(adminDb());
    return NextResponse.json({ success: true, alerts: alertsOf(providers) });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "failed" }, { status: 500 });
  }
}
