// app/api/series/tick/route.ts
// Cron (vercel.json): create episodes for upcoming post times of every active
// series. Vercel calls it with "Authorization: Bearer $CRON_SECRET".

import { NextResponse } from "next/server";
import { runSeriesTick } from "@/lib/series/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const secret = process.env.CRON_SECRET;
  if (!secret || token !== secret) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const summary = await runSeriesTick();
  return NextResponse.json({ success: true, ...summary });
}
