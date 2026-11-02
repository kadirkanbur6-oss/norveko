// app/api/instagram/callback/route.ts — Instagram consent → store the (encrypted) long-lived token.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb, siteUrl } from "@/lib/youtube/oauth";
import {
  INSTAGRAM_STATE_COOKIE,
  exchangeInstagramCode,
  fetchInstagramProfile,
  saveInstagramConnection,
} from "@/lib/instagram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(returnTo: string, status: string) {
  const res = NextResponse.redirect(`${siteUrl()}${returnTo}${returnTo.includes("?") ? "&" : "?"}instagram=${status}`);
  res.cookies.set(INSTAGRAM_STATE_COOKIE, "", { path: "/api/instagram", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const [state, stateUser, returnTo = "/settings"] = (req.cookies.get(INSTAGRAM_STATE_COOKIE)?.value ?? "").split("|");
  const { user } = await requireUser();
  if (!user) return NextResponse.redirect(`${siteUrl()}/login`);
  if (!state || params.get("state") !== state || stateUser !== user.id) return back(returnTo, "error");
  if (params.get("error")) return back(returnTo, "cancelled");
  const code = params.get("code")?.replace(/#_$/, "");
  if (!code) return back(returnTo, "error");
  try {
    const tokens = await exchangeInstagramCode(code);
    if (tokens.permissions.length && !tokens.permissions.includes("instagram_business_content_publish")) {
      return back(returnTo, "missing_permission");
    }
    const profile = await fetchInstagramProfile(tokens.token);
    if (profile.accountType && !/BUSINESS|MEDIA_CREATOR|CREATOR/i.test(profile.accountType)) return back(returnTo, "not_professional");
    await saveInstagramConnection(adminDb(), user.id, tokens, { id: profile.id || tokens.userId, username: profile.username, avatarUrl: profile.avatarUrl });
    return back(returnTo, "connected");
  } catch (err) {
    console.error("[instagram] connect failed:", err);
    return back(returnTo, "error");
  }
}
