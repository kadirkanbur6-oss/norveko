// Shared helpers for the public API (/api/v1/*).
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { adminDb, apiAllowed, userFromApiKey } from "@/lib/api-keys";

export async function apiAuth(req: Request): Promise<{ user: User } | { error: NextResponse }> {
  const user = await userFromApiKey(req);
  if (!user) {
    return { error: NextResponse.json({ error: { code: "unauthorized", message: "Missing or invalid API key (Authorization: Bearer nv_live_…)." } }, { status: 401 }) };
  }
  if (!(await apiAllowed(adminDb(), user.id))) {
    return { error: NextResponse.json({ error: { code: "forbidden", message: "The API is available on any plan or pack." } }, { status: 403 }) };
  }
  return { user };
}

export const apiError = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });
