// app/api/pipeline/render-check/route.ts
// GET: cheap Shotstack connectivity/auth probe for the full-video beta.
// Asks for a non-existent render id: 404/400 means the key works, 401/403
// means auth or environment mismatch. Never spends credits. Beta users only.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { isFullVideoEnabled } from "@/lib/pipeline/features";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();
  if (!user || !isFullVideoEnabled(user.id)) {
    return NextResponse.json({ success: false, error: "Not available." }, { status: 403 });
  }
  const key = process.env.SHOTSTACK_API_KEY ?? "";
  const env = process.env.SHOTSTACK_ENV === "v1" ? "v1" : "stage";
  const url = `https://api.shotstack.io/edit/${env}/render/00000000-0000-0000-0000-000000000000`;
  try {
    const res = await fetch(url, {
      headers: { "x-api-key": key, Accept: "application/json" },
      cache: "no-store",
    });
    const body = await res.text();
    return NextResponse.json({
      success: true,
      env,
      keyPresent: key.length > 0,
      keyLength: key.length,
      keyLooksTrimmed: key === key.trim(),
      keyPrefix: key.slice(0, 4),
      status: res.status,
      body: body.slice(0, 300),
      contentType: res.headers.get("content-type"),
    });
  } catch (err) {
    return NextResponse.json({ success: false, env, error: err instanceof Error ? err.message : String(err) });
  }
}
