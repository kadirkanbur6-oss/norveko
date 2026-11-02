// app/api/v1/videos/route.ts — public API.
//   POST → start a video (same options as the AI Workspace; see /developers)
//   GET  → your 20 most recent videos

import { NextRequest, NextResponse } from "next/server";
import { withApiUser, adminDb } from "@/lib/api-keys";
import { POST as startPipeline } from "@/app/api/pipeline/start/route";
import { apiAuth, apiError } from "../_auth";
import { jobView } from "./view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return apiError(400, "invalid_body", "Send a JSON body.");
  // Friendly names → the workspace's fields; API jobs never wait for a review.
  const body = {
    ...raw,
    sourceUrl: raw.sourceUrl ?? raw.url,
    outputLanguage: raw.outputLanguage ?? raw.language,
    includeFullVideo: raw.includeFullVideo ?? raw.fullVideo ?? true,
    includeVoiceover: raw.includeVoiceover ?? true,
    includeSubtitles: raw.includeSubtitles ?? true,
    includeResearch: raw.includeResearch ?? raw.research,
    voiceId: raw.voiceId ?? "gemini:Charon",
    review: false,
  };
  const inner = new NextRequest(req.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": req.headers.get("x-forwarded-for") ?? "" },
    body: JSON.stringify(body),
  });
  const res = await withApiUser(auth.user, () => startPipeline(inner));
  const data = (await res.json().catch(() => ({}))) as { success?: boolean; jobId?: string; error?: string; code?: string };
  if (!data.success) return apiError(res.status, data.code ?? "rejected", data.error ?? "The video could not be started.");
  return NextResponse.json({ id: data.jobId, status: "running", url: `/api/v1/videos/${data.jobId}` }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const { data } = await adminDb()
    .from("pipeline_jobs")
    .select("id, idea, status, error, duration, output_language, created_at, current_step, credits_charged, credits_refunded, steps")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  return NextResponse.json({ data: (data ?? []).map(jobView) });
}
