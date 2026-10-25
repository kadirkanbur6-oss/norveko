// app/api/health/route.ts
// Liveness + a cheap readiness probe (Supabase reachable). Safe to expose:
// no secrets, no user data.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database: "ok" | "error" = "ok";
  try {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );
    const { error } = await client.from("projects").select("id", { head: true, count: "exact" }).limit(1);
    if (error) database = "error";
  } catch {
    database = "error";
  }

  const ok = database === "ok";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      database,
      generation: process.env.GENERATION_ENABLED !== "false" ? "open" : "locked",
      latencyMs: Date.now() - started,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
