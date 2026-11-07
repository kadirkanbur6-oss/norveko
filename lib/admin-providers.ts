// lib/admin-providers.ts
// Provider balances + spend for the admin panel (/admin → Provider costs) and the red
// warning next to "Admin" in the sidebar (/api/admin/alerts). Server-only.
//
// Where each balance comes from:
//   fal         live from fal's billing API (key needs billing:usage:read, FAL_BILLING_KEY)
//   elevenlabs  live from /v1/user/subscription (characters left this period), if the key may read it
//   openai, gemini, shotstack
//               no balance API → the owner types the balance after a top-up (table
//               `provider_balances`, SQL in supabase/README.md); we subtract the estimated
//               cost logged in `provider_usage` since then. Auto-reload makes the estimate
//               dip below the reload threshold for a while, so "low" is set under that.
//   all         additionally: "out of credit" errors seen in the last 24 h (provider_usage
//               failures and failed jobs) turn the provider red whatever the numbers say.
//
// Estimates are only as good as PRICE_LIST (lib/pipeline/usage.ts); the provider's own
// dashboard is the final word.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProviderId = "fal" | "openai" | "gemini" | "shotstack" | "elevenlabs" | "r2";
export type Level = "ok" | "warn" | "out" | "unknown";

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  url: string;
  source: "api" | "tracked" | "none";
  /** Money left (USD), or null when we cannot know it. */
  balanceUsd: number | null;
  /** ElevenLabs: characters left / limit. */
  quota?: { left: number; limit: number } | null;
  /** When the tracked balance was last typed in. */
  asOf: string | null;
  lowUsd: number;
  level: Level;
  reason: string;
  autoReload: string;
  spend24hUsd: number;
  spend7dUsd: number;
}

export interface FixedCost {
  label: string;
  usdPerMonth: number;
  note: string;
}

/** Subscriptions we pay every month whatever the usage (CLAUDE.md, 7 Nov 2026). */
export const FIXED_COSTS: FixedCost[] = [
  { label: "Vercel Pro", usdPerMonth: 20, note: "hosting + cron" },
  { label: "Supabase Pro", usdPerMonth: 25, note: "database, auth, small files" },
  { label: "ElevenLabs Creator", usdPerMonth: 22, note: "voices, 30 custom voice slots" },
  { label: "Domain", usdPerMonth: 1, note: "norveko.app, approx." },
  { label: "Sentry Free", usdPerMonth: 0, note: "error tracking" },
  { label: "Cloudflare R2", usdPerMonth: 0, note: "10 GB free; about 2.7 GB used" },
];

