// app/api/admin/agents/route.ts
// The agent office on /admin → Agents.
//   GET  — owner only: the roster (lib/agents.ts) with each agent's latest reports.
//   POST — a report from an agent { agent, level, title, summary, items }. Accepted
//          from a signed-in admin, or with `Authorization: Bearer <AGENT_REPORT_TOKEN>`
//          (the scheduled Claude agents; the token can only add reports).
// Table `agent_reports`: SQL in supabase/README.md "Agent office".

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { adminDb } from "@/lib/supabase-admin";
import { AGENTS, REPORTS_PER_AGENT, cleanReport, type AgentReport } from "@/lib/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const missing = (message: string) => /does not exist|schema cache|relation/i.test(message);

function hasAgentToken(req: Request): boolean {
  const expected = process.env.AGENT_REPORT_TOKEN?.trim();
  if (!expected || expected.length < 24) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET() {
  const { user } = await requireUser();
  if (!user || !isAdmin(user)) return bad("Not found.", 404);
  const { data, error } = await adminDb()
    .from("agent_reports")
    .select("id, agent, level, title, summary, items, created_at")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error && !missing(error.message)) return bad(error.message, 500);
  const byAgent = new Map<string, AgentReport[]>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const agent = String(r.agent);
    const list = byAgent.get(agent) ?? [];
    if (list.length >= REPORTS_PER_AGENT) continue;
    list.push({
      id: String(r.id),
      agent,
      level: r.level === "alert" || r.level === "warn" ? r.level : "ok",
      title: String(r.title ?? ""),
      summary: String(r.summary ?? ""),
      items: Array.isArray(r.items) ? (r.items as AgentReport["items"]) : [],
      createdAt: String(r.created_at),
    });
    byAgent.set(agent, list);
  }
  return NextResponse.json({
    success: true,
    tableMissing: Boolean(error),
    tokenSet: Boolean(process.env.AGENT_REPORT_TOKEN?.trim()),
    agents: AGENTS.map((a) => ({ ...a, reports: byAgent.get(a.id) ?? [] })),
  });
}

export async function POST(req: NextRequest) {
  let allowed = hasAgentToken(req);
  if (!allowed) {
    const { user } = await requireUser();
    allowed = Boolean(user && isAdmin(user));
  }
  if (!allowed) return bad("Not found.", 404);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("Invalid JSON.");
  }
  const clean = cleanReport(body);
  if (!clean.ok) return bad(clean.error);
  const { data, error } = await adminDb().from("agent_reports").insert(clean.row).select("id, created_at").single();
  if (error) return bad(missing(error.message) ? "The agent_reports table is missing. Run the SQL in supabase/README.md first." : error.message, 500);
  return NextResponse.json({ success: true, id: data.id, createdAt: data.created_at });
}
