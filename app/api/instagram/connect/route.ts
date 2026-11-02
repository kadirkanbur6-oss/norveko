// app/api/instagram/connect/route.ts — start "Connect Instagram" (state cookie → Instagram consent).

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { safeReturnTo, siteUrl } from "@/lib/youtube/oauth";
import { INSTAGRAM_STATE_COOKIE, instagramAuthorizationUrl, instagramConfigured } from "@/lib/instagram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);
  if (!instagramConfigured()) {
    return NextResponse.redirect(`${siteUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}instagram=not_configured`);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(instagramAuthorizationUrl(state));
  res.cookies.set(INSTAGRAM_STATE_COOKIE, `${state}|${user.id}|${returnTo}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/instagram",
    maxAge: 600,
  });
  return res;
}
