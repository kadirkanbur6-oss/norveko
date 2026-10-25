// app/api/stock/route.ts
// GET /api/stock?q=...&orientation=vertical|horizontal
// Stock B-roll suggestions for a scene (Pexels). Signed-in users only; results
// are cached per query for an hour per instance to stay well inside rate limits.

import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { searchStockClips, stockQueryFromPrompt, type StockClip } from "@/lib/pipeline/pexels";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; clips: StockClip[] }>();
const TTL = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const { user } = await requireUser();
  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }
  if (!process.env.PEXELS_API_KEY) {
    return NextResponse.json({ success: false, error: "Stock footage is not configured." }, { status: 503 });
  }

  const raw = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 400);
  const orientation = req.nextUrl.searchParams.get("orientation") === "vertical" ? "vertical" : "horizontal";
  const query = raw.length > 60 ? stockQueryFromPrompt(raw) : raw.trim();
  if (!query) {
    return NextResponse.json({ success: false, error: "Query required." }, { status: 400 });
  }

  const cacheKey = `${orientation}:${query.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ success: true, query, clips: hit.clips, cached: true });
  }

  try {
    const clips = await searchStockClips(query, orientation);
    cache.set(cacheKey, { at: Date.now(), clips });
    return NextResponse.json({ success: true, query, clips });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Stock search failed." },
      { status: 502 }
    );
  }
}
