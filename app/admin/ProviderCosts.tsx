"use client";

// app/admin/ProviderCosts.tsx
// "Provider costs" tab: balance + status per provider, where the money went
// (provider → model, provider → step) and the fixed monthly subscriptions.
// Data comes from GET /api/admin (lib/admin-providers.ts); typed balances are
// saved through POST /api/admin/providers.

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, ExternalLink, Loader2 } from "lucide-react";

export interface ProviderRow {
  id: string;
  label: string;
  url: string;
  source: "api" | "tracked" | "none";
  balanceUsd: number | null;
  quota?: { left: number; limit: number } | null;
  asOf: string | null;
  lowUsd: number;
  level: "ok" | "warn" | "out" | "unknown";
  reason: string;
  autoReload: string;
  spend24hUsd: number;
  spend7dUsd: number;
}
export interface CostRow {
  provider: string;
  model: string;
  calls: number;
  failed: number;
  costUsd: number;
}
export interface StepRow {
  provider: string;
  step: string;
  calls: number;
  costUsd: number;
}
export interface FixedRow {
  label: string;
  usdPerMonth: number;
  note: string;
}

const CARD = "rounded-2xl border border-white/[0.07] bg-white/[0.025]";
const TH = "px-3 py-2.5 text-left text-xs font-medium text-gray-400";
const TD = "px-3 py-2.5 align-top text-sm";
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 100 ? 0 : 2 });
const usd4 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 });
const int = (n: number) => n.toLocaleString("en-US");
const TRACKED = ["openai", "gemini", "shotstack"];

function Level({ level }: { level: ProviderRow["level"] }) {
  if (level === "ok") return <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 size={14} /> OK</span>;
  if (level === "warn") return <span className="inline-flex items-center gap-1 text-red-300"><AlertTriangle size={14} /> Low</span>;
  if (level === "out") return <span className="inline-flex items-center gap-1 font-medium text-red-300"><AlertTriangle size={14} /> Out of credit</span>;
  return <span className="inline-flex items-center gap-1 text-gray-400"><CircleHelp size={14} /> Unknown</span>;
}

function SetBalance({ provider, onSaved }: { provider: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, balanceUsd: Number(value.replace(",", ".")) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save.");
      setOpen(false);
      setValue("");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-300 transition hover:bg-white/5 hover:text-white">
        Set balance
      </button>
    );
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="USD now"
          aria-label={`Current ${provider} balance in USD`}
          className="w-24 rounded-lg border border-white/10 bg-[var(--nv-field)] px-2 py-1 text-xs text-white outline-none focus:border-blue-400/60"
        />
        <button type="button" onClick={save} disabled={busy || !value.trim()} className="inline-flex items-center gap-1 rounded-lg bg-blue-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy && <Loader2 size={12} className="animate-spin" />}Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-white">Cancel</button>
      </div>
      {err && <p className="max-w-[16rem] text-right text-xs text-red-300">{err}</p>}
    </div>
  );
}

