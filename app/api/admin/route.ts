// app/api/admin/route.ts
// Read-only data for the owner's admin panel (/admin): accounts, balances,
// generations, payments, provider costs and the admin action log. Everything
// comes straight from Supabase with the service role; nothing here changes
// data — actions live in ./actions/route.ts.
//
// Access: lib/admin.ts (ADMIN_USER_IDS). Everyone else gets a 404.

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { adminDb } from "@/lib/api-keys";
import { estimateCostUsd, type UsageProvider } from "@/lib/pipeline/usage";
import { listAccess } from "@/lib/access";
import { loadProviders, FIXED_COSTS } from "@/lib/admin-providers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Row = Record<string, unknown>;

const PAGE = 1000; // Supabase returns at most 1000 rows per request.
const MAX_PAGES = 20;
const JOB_LIST = 300;

/** Read every row of a query, page by page. A failing table yields []. */
async function all(label: string, page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, errors: string[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(i * PAGE, (i + 1) * PAGE - 1);
    if (error) {
      errors.push(`${label}: ${error.message}`);
      break;
    }
    const batch = (data as Row[] | null) ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function allUsers(db: SupabaseClient, errors: string[]): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) {
      errors.push(`users: ${error.message}`);
      break;
    }
    users.push(...data.users);
    if (data.users.length < PAGE) break;
  }
  return users;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const day = (iso: string) => iso.slice(0, 10);