const META: Record<ProviderId, { label: string; url: string; lowUsd: number; autoReload: string; pattern: RegExp }> = {
  fal: {
    label: "fal.ai",
    url: "https://fal.ai/dashboard/usage-billing/credits",
    lowUsd: 10,
    autoReload: "Auto top-up: under $10 adds $20",
    pattern: /exhausted balance|user is locked|insufficient (balance|funds|credits)/i,
  },
  openai: {
    label: "OpenAI",
    url: "https://platform.openai.com/settings/organization/billing/overview",
    lowUsd: 2,
    autoReload: "Auto-reload: under $5 tops up to $25 ($100/month cap)",
    pattern: /insufficient_quota|exceeded your current quota|billing_hard_limit|billing hard limit/i,
  },
  gemini: {
    label: "Gemini (Google AI Studio)",
    url: "https://aistudio.google.com/billing",
    lowUsd: 4,
    autoReload: "Auto-reload: under 250 TRY adds 1,000 TRY (5,000 TRY/month cap)",
    pattern: /prepayment credits are depleted|prepay|Gemini[^"]{0,40}\(402\)|RESOURCE_EXHAUSTED/i,
  },
  shotstack: {
    label: "Shotstack",
    url: "https://dashboard.shotstack.io/",
    lowUsd: 2,
    autoReload: "Auto top-up: under 20 min adds 150 min ($30); no spend cap",
    pattern: /insufficient (credits|funds)|out of credits|payment required|\(402\)/i,
  },
  elevenlabs: {
    label: "ElevenLabs",
    url: "https://elevenlabs.io/app/subscription",
    lowUsd: 0,
    autoReload: "Creator plan: monthly characters, no balance",
    pattern: /quota_exceeded|exceeds your quota|insufficient credits|character_limit/i,
  },
  r2: {
    label: "Cloudflare R2",
    url: "https://dash.cloudflare.com/",
    lowUsd: 0,
    autoReload: "Free tier 10 GB, then $0.015/GB-month",
    pattern: /$^/,
  },
};
const ORDER: ProviderId[] = ["fal", "gemini", "openai", "shotstack", "elevenlabs", "r2"];
/** provider_usage.provider values that belong to each card. */
const USAGE_ALIASES: Record<string, ProviderId> = { fal: "fal", openai: "openai", gemini: "gemini", shotstack: "shotstack", elevenlabs: "elevenlabs", kling: "fal" };

export const TRACKED: ProviderId[] = ["openai", "gemini", "shotstack"];

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function pageAll(build: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string, errors: string[], maxPages = 10): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await build(i * 1000, i * 1000 + 999);
    if (error) {
      errors.push(`${label}: ${error.message}`);
      break;
    }
    const batch = (data as Row[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

async function falBalance(errors: string[]): Promise<number | null> {
  const key = process.env.FAL_BILLING_KEY || process.env.FAL_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", { headers: { Authorization: `Key ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const j = (await res.json()) as { credits?: { current_balance?: number } };
    const v = Number(j.credits?.current_balance);
    if (res.ok && Number.isFinite(v)) return v;
    errors.push(`fal balance: HTTP ${res.status}`);
  } catch (err) {
    errors.push(`fal balance: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

async function elevenQuota(): Promise<{ left: number; limit: number } | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { character_count?: number; character_limit?: number };
    const limit = Number(j.character_limit);
    const used = Number(j.character_count);
    if (!Number.isFinite(limit) || !Number.isFinite(used) || limit <= 0) return null;
    return { left: Math.max(0, limit - used), limit };
  } catch {
    return null;
  }
}

export interface ProviderOverview {
  providers: ProviderStatus[];
  /** True when the provider_balances table is missing (SQL not run yet). */
  balancesTableMissing: boolean;
  errors: string[];
}

export async function loadProviders(db: SupabaseClient, now = Date.now()): Promise<ProviderOverview> {
  const errors: string[] = [];
  const dayAgo = new Date(now - 86400_000).toISOString();
  const weekAgo = new Date(now - 7 * 86400_000).toISOString();

  const balancesRes = await db.from("provider_balances").select("provider, balance_usd, low_usd, as_of");
  const balancesTableMissing = !!balancesRes.error;
  if (balancesRes.error && !/does not exist|schema cache|relation/i.test(balancesRes.error.message)) errors.push(`provider_balances: ${balancesRes.error.message}`);
  const tracked = new Map<string, { balance: number; low: number | null; asOf: string }>();
  for (const r of (balancesRes.data as Row[] | null) ?? []) tracked.set(str(r.provider), { balance: num(r.balance_usd), low: r.low_usd == null ? null : num(r.low_usd), asOf: str(r.as_of) });

  // Spend since the oldest of: 7 days ago, any tracked balance's timestamp.
  let from = weekAgo;
  for (const t of tracked.values()) if (t.asOf && t.asOf < from) from = t.asOf;

  const [usage, fal, quota, failedJobs] = await Promise.all([
    pageAll((a, b) => db.from("provider_usage").select("created_at, provider, status, estimated_cost_usd, error").gte("created_at", from).range(a, b), "provider_usage", errors),
    falBalance(errors),
    elevenQuota(),
    // Failed jobs of the last 24 h: their error text names the provider that ran dry.
    Promise.all(
      ["pipeline_jobs", "skit_jobs", "swap_jobs"].map(async (t) => {
        const { data } = await db.from(t).select("error, created_at").eq("status", "failed").gte("created_at", dayAgo).limit(200);
        return ((data as Row[] | null) ?? []).map((r) => ({ at: str(r.created_at), text: str(r.error) }));
      })
    ),
  ]);

  const jobErrors = failedJobs.flat();
  const providers: ProviderStatus[] = ORDER.map((id) => {
    const meta = META[id];
    const mine = usage.filter((u) => USAGE_ALIASES[str(u.provider)] === id);
    const cost = (rows: Row[]) => rows.reduce((t, u) => t + num(u.estimated_cost_usd), 0);
    const spend24hUsd = cost(mine.filter((u) => str(u.created_at) >= dayAgo));
    const spend7dUsd = cost(mine.filter((u) => str(u.created_at) >= weekAgo));

    const t = tracked.get(id);
    const lowUsd = t?.low ?? meta.lowUsd;
    let source: ProviderStatus["source"] = "none";
    let balanceUsd: number | null = null;
    let asOf: string | null = null;
    if (id === "fal" && fal != null) {
      source = "api";
      balanceUsd = fal;
    } else if (t && TRACKED.includes(id)) {
      source = "tracked";
      asOf = t.asOf || null;
      balanceUsd = t.balance - cost(mine.filter((u) => str(u.created_at) >= (t.asOf || weekAgo)));
    }

    // Typing in a balance after a top-up acknowledges older out-of-credit errors.
    const since = t?.asOf && t.asOf > dayAgo ? t.asOf : dayAgo;
    const ranDry =
      mine.some((u) => str(u.status) === "failed" && str(u.created_at) >= since && meta.pattern.test(str(u.error))) ||
      (id !== "r2" && jobErrors.some((e) => e.at >= since && meta.pattern.test(e.text)));

    let level: Level = "unknown";
    let reason = "";
    if (ranDry) {
      level = "out";
      reason = "Out-of-credit errors in the last 24 hours";
    } else if (id === "elevenlabs") {
      if (quota) {
        const share = quota.left / quota.limit;
        level = share < 0.15 ? "warn" : "ok";
        reason = `${quota.left.toLocaleString("en-US")} of ${quota.limit.toLocaleString("en-US")} characters left this period`;
      } else reason = "Quota not readable with this key";
    } else if (id === "r2") {
      level = "ok";
      reason = "Free tier; check storage in Cloudflare now and then";
    } else if (balanceUsd != null) {
      if (balanceUsd <= 0) {
        level = "out";
        reason = "Balance at or below zero";
      } else if (balanceUsd <= lowUsd) {
        level = "warn";
        reason = `Balance under ${lowUsd.toLocaleString("en-US", { style: "currency", currency: "USD" })}`;
      } else {
        level = "ok";
        reason = source === "api" ? "Live balance from the provider" : "Estimated from your last typed balance minus logged usage";
      }
    } else if (TRACKED.includes(id)) {
      reason = "Type in the balance once so we can track it";
    } else reason = "No balance available";

    return {
      id,
      label: meta.label,
      url: meta.url,
      source,
      balanceUsd,
      quota: id === "elevenlabs" ? quota : undefined,
      asOf,
      lowUsd,
      level,
      reason,
      autoReload: meta.autoReload,
      spend24hUsd,
      spend7dUsd,
    };
  });

  return { providers, balancesTableMissing, errors };
}

export function alertsOf(providers: ProviderStatus[]) {
  return providers.filter((p) => p.level === "warn" || p.level === "out").map((p) => ({ id: p.id, label: p.label, level: p.level, reason: p.reason }));
}
