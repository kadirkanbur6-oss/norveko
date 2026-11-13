// lib/agents.ts
// The "agent office" roster shown on /admin → Agents (13 Nov 2026). Each agent is a
// Claude subagent defined in .claude/agents/<id>.md; this file only describes them
// for the panel. Reports are rows in `agent_reports` (SQL in supabase/README.md),
// written through POST /api/admin/agents.

export type AgentLevel = "ok" | "warn" | "alert";

export interface AgentInfo {
  id: string;
  name: string;
  department: string;
  /** How it runs: a schedule, or on request. */
  runs: string;
  scheduled: boolean;
  role: string;
}

export const AGENT_DEPARTMENTS = ["Brain team", "Production", "Social media", "Analytics", "Finance", "Technology", "Support"] as const;

export const AGENTS: AgentInfo[] = [
  { id: "icerik-avcisi", name: "Content Scout", department: "Brain team", runs: "Every morning", scheduled: true, role: "Finds trending topics and formats, and turns them into three video ideas Norveko can make." },
  { id: "rakip-analisti", name: "Competitor Analyst", department: "Brain team", runs: "Every Monday", scheduled: true, role: "Tracks price and feature changes at competing tools and compares them with Norveko." },
  { id: "vitrin-yapimcisi", name: "Showcase Producer", department: "Production", runs: "On request (generation costs money)", scheduled: false, role: "Produces a chosen idea in Norveko and prepares it for the showcase or social media." },
  { id: "paylasim-yazari", name: "Post Writer", department: "Social media", runs: "On request", scheduled: false, role: "Writes titles, captions and tags for Reels, Shorts and TikTok." },
  { id: "panel-gozcusu", name: "Panel Watcher", department: "Analytics", runs: "On request (needs admin sign-in)", scheduled: false, role: "Summarises sign-ups, generations, failures and costs from this panel." },
  { id: "maliyet-denetcisi", name: "Cost Auditor", department: "Finance", runs: "On request", scheduled: false, role: "Checks provider balances, margins and cost warnings." },
  { id: "kod-bekcisi", name: "Code Guard", department: "Technology", runs: "Every Wednesday", scheduled: true, role: "Runs type checks, lint and tests, and reports risky changes and vulnerable packages." },
  { id: "destek-yanitcisi", name: "Support Drafter", department: "Support", runs: "On request", scheduled: false, role: "Drafts replies to messages sent to support@norveko.app." },
];

export const AGENT_IDS = AGENTS.map((a) => a.id);
export const AGENT_LEVELS: AgentLevel[] = ["ok", "warn", "alert"];
export const REPORTS_PER_AGENT = 10;

export interface AgentReportItem {
  text: string;
  url?: string;
}
export interface AgentReport {
  id: string;
  agent: string;
  level: AgentLevel;
  title: string;
  summary: string;
  items: AgentReportItem[];
  createdAt: string;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const httpUrl = (v: unknown) => (typeof v === "string" && /^https?:\/\//i.test(v) && v.length <= 600 ? v : undefined);

/** Validate a report sent by an agent. Returns the clean row or an error message. */
export function cleanReport(body: Record<string, unknown>): { ok: true; row: { agent: string; level: AgentLevel; title: string; summary: string; items: AgentReportItem[] } } | { ok: false; error: string } {
  const agent = clip(body.agent, 60);
  if (!AGENT_IDS.includes(agent)) return { ok: false, error: "Unknown agent." };
  const level = clip(body.level, 10) as AgentLevel;
  if (!AGENT_LEVELS.includes(level)) return { ok: false, error: "level must be ok, warn or alert." };
  const title = clip(body.title, 200);
  if (!title) return { ok: false, error: "title is required." };
  const summary = clip(body.summary, 1200);
  const raw = Array.isArray(body.items) ? body.items.slice(0, 12) : [];
  const items: AgentReportItem[] = [];
  for (const it of raw) {
    const text = typeof it === "string" ? clip(it, 600) : clip((it as Record<string, unknown> | null)?.text, 600);
    if (!text) continue;
    const url = typeof it === "object" && it ? httpUrl((it as Record<string, unknown>).url) : undefined;
    items.push(url ? { text, url } : { text });
  }
  return { ok: true, row: { agent, level, title, summary, items } };
}
