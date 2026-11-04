"use client";

// app/admin/page.tsx
// Owner's admin panel: who signed up, what they generated, what was paid and
// what the providers cost. Read-only; data from GET /api/admin.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Search, X } from "lucide-react";
import Sidebar from "../components/Sidebar";
import PageTabs, { PageHeader, useTabParam, type PageTab } from "../components/PageTabs";

interface Overview {
  users: number;
  newUsers: number;
  activeUsers: number;
  payingUsers: number;
  activeSubscriptions: number;
  revenueUsd: number;
  revenueWindowUsd: number;
  refundedUsd: number;
  costWindowUsd: number;
  creditsOutstanding: number;
  creditsSpentWindow: number;
  jobs: { running: number; completed: number; failed: number };
  failedWindow: number;
  generationOpen: boolean;
  fullVideoOpen: boolean;
  fal: { balanceUsd: number; topupUsd: number; low: boolean } | null;
}
interface Daily {
  day: string;
  signups: number;
  revenueUsd: number;
  costUsd: number;
}
interface UserRow {
  id: string;
  email: string;
  provider: string;
  verified: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  credits: number;
  paidUsd: number;
  plan: string | null;
  spends: number;
  creditsSpent: number;
  costUsd: number;
}
interface Generation {
  id: string;
  kind: string;
  userId: string;
  email: string;
  title: string;
  status: string;
  step: string;
  detail: string;
  credits: number;
  refunded: number;
  error: string | null;
  createdAt: string;
}
interface Payment {
  id: string;
  userId: string;
  email: string;
  packageId: string;
  credits: number;
  amountUsd: number;
  status: string;
  createdAt: string;
}
interface Cost {
  provider: string;
  model: string;
  calls: number;
  failed: number;
  costUsd: number;
}
interface AdminData {
  days: number;
  generatedAt: string;
  errors: string[];
  overview: Overview;
  daily: Daily[];
  users: UserRow[];
  generations: Generation[];
  payments: Payment[];
  costs: Cost[];
}

