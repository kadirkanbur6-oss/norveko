// app/api/tiktok/callback/route.ts — TikTok consent → store the (encrypted) refresh token.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb, siteUrl } from "@/lib/youtube/oauth";
import {
  TIKTOK_STATE_COOKIE,
  exchangeTikTokCode,
  fetchTikTokUser,
  revokeTikTok,
  saveTikTokConnection,
} from "@/lib/tiktok/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(returnTo: string, status: string) {
  const res = NextResponse.redirect(`${siteUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}tiktok=${status}`);
  res.cookies.set(TIKTOK_STATE_COOKIE, "", { path: "/api/tiktok", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const [state, stateUser, returnTo = "/settings"] = (req.cookies.get(TIKTOK_STATE_COOKIE)?.value ?? "").split("|");
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);
  if (!state || params.get("state") !== state || stateUser !== user.id) return back(returnTo, "error");
  if (params.get("error")) return back(returnTo, "cancelled");
  const code = params.get("code");
  if (!code) return back(returnTo, "error");
  try {
    const tokens = await exchangeTikTokCode(code);
    if (!tokens.scope.split(",").includes("video.publish")) {
      await revokeTikTok(tokens.access_token);
      return back(returnTo, "missing_permission");
    }
    const profile = await fetchTikTokUser(tokens.access_token);
    await saveTikTokConnection(adminDb(), user.id, tokens, profile);
    return back(returnTo, "connected");
  } catch (err) {
    console.error("[tiktok] connect failed:", err);
    return back(returnTo, "error");
  }
}
