// app/api/tiktok/connect/route.ts — start "Connect TikTok" (state cookie → TikTok consent).

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { safeReturnTo, siteUrl } from "@/lib/youtube/oauth";
import { TIKTOK_STATE_COOKIE, tiktokAuthorizationUrl, tiktokConfigured } from "@/lib/tiktok/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);
  if (!tiktokConfigured()) {
    return NextResponse.redirect(`${siteUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}tiktok=not_configured`);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(tiktokAuthorizationUrl(state));
  res.cookies.set(TIKTOK_STATE_COOKIE, `${state}|${user.id}|${returnTo}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/tiktok",
    maxAge: 600,
  });
  return res;
}
