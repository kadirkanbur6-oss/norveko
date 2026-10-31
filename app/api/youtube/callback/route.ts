// app/api/youtube/callback/route.ts
// Google redirects here after consent: verify state, exchange the code, look
// up the channel and store the encrypted refresh token.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import {
  STATE_COOKIE,
  YOUTUBE_SCOPES,
  adminDb,
  encryptToken,
  exchangeCode,
  fetchOwnChannel,
  revokeToken,
  siteUrl,
} from "@/lib/youtube/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(returnTo: string, status: string) {
  const res = NextResponse.redirect(`${siteUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}youtube=${status}`);
  res.cookies.set(STATE_COOKIE, "", { path: "/api/youtube", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const [state, stateUser, returnTo = "/settings"] = (req.cookies.get(STATE_COOKIE)?.value ?? "").split("|");
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);
  if (!state || params.get("state") !== state || stateUser !== user.id) return back(returnTo, "error");
  if (params.get("error")) return back(returnTo, "cancelled");
  const code = params.get("code");
  if (!code) return back(returnTo, "error");

  try {
    const tokens = await exchangeCode(code);
    const granted = (tokens.scope ?? "").split(" ");
    if (!granted.includes(YOUTUBE_SCOPES[0])) {
      // The user unticked the upload permission on Google's screen.
      await revokeToken(tokens.access_token);
      return back(returnTo, "missing_permission");
    }
    if (!tokens.refresh_token) return back(returnTo, "error");
    const channel = await fetchOwnChannel(tokens.access_token);
    if (!channel) {
      await revokeToken(tokens.refresh_token);
      return back(returnTo, "no_channel");
    }
    const { error } = await adminDb().from("youtube_connections").upsert({
      user_id: user.id,
      channel_id: channel.id,
      channel_title: channel.title,
      channel_thumbnail: channel.thumbnail,
      refresh_token_enc: encryptToken(tokens.refresh_token),
      scope: tokens.scope ?? null,
      created_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return back(returnTo, "connected");
  } catch (err) {
    console.error("[youtube] connect failed:", err);
    return back(returnTo, "error");
  }
}
