// app/api/signup-check/route.ts
// Early, friendly warning on the signup form for throwaway inboxes. The real
// enforcement is in /api/pipeline/start (signup itself goes straight to Supabase).

import { NextResponse, type NextRequest } from "next/server";
import { isDisposableEmail } from "@/lib/pipeline/abuse";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let email = "";
  try {
    const body = await req.json();
    email = typeof body?.email === "string" ? body.email.slice(0, 320) : "";
  } catch {
    // ignore — treated as ok below
  }
  if (email && isDisposableEmail(email)) {
    return NextResponse.json({
      ok: false,
      error: "Temporary email addresses can't be used for a Norveko account. Please use a permanent email.",
    });
  }
  return NextResponse.json({ ok: true });
}
