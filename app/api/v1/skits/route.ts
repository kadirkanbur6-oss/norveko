// app/api/v1/skits/route.ts — public API for skits (4 Nov 2026).
//   POST {script, orientation?} → plan the skit and start making it (charges credits)
//   GET  → your 20 most recent skits

import { NextRequest, NextResponse } from "next/server";
import { withApiUser, adminDb } from "@/lib/api-keys";
import { POST as skitPost } from "@/app/api/skit/route";
import { apiAuth, apiError } from "../_auth";
import { skitApiView } from "./view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SkitView = { id: string; status: string; title: string; credits: number; outputUrl: string | null; projectId: string | null; error: string | null };

async function call(req: NextRequest, user: Parameters<typeof withApiUser>[0], body: Record<string, unknown>) {
  const inner = new NextRequest(req.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const res = await withApiUser(user, () => skitPost(inner));
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; error?: string; code?: string } };
}

export async function POST(req: NextRequest) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw.script !== "string") return apiError(400, "invalid_body", 'Send {"script": "…the joke with its lines…"}.');
  const plan = await call(req, auth.user, { action: "plan", script: raw.script, orientation: raw.orientation });
  if (!plan.data.success) return apiError(plan.status, plan.data.code ?? "rejected", plan.data.error ?? "The skit could not be planned.");
  const id = (plan.data.skit as SkitView).id;
  const start = await call(req, auth.user, { action: "start", id, rights: true });
  if (!start.data.success) return apiError(start.status, start.data.code ?? "rejected", start.data.error ?? "The skit could not be started.");
  return NextResponse.json({ id, status: "running", credits: start.data.credits, url: `/api/v1/skits/${id}` }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const auth = await apiAuth(req);
  if ("error" in auth) return auth.error;
  const { data } = await adminDb()
    .from("skit_jobs")
    .select("id, status, phase, plan, credits, output_url, project_id, error, created_at")
    .eq("user_id", auth.user.id)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(20);
  return NextResponse.json({ data: (data ?? []).map(skitApiView) });
}
