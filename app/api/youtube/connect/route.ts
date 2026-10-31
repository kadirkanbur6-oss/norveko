// app/api/youtube/connect/route.ts
// Starts "Connect YouTube": sets a short-lived state cookie and redirects to
// Google's consent screen. ?returnTo=/projects/<id> brings the user back.

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { STATE_COOKIE, authorizationUrl, safeReturnTo, siteUrl, youtubeUploadConfigured } from "@/lib/youtube/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);
  if (!youtubeUploadConfigured()) {
    return NextResponse.redirect(`${siteUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}youtube=not_configured`);
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(authorizationUrl(state));
  res.cookies.set(STATE_COOKIE, `${state}|${user.id}|${returnTo}`, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/youtube",
    maxAge: 600,
  });
  return res;
}
