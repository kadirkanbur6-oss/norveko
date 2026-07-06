import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareSupabaseClient } from "./lib/supabase-middleware";

const PUBLIC_FILE = /(.*)\.(.*)$/;
const PUBLIC_PAGES = ["/", "/login", "/signup"];

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  const pathname = request.nextUrl.pathname;

  if (PUBLIC_FILE.test(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/api")) {
    return response;
  }

  const supabase = createMiddlewareSupabaseClient(request, response);

  const { data, error } = await supabase.auth.getSession();
  const session = data?.session ?? null;

  if (!session) {
    if (!PUBLIC_PAGES.includes(pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  if (pathname === "/login" || pathname === "/signup") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  const { data: channelData, error: channelError } = await supabase
    .from("user_channels")
    .select("channel_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const hasChannel = !!channelData?.channel_id;

  if (!hasChannel && pathname !== "/connect-channel") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/connect-channel";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