export default function ProviderCosts({
  providers,
  costs,
  steps,
  fixed,
  tableMissing,
  windowLabel,
  onChanged,
}: {
  providers: ProviderRow[];
  costs: CostRow[];
  steps: StepRow[];
  fixed: FixedRow[];
  tableMissing: boolean;
  windowLabel: string;
  onChanged: () => void;
}) {
  const total = costs.reduce((t, c) => t + c.costUsd, 0);
  const fixedTotal = fixed.reduce((t, f) => t + f.usdPerMonth, 0);
  const share = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : "–");

  // provider → total, for the summary column.
  const perProvider = new Map<string, number>();
  for (const c of costs) perProvider.set(c.provider, (perProvider.get(c.provider) ?? 0) + c.costUsd);
  const aliasCost = (id: string) => (id === "fal" ? (perProvider.get("fal") ?? 0) + (perProvider.get("kling") ?? 0) : (perProvider.get(id) ?? 0));

  return (
    <div className="space-y-4">
      {tableMissing && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          Balances for OpenAI, Gemini and Shotstack cannot be saved yet: run the <code>provider_balances</code> SQL from <code>supabase/README.md</code> once in Supabase.
        </p>
      )}

      <section aria-label="Provider balances" className={`${CARD} overflow-x-auto`}>
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-white/[0.07]">
              <th className={TH}>Provider</th>
              <th className={TH}>Status</th>
              <th className={`${TH} text-right`}>Balance</th>
              <th className={`${TH} text-right`}>Spent 24 h</th>
              <th className={`${TH} text-right`}>Spent 7 d</th>
              <th className={`${TH} text-right`}>Spent ({windowLabel})</th>
              <th className={TH}>Auto-reload</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id} className={`border-b border-white/[0.04] last:border-0 ${p.level === "warn" || p.level === "out" ? "bg-red-500/[0.06]" : ""}`}>
                <td className={TD}>
                  <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-white hover:underline">
                    {p.label}
                    <ExternalLink size={12} className="text-gray-500" />
                  </a>
                </td>
                <td className={TD}>
                  <Level level={p.level} />
                  <p className="mt-0.5 max-w-[17rem] text-xs text-gray-400">{p.reason}</p>
                </td>
                <td className={`${TD} text-right tabular-nums text-white`}>
                  {p.balanceUsd != null ? usd4(p.balanceUsd) : "–"}
                  <p className="text-xs font-normal text-gray-500">
                    {p.source === "api" ? "live" : p.source === "tracked" ? `est. since ${p.asOf ? new Date(p.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "?"}` : ""}
                  </p>
                </td>
                <td className={`${TD} text-right tabular-nums text-gray-200`}>{usd4(p.spend24hUsd)}</td>
                <td className={`${TD} text-right tabular-nums text-gray-200`}>{usd4(p.spend7dUsd)}</td>
                <td className={`${TD} text-right tabular-nums text-gray-200`}>{usd4(aliasCost(p.id))}</td>
                <td className={`${TD} max-w-[14rem] text-xs text-gray-400`}>{p.autoReload}</td>
                <td className={`${TD} text-right`}>{TRACKED.includes(p.id) && <SetBalance provider={p.id} onSaved={onChanged} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-gray-400">
        fal and ElevenLabs are read live. OpenAI, Gemini and Shotstack have no balance API: type the balance after each top-up and we subtract the logged usage. An auto-reload makes the
        estimate dip until you re-type it, so the warning level is set below the reload threshold. Any out-of-credit error from a provider turns it red on its own.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Spend by provider and model" className={`${CARD} overflow-x-auto`}>
          <h3 className="px-3 pt-3 text-sm font-medium text-white">Spend by model</h3>
          <table className="mt-1 w-full min-w-[460px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.07]">
                <th className={TH}>Provider · model</th>
                <th className={`${TH} text-right`}>Calls</th>
                <th className={`${TH} text-right`}>Failed</th>
                <th className={`${TH} text-right`}>Cost</th>
                <th className={`${TH} text-right`}>Share</th>
              </tr>
            </thead>
            <tbody>
              {costs.length === 0 && (
                <tr><td colSpan={5} className={`${TD} text-center text-gray-400`}>{`No calls logged in the ${windowLabel}.`}</td></tr>
              )}
              {costs.map((c) => (
                <tr key={`${c.provider}-${c.model}`} className="border-b border-white/[0.04] last:border-0">
                  <td className={`${TD} text-gray-200`}><span className="capitalize text-white">{c.provider}</span> · {c.model}</td>
                  <td className={`${TD} text-right tabular-nums text-gray-200`}>{int(c.calls)}</td>
                  <td className={`${TD} text-right tabular-nums ${c.failed ? "text-red-300" : "text-gray-500"}`}>{int(c.failed)}</td>
                  <td className={`${TD} text-right tabular-nums text-white`}>{usd4(c.costUsd)}</td>
                  <td className={`${TD} text-right tabular-nums text-gray-400`}>{share(c.costUsd)}</td>
                </tr>
              ))}
              {costs.length > 0 && (
                <tr className="border-t border-white/[0.1]">
                  <td className={`${TD} font-medium text-white`}>Total</td>
                  <td colSpan={2} />
                  <td className={`${TD} text-right font-medium tabular-nums text-white`}>{usd4(total)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section aria-label="Spend by provider and step" className={`${CARD} overflow-x-auto`}>
          <h3 className="px-3 pt-3 text-sm font-medium text-white">Where it went (by step)</h3>
          <table className="mt-1 w-full min-w-[420px] border-collapse">
            <thead>
              <tr className="border-b border-white/[0.07]">
                <th className={TH}>Provider · step</th>
                <th className={`${TH} text-right`}>Calls</th>
                <th className={`${TH} text-right`}>Cost</th>
                <th className={`${TH} text-right`}>Share</th>
              </tr>
            </thead>
            <tbody>
              {steps.length === 0 && (
                <tr><td colSpan={4} className={`${TD} text-center text-gray-400`}>{`No calls logged in the ${windowLabel}.`}</td></tr>
              )}
              {steps.map((s) => (
                <tr key={`${s.provider}-${s.step}`} className="border-b border-white/[0.04] last:border-0">
                  <td className={`${TD} text-gray-200`}><span className="capitalize text-white">{s.provider}</span> · {s.step}</td>
                  <td className={`${TD} text-right tabular-nums text-gray-200`}>{int(s.calls)}</td>
                  <td className={`${TD} text-right tabular-nums text-white`}>{usd4(s.costUsd)}</td>
                  <td className={`${TD} text-right tabular-nums text-gray-400`}>{share(s.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section aria-label="Fixed monthly costs" className={`${CARD} overflow-x-auto`}>
        <h3 className="px-3 pt-3 text-sm font-medium text-white">Fixed monthly costs</h3>
        <table className="mt-1 w-full min-w-[420px] border-collapse">
          <tbody>
            {fixed.map((f) => (
              <tr key={f.label} className="border-b border-white/[0.04]">
                <td className={`${TD} text-white`}>{f.label}</td>
                <td className={`${TD} text-gray-400`}>{f.note}</td>
                <td className={`${TD} text-right tabular-nums text-gray-200`}>{usd(f.usdPerMonth)}/mo</td>
              </tr>
            ))}
            <tr>
              <td className={`${TD} font-medium text-white`}>Total</td>
              <td />
              <td className={`${TD} text-right font-medium tabular-nums text-white`}>{usd(fixedTotal)}/mo</td>
            </tr>
          </tbody>
        </table>
      </section>
      <p className="text-xs text-gray-400">
        Usage figures are estimates (units used × list prices) for the {windowLabel}; Shotstack render minutes, ElevenLabs plan characters and R2 storage are not all in the usage log, so the provider invoices are the final word.
      </p>
    </div>
  );
}