/** lib/pipeline/rerender.ts retryFailedRender: render failed after the visuals were made, ≤ 2 tries. */
function canRetryRender(j: Row): boolean {
  if (j.status !== "failed") return false;
  const steps = (j.steps ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return steps.render?.status === "failed" && steps.video?.status === "completed" && (Number(steps.render?.retries) || 0) < 2;
}

function jobKind(options: unknown): string {
  const o = (options ?? {}) as Row;
  if (o.short) return "Short";
  if (o.translate) return "Translation";
  if (o.trialVideo) return "Free trial video";
  if (o.series) return "Series episode";
  if (o.fullVideo) return "Full video";
  return "Content package";
}

export async function GET(req: NextRequest) {
  const { user } = await requireUser();
  if (!user || !isAdmin(user)) {
    return NextResponse.json({ success: false, error: "Not found." }, { status: 404 });
  }

  const requested = Number(req.nextUrl.searchParams.get("days"));
  const days = [7, 30, 90].includes(requested) ? requested : 30;
  const now = Date.now();
  const since = new Date(now - days * 86400_000).toISOString();
  const errors: string[] = [];
  const db = adminDb();

  const [users, balances, purchases, subscriptions, jobs, skits, swaps, usage, transactions, jobCounts, access, adminLog] = await Promise.all([
    allUsers(db, errors),
    all("user_credits", (a, b) => db.from("user_credits").select("user_id, credits").range(a, b), errors),
    all("credit_purchases", (a, b) => db.from("credit_purchases").select("*").range(a, b), errors),
    all("subscriptions", (a, b) => db.from("subscriptions").select("paddle_subscription_id, user_id, plan_id, status, current_period_end, cancel_at, created_at").range(a, b), errors),
    all(
      "pipeline_jobs",
      (a, b) =>
        db
          .from("pipeline_jobs")
          .select("id, user_id, idea, status, current_step, error, duration, output_language, created_at, credits_charged, credits_refunded, options, steps")
          .order("created_at", { ascending: false })
          .range(a, Math.min(b, JOB_LIST - 1)),
      errors
    ),
    all("skit_jobs", (a, b) => db.from("skit_jobs").select("id, user_id, status, phase, script, credits, refunded, error, created_at").neq("status", "draft").order("created_at", { ascending: false }).range(a, Math.min(b, JOB_LIST - 1)), errors),
    all("swap_jobs", (a, b) => db.from("swap_jobs").select("id, user_id, kind, status, phase, character_name, credits, refunded, error, created_at").order("created_at", { ascending: false }).range(a, Math.min(b, JOB_LIST - 1)), errors),
    all("provider_usage", (a, b) => db.from("provider_usage").select("created_at, user_id, step, provider, model, quantity, estimated_cost_usd, status").gte("created_at", since).order("created_at", { ascending: false }).range(a, b), errors),
    all("credit_transactions", (a, b) => db.from("credit_transactions").select("user_id, type, amount, created_at").gte("created_at", since).order("created_at", { ascending: false }).range(a, b), errors),
    // Narrated videos, skits, talking characters and swaps all count.
    Promise.all(
      (["running", "completed", "failed"] as const).map(async (status) => {
        const counts = await Promise.all(
          (["pipeline_jobs", "skit_jobs", "swap_jobs"] as const).map(async (table) => {
            const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq("status", status);
            if (error) errors.push(`${table} count: ${error.message}`);
            return count ?? 0;
          })
        );
        return [status, counts.reduce((t, c) => t + c, 0)] as const;
      })
    ),
    listAccess(db),
    all("admin_actions", (a, b) => db.from("admin_actions").select("id, admin_id, action, target_user_id, target_id, amount, note, detail, created_at").order("created_at", { ascending: false }).range(a, Math.min(b, 199)), []),
  ]);

  // Rows logged before a model was in the price list were stored as $0:
  // price them now from the units they used.
  for (const u of usage) {
    if (u.status === "ok" && num(u.estimated_cost_usd) === 0 && num(u.quantity) > 0) {
      u.estimated_cost_usd = estimateCostUsd(str(u.provider) as UsageProvider, str(u.model), { quantity: num(u.quantity) });
    }
  }

  // ---- per-user roll-ups -------------------------------------------------
  const email = new Map(users.map((u) => [u.id, u.email ?? ""]));
  const credits = new Map(balances.map((r) => [str(r.user_id), num(r.credits)]));
  const paid = new Map<string, number>();
  for (const p of purchases) {
    if (p.status !== "completed") continue;
    paid.set(str(p.user_id), (paid.get(str(p.user_id)) ?? 0) + num(p.amount_usd));
  }
  const plan = new Map<string, string>();
  for (const s of subscriptions) {
    if (s.status === "active" || s.status === "trialing") plan.set(str(s.user_id), str(s.plan_id));
  }
  const jobsInWindow = new Map<string, number>();
  const spent = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== "spend") continue;
    const id = str(t.user_id);
    jobsInWindow.set(id, (jobsInWindow.get(id) ?? 0) + 1);
    spent.set(id, (spent.get(id) ?? 0) + Math.abs(num(t.amount)));
  }
  const costByUser = new Map<string, number>();
  for (const u of usage) costByUser.set(str(u.user_id), (costByUser.get(str(u.user_id)) ?? 0) + num(u.estimated_cost_usd));

  const envBeta = (process.env.BETA_USER_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const envFullVideo = (process.env.FULL_VIDEO_BETA_USER_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const grants = new Map(access.map((a) => [a.user_id, a]));

  const userRows = users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      provider: str(u.app_metadata?.provider) || "email",
      verified: Boolean(u.email_confirmed_at),
      admin: isAdmin(u),
      // Supabase sets banned_until far in the future for a suspended account.
      suspended: Boolean((u as User & { banned_until?: string | null }).banned_until && Date.parse((u as User & { banned_until?: string }).banned_until as string) > now),
      access: {
        beta: Boolean(grants.get(u.id)?.beta),
        fullVideo: Boolean(grants.get(u.id)?.full_video),
        note: grants.get(u.id)?.note ?? null,
        envBeta: envBeta.includes(u.id),
        envFullVideo: envFullVideo.includes(u.id),
      },
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      credits: credits.get(u.id) ?? 0,
      paidUsd: paid.get(u.id) ?? 0,
      plan: plan.get(u.id) ?? null,
      spends: jobsInWindow.get(u.id) ?? 0,
      creditsSpent: spent.get(u.id) ?? 0,
      costUsd: costByUser.get(u.id) ?? 0,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // ---- generations (all three job tables, newest first) -------------------
  const generations = [
    ...jobs.map((j) => ({
      id: str(j.id),
      table: "pipeline" as const,
      canRetryRender: canRetryRender(j),
      kind: jobKind(j.options),
      userId: str(j.user_id),
      title: str(j.idea).slice(0, 140),
      status: str(j.status),
      step: str(j.current_step),
      detail: [str(j.duration), str(j.output_language)].filter(Boolean).join(" · "),
      credits: num(j.credits_charged),
      refunded: num(j.credits_refunded),
      error: str(j.error).slice(0, 300) || null,
      createdAt: str(j.created_at),
    })),
    ...skits.map((j) => ({
      id: str(j.id),
      table: "skit" as const,
      canRetryRender: false,
      kind: "Skit",
      userId: str(j.user_id),
      title: str(j.script).slice(0, 140),
      status: str(j.status),
      step: str(j.phase),
      detail: "",
      credits: num(j.credits),
      refunded: j.refunded ? num(j.credits) : 0,
      error: str(j.error).slice(0, 300) || null,
      createdAt: str(j.created_at),
    })),
    ...swaps.map((j) => ({
      id: str(j.id),
      table: "swap" as const,
      canRetryRender: false,
      kind: j.kind === "talk" ? "Talking character" : "Character swap",
      userId: str(j.user_id),
      title: str(j.character_name).slice(0, 140),
      status: str(j.status),
      step: str(j.phase),
      detail: "",
      credits: num(j.credits),
      refunded: j.refunded ? num(j.credits) : 0,
      error: str(j.error).slice(0, 300) || null,
      createdAt: str(j.created_at),
    })),
  ]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, JOB_LIST)
    .map((g) => ({ ...g, email: email.get(g.userId) ?? "" }));

  // ---- payments -----------------------------------------------------------
  const payments = purchases
    .map((p) => ({
      id: str(p.paddle_transaction_id) || str(p.id),
      userId: str(p.user_id),
      email: email.get(str(p.user_id)) ?? "",
      packageId: str(p.package_id),
      credits: num(p.credits),
      amountUsd: num(p.amount_usd),
      status: str(p.status),
      createdAt: str(p.created_at),
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // ---- provider costs -----------------------------------------------------
  const byProvider = new Map<string, { provider: string; model: string; calls: number; failed: number; costUsd: number }>();
  const costByDay = new Map<string, number>();
  for (const u of usage) {
    const key = `${str(u.provider)}|${str(u.model)}`;
    const row = byProvider.get(key) ?? { provider: str(u.provider), model: str(u.model), calls: 0, failed: 0, costUsd: 0 };
    row.calls += 1;
    if (u.status === "failed") row.failed += 1;
    row.costUsd += num(u.estimated_cost_usd);
    byProvider.set(key, row);
    const d = day(str(u.created_at));
    costByDay.set(d, (costByDay.get(d) ?? 0) + num(u.estimated_cost_usd));
  }

  // Where the money went: provider × step (voiceover, thumbnail, video, skit …).
  const byStep = new Map<string, { provider: string; step: string; calls: number; costUsd: number }>();
  for (const u of usage) {
    const key = `${str(u.provider)}|${str(u.step)}`;
    const row = byStep.get(key) ?? { provider: str(u.provider), step: str(u.step) || "other", calls: 0, costUsd: 0 };
    row.calls += 1;
    row.costUsd += num(u.estimated_cost_usd);
    byStep.set(key, row);
  }
  const providerStatus = await loadProviders(db, now).catch((err) => {
    errors.push(`providers: ${err instanceof Error ? err.message : String(err)}`);
    return { providers: [], balancesTableMissing: false, errors: [] as string[] };
  });
  errors.push(...providerStatus.errors);

  // ---- daily series for the window ---------------------------------------
  const signupsByDay = new Map<string, number>();
  for (const u of users) if (u.created_at >= since) signupsByDay.set(day(u.created_at), (signupsByDay.get(day(u.created_at)) ?? 0) + 1);
  const revenueByDay = new Map<string, number>();
  for (const p of payments) {
    if (p.status === "completed" && p.createdAt >= since) revenueByDay.set(day(p.createdAt), (revenueByDay.get(day(p.createdAt)) ?? 0) + p.amountUsd);
  }
  const daily = Array.from({ length: days }, (_, i) => {
    const d = day(new Date(now - (days - 1 - i) * 86400_000).toISOString());
    return { day: d, signups: signupsByDay.get(d) ?? 0, revenueUsd: revenueByDay.get(d) ?? 0, costUsd: costByDay.get(d) ?? 0 };
  });

  const completed = payments.filter((p) => p.status === "completed");
  const inWindow = completed.filter((p) => p.createdAt >= since);
  const sum = (list: Array<{ amountUsd: number }>) => list.reduce((t, p) => t + p.amountUsd, 0);

  // ---- break-even for the calendar month (8 Nov 2026, Yağmur) -------------
  // profit = revenue − provider cost − fixed costs. Pricing targets a 40% gross
  // margin (provider cost ≈ 60% of revenue), so the month breaks even once
  // gross revenue reaches fixed / 0.40. Revenue is gross (Paddle fees are not
  // in the purchase rows). Provider cost is read for the month separately,
  // because `usage` only covers the selected window.
  const monthStartDate = new Date(now);
  monthStartDate.setUTCDate(1);
  monthStartDate.setUTCHours(0, 0, 0, 0);
  const monthStart = monthStartDate.toISOString();
  const monthCostRows = await all(
    "provider_usage (month)",
    (a, b) => db.from("provider_usage").select("estimated_cost_usd").gte("created_at", monthStart).range(a, b),
    errors
  );
  const monthCostUsd = monthCostRows.reduce((t, u) => t + num(u.estimated_cost_usd), 0);
  const monthRevenueUsd = sum(completed.filter((p) => p.createdAt >= monthStart));
  const fixedUsd = FIXED_COSTS.reduce((t, c) => t + c.usdPerMonth, 0);
  const daysInMonth = new Date(monthStartDate.getUTCFullYear(), monthStartDate.getUTCMonth() + 1, 0).getUTCDate();
  const dayOfMonth = new Date(now).getUTCDate();
  const month = {
    start: monthStart,
    dayOfMonth,
    daysInMonth,
    revenueUsd: monthRevenueUsd,
    costUsd: monthCostUsd,
    fixedUsd,
    targetMargin: 0.4,
    breakEvenRevenueUsd: fixedUsd / 0.4,
    // Net so far, charging the whole month's fixed costs up front.
    netUsd: monthRevenueUsd - monthCostUsd - fixedUsd,
    // Straight-line projection of this month's revenue and cost to month end.
    projectedRevenueUsd: (monthRevenueUsd / dayOfMonth) * daysInMonth,
    projectedCostUsd: (monthCostUsd / dayOfMonth) * daysInMonth,
  };
  const counts = Object.fromEntries(jobCounts);

  // fal.ai balance (lip-sync, swaps, image→video clips all run there). Warn at ≤ 20 % of the
  // usual top-up (FAL_TOPUP_USD, default 50) — 5 Nov 2026, Kadir, after the balance hit −$2.40.
  let fal: { balanceUsd: number; topupUsd: number; low: boolean } | null = null;
  // Reading the balance needs a key with billing:usage:read (FAL_BILLING_KEY); model keys lack it.
  const falKey = process.env.FAL_BILLING_KEY || process.env.FAL_KEY;
  if (falKey) {
    try {
      const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
        headers: { Authorization: `Key ${falKey}` },
        cache: "no-store",
      });
      const j = (await res.json()) as { credits?: { current_balance?: number } };
      const balanceUsd = Number(j.credits?.current_balance);
      if (res.ok && Number.isFinite(balanceUsd)) {
        const topupUsd = Number(process.env.FAL_TOPUP_USD) || 50;
        fal = { balanceUsd, topupUsd, low: balanceUsd <= topupUsd * 0.2 };
      } else errors.push(`fal balance: HTTP ${res.status}${res.status === 403 ? ". Add FAL_BILLING_KEY (a fal key with the BILLING / READONLY preset)" : ""}`);
    } catch (err) {
      errors.push(`fal balance: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // Gemini (scene images, thumbnails, narration, vision checks) runs on prepaid credit. Google has
  // no API for that balance, so we watch for its "out of credit" errors in the last 24 h instead:
  // any job (or step inside one) that hit 402 / prepayment / RESOURCE_EXHAUSTED (7 Nov 2026, Yağmur).
  const dayAgo = new Date(now - 86400_000).toISOString();
  const OUT_OF_CREDIT = /prepayment credits are depleted|prepay|Gemini[^"]{0,40}\(402\)|RESOURCE_EXHAUSTED/i;
  let geminiHits = 0;
  let geminiLastAt = "";
  for (const row of [...jobs, ...skits, ...swaps]) {
    const at = str(row.created_at);
    if (at < dayAgo) continue;
    const text = `${str(row.error)} ${JSON.stringify((row as Record<string, unknown>).steps ?? "")}`;
    if (!OUT_OF_CREDIT.test(text)) continue;
    geminiHits++;
    if (at > geminiLastAt) geminiLastAt = at;
  }
  const gemini = geminiHits ? { outOfCredit: true, jobs: geminiHits, lastAt: geminiLastAt } : { outOfCredit: false, jobs: 0, lastAt: null };
  const geminiSpend24h = usage
    .filter((u) => str(u.provider) === "gemini" && str(u.created_at) >= dayAgo)
    .reduce((t, u) => t + num(u.estimated_cost_usd), 0);

  const weekAgo = new Date(now - 7 * 86400_000).toISOString();

  // Stock slots that found nothing and became AI stills at our cost (priced for ≤ 20 %,
  // STOCK_FALLBACK_SHARE in steps.ts): the share over the window's finished videos.
  let stockSlots = 0;
  let stockFallbacks = 0;
  for (const j of jobs) {
    if (str(j.created_at) < since) continue;
    const slots = ((j.steps as Record<string, Record<string, unknown>> | null)?.video?.slots ?? []) as Array<Record<string, unknown>>;
    for (const sl of slots) {
      if (sl.stockFallback) stockFallbacks++;
      if (sl.kind === "stock" || sl.kind === "archive" || sl.stockFallback) stockSlots++;
    }
  }

  return NextResponse.json({
    success: true,
    days,
    generatedAt: new Date(now).toISOString(),
    errors,
    overview: {
      users: users.length,
      newUsers: users.filter((u) => u.created_at >= since).length,
      activeUsers: users.filter((u) => (u.last_sign_in_at ?? "") >= weekAgo).length,
      payingUsers: paid.size,
      activeSubscriptions: plan.size,
      revenueUsd: sum(completed),
      revenueWindowUsd: sum(inWindow),
      refundedUsd: sum(payments.filter((p) => p.status === "refunded")),
      costWindowUsd: usage.reduce((t, u) => t + num(u.estimated_cost_usd), 0),
      creditsOutstanding: balances.reduce((t, r) => t + num(r.credits), 0),
      creditsSpentWindow: Array.from(spent.values()).reduce((t, v) => t + v, 0),
      jobs: { running: counts.running ?? 0, completed: counts.completed ?? 0, failed: counts.failed ?? 0 },
      failedWindow: generations.filter((g) => g.status === "failed" && g.createdAt >= since).length,
      fal,
      gemini: { ...gemini, spend24hUsd: geminiSpend24h },
      stock: { slots: stockSlots, fallbacks: stockFallbacks, share: stockSlots ? stockFallbacks / stockSlots : 0 },
      month,
      generationOpen: process.env.GENERATION_ENABLED !== "false",
      fullVideoOpen: process.env.FULL_VIDEO_ENABLED === "true",
    },
    daily,
    users: userRows,
    generations,
    payments,
    costs: Array.from(byProvider.values()).sort((a, b) => b.costUsd - a.costUsd),
    costSteps: Array.from(byStep.values()).sort((a, b) => b.costUsd - a.costUsd),
    providers: providerStatus.providers,
    balancesTableMissing: providerStatus.balancesTableMissing,
    fixedCosts: FIXED_COSTS,
    adminLog: adminLog.map((a) => ({
      id: str(a.id),
      adminEmail: email.get(str(a.admin_id)) ?? str(a.admin_id).slice(0, 8),
      action: str(a.action),
      targetEmail: a.target_user_id ? (email.get(str(a.target_user_id)) ?? str(a.target_user_id).slice(0, 8)) : "",
      targetId: a.target_id ? str(a.target_id) : "",
      amount: a.amount == null ? null : num(a.amount),
      note: a.note ? str(a.note) : "",
      detail: (a.detail as Record<string, unknown> | null) ?? null,
      createdAt: str(a.created_at),
    })),
  });
}
