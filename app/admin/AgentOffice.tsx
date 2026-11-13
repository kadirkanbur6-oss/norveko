"use client";

// app/admin/AgentOffice.tsx
// "Agents" tab: the agent office. A floor plan with one room per department and one
// desk per agent (lib/agents.ts); the selected agent's role and latest reports sit
// beside it. Data: GET /api/admin/agents.

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { AGENT_DEPARTMENTS, type AgentInfo, type AgentLevel, type AgentReport } from "@/lib/agents";

interface AgentRow extends AgentInfo {
  reports: AgentReport[];
}
interface AgentsResponse {
  success: boolean;
  error?: string;
  tableMissing?: boolean;
  tokenSet?: boolean;
  agents?: AgentRow[];
}

const CARD = "rounded-2xl border border-white/[0.07] bg-white/[0.025]";
const LEVEL_LABEL: Record<AgentLevel, string> = { ok: "All good", warn: "Needs a look", alert: "Act today" };
const DOT: Record<AgentLevel | "none", string> = { ok: "bg-emerald-400", warn: "bg-amber-400", alert: "bg-red-400", none: "bg-gray-500" };
const STRIPE: Record<AgentLevel, string> = { ok: "border-emerald-400/70", warn: "border-amber-400/70", alert: "border-red-400/70" };
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const initials = (name: string) => name.split(" ").map((w) => w[0]).join("").slice(0, 2);

export default function AgentOffice() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [meta, setMeta] = useState<{ tableMissing: boolean; tokenSet: boolean }>({ tableMissing: false, tokenSet: true });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState("icerik-avcisi");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/agents", { cache: "no-store" });
      const json = (await res.json()) as AgentsResponse;
      if (!res.ok || !json.success || !json.agents) throw new Error(json.error || "Could not load the agents.");
      setAgents(json.agents);
      setMeta({ tableMissing: json.tableMissing === true, tokenSet: json.tokenSet !== false });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the agents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!agents) {
    return (
      <div className={`${CARD} flex items-center gap-2 px-4 py-6 text-sm text-gray-300`} role={error ? "alert" : "status"}>
        {error ? error : (<><Loader2 size={16} className="animate-spin" /> Loading the agent office…</>)}
      </div>
    );
  }

  const current = agents.find((a) => a.id === selected) ?? agents[0];
  const tally = { alert: 0, warn: 0, ok: 0, none: 0 };
  for (const a of agents) tally[a.reports[0]?.level ?? "none"]++;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs text-gray-300">
          {tally.alert > 0 && <Chip dot={DOT.alert}>{tally.alert} act today</Chip>}
          {tally.warn > 0 && <Chip dot={DOT.warn}>{tally.warn} need a look</Chip>}
          {tally.ok > 0 && <Chip dot={DOT.ok}>{tally.ok} all good</Chip>}
          <Chip dot={DOT.none}>{tally.none} waiting for a first report</Chip>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 hover:bg-white/[0.06] disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {meta.tableMissing && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200" role="alert">
          The agent_reports table is missing, so reports cannot be saved yet. Run the &quot;Agent office&quot; SQL in supabase/README.md.
        </p>
      )}
      {!meta.tableMissing && !meta.tokenSet && (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-300">
          Scheduled agents cannot post here until AGENT_REPORT_TOKEN is set in Vercel. Reports added while signed in as an admin still work.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section aria-label="Office floor plan" className="grid grid-cols-6 gap-3 rounded-2xl border-2 border-white/15 bg-white/[0.02] p-3">
          {AGENT_DEPARTMENTS.map((dept) => {
            const desks = agents.filter((a) => a.department === dept);
            if (!desks.length) return null;
            const span = desks.length > 1 || dept === "Support" ? "col-span-6" : dept === "Production" || dept === "Social media" ? "col-span-6 sm:col-span-3" : "col-span-6 sm:col-span-2";
            return (
              <div key={dept} className={`${span} rounded-xl border border-white/10 bg-white/[0.025] p-3`}>
                <p className="mb-2 font-mono text-[11px] uppercase tracking-widest text-gray-400">{dept}</p>
                <div className="flex flex-wrap gap-2.5">
                  {desks.map((a) => {
                    const last = a.reports[0];
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={a.id === current.id}
                        onClick={() => setSelected(a.id)}
                        className={`min-w-0 flex-1 basis-40 rounded-xl border p-3 text-left transition ${a.id === current.id ? "border-violet-400/70 bg-violet-500/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
                      >
                        <span className="flex items-center gap-2">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-semibold text-violet-200">{initials(a.name)}</span>
                          <span className="min-w-0 break-words text-sm font-medium text-white">{a.name}</span>
                        </span>
                        <span className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[last?.level ?? "none"]}`} />
                          {last ? `${LEVEL_LABEL[last.level]} · ${when(last.createdAt)}` : "No report yet"}
                        </span>
                        <span className="mt-1 line-clamp-2 break-words text-xs text-gray-400">{last?.title || a.runs}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <aside className={`${CARD} space-y-4 p-5`} aria-live="polite">
          <div>
            <h2 className="text-lg font-semibold text-white">{current.name}</h2>
            <p className="mt-1 text-sm text-gray-300">{current.role}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-gray-400">Department</dt>
            <dd className="text-gray-200">{current.department}</dd>
            <dt className="text-gray-400">Runs</dt>
            <dd className="text-gray-200">{current.runs}</dd>
            <dt className="text-gray-400">Definition</dt>
            <dd className="break-all font-mono text-gray-200">.claude/agents/{current.id}.md</dd>
          </dl>
          {current.reports.length === 0 ? (
            <p className="text-sm text-gray-400">This agent has not reported yet. Its first report appears here after it runs.</p>
          ) : (
            <div className="space-y-4">
              {current.reports.map((r) => (
                <article key={r.id} className={`border-l-2 pl-3 ${STRIPE[r.level]}`}>
                  <p className="font-mono text-[11px] text-gray-400">{when(r.createdAt)} · {LEVEL_LABEL[r.level]}</p>
                  <h3 className="mt-0.5 break-words text-sm font-medium text-white">{r.title}</h3>
                  {r.summary && <p className="mt-1 break-words text-sm text-gray-300">{r.summary}</p>}
                  {r.items.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-gray-300">
                      {r.items.map((it, i) => (
                        <li key={i} className="break-words">
                          {it.text}
                          {it.url && /^https?:\/\//i.test(it.url) && (
                            <a href={it.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-violet-300 hover:underline">
                              source <ExternalLink size={11} />
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Chip({ dot, children }: { dot: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {children}
    </span>
  );
}