const TABS: PageTab[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "generations", label: "Generations" },
  { id: "payments", label: "Payments" },
  { id: "costs", label: "Provider costs" },
];

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 });
const int = (n: number) => n.toLocaleString("en-US");
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const CARD = "rounded-2xl border border-white/[0.07] bg-white/[0.025]";
const TH = "px-3 py-2.5 text-left text-xs font-medium text-gray-400";
const TD = "px-3 py-2.5 align-top text-sm";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className={`${CARD} p-4`}>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-white">{value}</p>
      {note && <p className="mt-1 text-xs text-gray-400">{note}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "completed"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      : status === "failed" || status === "refunded"
        ? "border-red-400/30 bg-red-400/10 text-red-300"
        : "border-blue-400/30 bg-blue-400/10 text-blue-300";
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${tone}`}>{status}</span>;
}

/** One bar per day; the tallest day fills the height. */
function Bars({ title, total, data, value, format }: { title: string; total: string; data: Daily[]; value: (d: Daily) => number; format: (n: number) => string }) {
  const max = Math.max(...data.map(value), 0);
  return (
    <div className={`${CARD} p-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-gray-300">{title}</p>
        <p className="text-sm font-medium text-white">{total}</p>
      </div>
      <div className="mt-4 flex h-24 items-end gap-[2px]" role="img" aria-label={`${title}: ${total}`}>
        {data.map((d) => {
          const v = value(d);
          return (
            <div
              key={d.day}
              title={`${d.day}: ${format(v)}`}
              className={`min-w-0 flex-1 rounded-t-sm ${v > 0 ? "bg-gradient-to-t from-blue-500/70 to-purple-400/80" : "bg-white/[0.06]"}`}
              style={{ height: v > 0 && max > 0 ? `${Math.max(6, (v / max) * 100)}%` : "2px" }}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-gray-500">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className={`${CARD} px-4 py-10 text-center text-sm text-gray-400`}>{children}</p>;
}

export default function AdminPage() {
  const [tab, setTab] = useTabParam(TABS, "overview");
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [userFilter, setUserFilter] = useState<{ id: string; email: string } | null>(null);

  const load = useCallback(async (window: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin?days=${window}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load admin data.");
      setData(json as AdminData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(days), 0);
    return () => clearTimeout(t);
  }, [days, load]);

  const users = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.users ?? []).filter((u) => !q || u.email.toLowerCase().includes(q) || u.id.includes(q));
  }, [data, query]);

  const generations = useMemo(
    () =>
      (data?.generations ?? []).filter(
        (g) => (statusFilter === "all" || g.status === statusFilter) && (!userFilter || g.userId === userFilter.id)
      ),
    [data, statusFilter, userFilter]
  );

  const o = data?.overview;
  const windowLabel = `last ${days} days`;

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0a0a12] text-white">
      <Sidebar />
      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Admin"
            subtitle={data ? `Live data · updated ${date(data.generatedAt)}` : "Accounts, generations, payments and costs"}
            action={
              <div className="flex items-center gap-2">
                <div className="flex rounded-xl border border-white/[0.07] bg-white/[0.025] p-0.5" role="group" aria-label="Time window">
                  {[7, 30, 90].map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={days === d}
                      onClick={() => setDays(d)}
                      className={`rounded-[10px] px-3 py-1.5 text-sm transition ${days === d ? "bg-white/[0.09] font-medium text-white" : "text-gray-400 hover:text-gray-200"}`}
                    >
                      {d} d
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => load(days)}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-sm text-gray-200 transition hover:bg-white/[0.06] disabled:opacity-60"
                >
                  {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  Refresh
                </button>
              </div>
            }
          />

          <PageTabs tabs={TABS} active={tab} onChange={setTab} />

          {error && (
            <p role="alert" className="rounded-2xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {error}
            </p>
          )}
          {data && data.errors.length > 0 && (
            <div className="flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p>Some tables could not be read, so the numbers below are incomplete:</p>
                <ul className="mt-1 list-disc pl-5 text-amber-100/80">
                  {data.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {!data && loading && (
            <div className="flex items-center justify-center gap-3 py-24 text-sm text-gray-400">
              <Loader2 size={18} className="animate-spin" /> Loading admin data…
            </div>
          )}

          {data && o && tab === "overview" && (
            <div className="space-y-4">
              {o.fal?.low && (
                <div role="alert" className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
                  <strong>fal.ai balance is low: {usd(o.fal.balanceUsd)}</strong> — under 20% of a {usd(o.fal.topupUsd)} top-up. Lip-sync, swaps and
                  image→video clips stop when it runs out (users get refunds, but videos fail).{" "}
                  <a href="https://fal.ai/dashboard/usage-billing/credits" target="_blank" rel="noreferrer" className="underline">
                    Add credits
                  </a>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Users" value={int(o.users)} note={`+${int(o.newUsers)} in the ${windowLabel} · ${int(o.activeUsers)} signed in this week`} />
                <Stat label="Revenue (all time)" value={usd(o.revenueUsd)} note={`${usd(o.revenueWindowUsd)} in the ${windowLabel}${o.refundedUsd ? ` · ${usd(o.refundedUsd)} refunded` : ""}`} />
                <Stat label="Paying users" value={int(o.payingUsers)} note={`${int(o.activeSubscriptions)} active subscriptions`} />
                <Stat label={`Provider cost, ${windowLabel}`} value={usd(o.costWindowUsd)} note={`${int(o.creditsSpentWindow)} credits spent by users`} />
                <Stat label="Running now" value={int(o.jobs.running)} />
                <Stat label="Completed (all time)" value={int(o.jobs.completed)} />
                <Stat label="Failed (all time)" value={int(o.jobs.failed)} note={`${int(o.failedWindow)} in the ${windowLabel}`} />
                <Stat label="Unspent credits" value={int(o.creditsOutstanding)} note="Across every account" />
                {o.fal && <Stat label="fal.ai balance" value={usd(o.fal.balanceUsd)} note={o.fal.low ? "Low — add credits" : `Warns at ${usd(o.fal.topupUsd * 0.2)}`} />}
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <Bars title="Sign-ups per day" total={int(o.newUsers)} data={data.daily} value={(d) => d.signups} format={int} />
                <Bars title="Revenue per day" total={usd(o.revenueWindowUsd)} data={data.daily} value={(d) => d.revenueUsd} format={usd} />
                <Bars title="Provider cost per day" total={usd(o.costWindowUsd)} data={data.daily} value={(d) => d.costUsd} format={usd} />
              </div>
              <div className={`${CARD} flex flex-wrap gap-x-8 gap-y-2 px-4 py-3 text-sm`}>
                <span className="text-gray-400">
                  Generation for everyone: <span className={o.generationOpen ? "text-emerald-300" : "text-amber-300"}>{o.generationOpen ? "Open" : "Locked (beta accounts only)"}</span>
                </span>
                <span className="text-gray-400">
                  Full video for everyone: <span className={o.fullVideoOpen ? "text-emerald-300" : "text-amber-300"}>{o.fullVideoOpen ? "Open" : "Locked (beta accounts only)"}</span>
                </span>
              </div>
            </div>
          )}

          {data && tab === "users" && (
            <div className="space-y-3">
              <label className={`${CARD} flex items-center gap-2 px-3 py-2`}>
                <Search size={15} className="text-gray-500" />
                <span className="sr-only">Search users</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by email or user id"
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                />
                <span className="shrink-0 text-xs text-gray-400">{int(users.length)} users</span>
              </label>
              {users.length === 0 ? (
                <Empty>No users match this search.</Empty>
              ) : (
                <div className={`${CARD} overflow-x-auto`}>
                  <table className="w-full min-w-[820px] border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.07]">
                        <th className={TH}>User</th>
                        <th className={TH}>Signed up</th>
                        <th className={TH}>Last sign-in</th>
                        <th className={`${TH} text-right`}>Credits</th>
                        <th className={`${TH} text-right`}>Paid</th>
                        <th className={`${TH} text-right`}>Spent ({days} d)</th>
                        <th className={`${TH} text-right`}>Our cost ({days} d)</th>
                        <th className={TH} />
                      </tr>
                    </thead>
                    <tbody>
                      {users.slice(0, 500).map((u) => (
                        <tr key={u.id} className="border-b border-white/[0.04] last:border-0">
                          <td className={TD}>
                            <p className="text-white">{u.email || "(no email)"}</p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {u.provider}
                              {!u.verified && " · not verified"}
                              {u.plan && ` · ${u.plan}`}
                            </p>
                          </td>
                          <td className={`${TD} whitespace-nowrap text-gray-300`}>{date(u.createdAt)}</td>
                          <td className={`${TD} whitespace-nowrap text-gray-300`}>{date(u.lastSignInAt)}</td>
                          <td className={`${TD} text-right tabular-nums text-white`}>{int(u.credits)}</td>
                          <td className={`${TD} text-right tabular-nums ${u.paidUsd ? "text-emerald-300" : "text-gray-500"}`}>{u.paidUsd ? usd(u.paidUsd) : "—"}</td>
                          <td className={`${TD} text-right tabular-nums text-gray-300`}>{u.creditsSpent ? `${int(u.creditsSpent)} cr` : "—"}</td>
                          <td className={`${TD} text-right tabular-nums text-gray-300`}>{u.costUsd ? usd(u.costUsd) : "—"}</td>
                          <td className={`${TD} text-right`}>
                            <button
                              type="button"
                              onClick={() => {
                                setUserFilter({ id: u.id, email: u.email });
                                setStatusFilter("all");
                                setTab("generations");
                              }}
                              className="whitespace-nowrap text-xs text-blue-300 hover:text-blue-200"
                            >
                              Generations
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {users.length > 500 && <p className="text-xs text-gray-400">Showing the newest 500. Search to find older accounts.</p>}
            </div>
          )}

          {data && tab === "generations" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {["all", "running", "completed", "failed"].map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={statusFilter === s}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-full border px-3 py-1 text-sm capitalize transition ${
                      statusFilter === s ? "border-white/20 bg-white/[0.09] text-white" : "border-white/[0.07] text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    {s}
                  </button>
                ))}
                {userFilter && (
                  <button
                    type="button"
                    onClick={() => setUserFilter(null)}
                    className="flex items-center gap-1.5 rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1 text-sm text-blue-200"
                  >
                    {userFilter.email || userFilter.id.slice(0, 8)} <X size={13} aria-label="Clear user filter" />
                  </button>
                )}
                <span className="ml-auto text-xs text-gray-400">Newest {int(generations.length)} shown</span>
              </div>
              {generations.length === 0 ? (
                <Empty>No generations match these filters.</Empty>
              ) : (
                <div className={`${CARD} overflow-x-auto`}>
                  <table className="w-full min-w-[820px] border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.07]">
                        <th className={TH}>Started</th>
                        <th className={TH}>What</th>
                        <th className={TH}>User</th>
                        <th className={TH}>Status</th>
                        <th className={`${TH} text-right`}>Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {generations.map((g) => (
                        <tr key={`${g.kind}-${g.id}`} className="border-b border-white/[0.04] last:border-0">
                          <td className={`${TD} whitespace-nowrap text-gray-300`}>{date(g.createdAt)}</td>
                          <td className={`${TD} max-w-[360px]`}>
                            <p className="truncate text-white" title={g.title}>
                              {g.title || "(untitled)"}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {g.kind}
                              {g.detail && ` · ${g.detail}`}
                            </p>
                            {g.error && <p className="mt-1 break-words text-xs text-red-300">{g.error}</p>}
                          </td>
                          <td className={`${TD} max-w-[220px] truncate text-gray-300`} title={g.userId}>
                            {g.email || g.userId.slice(0, 8)}
                          </td>
                          <td className={TD}>
                            <StatusPill status={g.status} />
                            {g.status === "running" && g.step && <p className="mt-1 text-xs text-gray-500">{g.step}</p>}
                          </td>
                          <td className={`${TD} whitespace-nowrap text-right tabular-nums text-gray-200`}>
                            {int(g.credits)}
                            {g.refunded > 0 && <p className="text-xs text-amber-300">−{int(g.refunded)} refunded</p>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {data && tab === "payments" && (
            data.payments.length === 0 ? (
              <Empty>No payments yet.</Empty>
            ) : (
              <div className={`${CARD} overflow-x-auto`}>
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr className="border-b border-white/[0.07]">
                      <th className={TH}>Date</th>
                      <th className={TH}>User</th>
                      <th className={TH}>Pack / plan</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Credits</th>
                      <th className={`${TH} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id} className="border-b border-white/[0.04] last:border-0">
                        <td className={`${TD} whitespace-nowrap text-gray-300`}>{date(p.createdAt || null)}</td>
                        <td className={`${TD} max-w-[240px] truncate text-white`} title={p.userId}>
                          {p.email || p.userId.slice(0, 8)}
                        </td>
                        <td className={`${TD} text-gray-300`}>
                          {p.packageId}
                          <p className="mt-0.5 text-xs text-gray-500">{p.id}</p>
                        </td>
                        <td className={TD}>
                          <StatusPill status={p.status} />
                        </td>
                        <td className={`${TD} text-right tabular-nums text-gray-200`}>{int(p.credits)}</td>
                        <td className={`${TD} text-right tabular-nums text-white`}>{usd(p.amountUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}

          {data && tab === "costs" && (
            data.costs.length === 0 ? (
              <Empty>{`No provider calls were logged in the ${windowLabel}.`}</Empty>
            ) : (
              <div className="space-y-3">
                <div className={`${CARD} overflow-x-auto`}>
                  <table className="w-full min-w-[620px] border-collapse">
                    <thead>
                      <tr className="border-b border-white/[0.07]">
                        <th className={TH}>Provider</th>
                        <th className={TH}>Model</th>
                        <th className={`${TH} text-right`}>Calls</th>
                        <th className={`${TH} text-right`}>Failed</th>
                        <th className={`${TH} text-right`}>Estimated cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.costs.map((c) => (
                        <tr key={`${c.provider}-${c.model}`} className="border-b border-white/[0.04] last:border-0">
                          <td className={`${TD} capitalize text-white`}>{c.provider}</td>
                          <td className={`${TD} text-gray-300`}>{c.model}</td>
                          <td className={`${TD} text-right tabular-nums text-gray-200`}>{int(c.calls)}</td>
                          <td className={`${TD} text-right tabular-nums ${c.failed ? "text-red-300" : "text-gray-500"}`}>{int(c.failed)}</td>
                          <td className={`${TD} text-right tabular-nums text-white`}>{usd(c.costUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-400">
                  Estimates from the usage log for the {windowLabel}: units used × list prices. Skits, talking characters and swaps are logged from 5 Nov 2026 on; earlier ones are missing, and the providers&apos; own invoices are the final word.
                </p>
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}
