import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareSupabaseClient } from "./lib/supabase-middleware";

const PUBLIC_FILE = /(.*)\.(.*)$/;
const PUBLIC_PAGES = ["/", "/login", "/signup", "/forgot-password", "/auth/callback", "/terms", "/privacy", "/refund"];

// Invite links (?ref=<code>, lib/referrals/referrals.ts): remember the code
// for 60 days so it can be claimed after sign-up. First link wins.
function rememberReferral(request: NextRequest, res: NextResponse): NextResponse {
  const ref = request.nextUrl.searchParams.get("ref")?.toLowerCase();
  if (ref && /^[a-z0-9]{6,12}$/.test(ref) && !request.cookies.get("nv_ref")) {
    res.cookies.set("nv_ref", ref, { maxAge: 60 * 86400, httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  }
  return res;
}

export async function middleware(request: NextRequest) {
  const res = await handle(request);
  return rememberReferral(request, res);
}

async function handle(request: NextRequest) {
  const response = NextResponse.next();
  const pathname = request.nextUrl.pathname;

  if (PUBLIC_FILE.test(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/api")) {
    return response;
  }

  const supabase = createMiddlewareSupabaseClient(request, response);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (!PUBLIC_PAGES.includes(pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  if (pathname === "/login" || pathname === "/signup" || pathname === "/forgot-password") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
