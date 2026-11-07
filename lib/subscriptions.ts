// lib/subscriptions.ts
// Subscription plans (1 Nov 2026, Kadir): two tiers × weekly / monthly / yearly.
// A plan adds credits to the balance every period; they are valid for that
// period only and don't roll over (3 Nov 2026, Kadir — see
// expireSubscriptionCredits). Pack credits never expire. Yearly plans are billed once a year but grant their credits MONTHLY
// (runSubscriptionGrants, hourly cron). One-time credit packs stay as top-ups.
//
// Paddle price IDs come from env (production) with sandbox fallbacks:
//   NEXT_PUBLIC_PADDLE_PRICE_CREATOR_WEEK / _MONTH / _YEAR
//   NEXT_PUBLIC_PADDLE_PRICE_PRO_WEEK / _MONTH / _YEAR
// (written out literally so Next.js inlines them in the browser bundle).
//
// Margin (Business-pack baseline $0.0111/credit at 40%): weekly and monthly plans
// keep ≥ 40% even when all their credits are spent. Yearly plans are the one
// deliberate exception (5 Nov 2026, Yağmur: "yearly can flex, it must be
// attractive"): "1 month free" (11 × monthly) ≈ 37–39%. Referral rewards never push a plan
// below its own margin (rewardFor caps them). Tests in captions.test.ts.
//
// 7 Nov 2026 (Yağmur: "between mid and high vs competitors"): prices raised ~50%
// (Creator $29/mo, Pro $69/mo, yearly = 11× monthly) while credits stay the same,
// so real margins are well above the 40% baseline. REVENUE_PER_CREDIT_USD in
// steps.ts is intentionally NOT changed (it only converts provider cost to credits).

export type SubTier = "creator" | "pro";
export type SubPeriod = "week" | "month" | "year";

export interface SubscriptionPlan {
  id: `${SubTier}-${SubPeriod}`;
  tier: SubTier;
  period: SubPeriod;
  name: string;
  priceUsd: number;
  /** Credits added at each grant. */
  credits: number;
  /** How often credits are granted (yearly plans grant monthly). */
  grantEvery: "week" | "month";
  paddlePriceId: string;
}

// Sandbox price IDs (created 1 Nov 2026 in the Paddle sandbox). Production sets env vars.
const SANDBOX: Record<SubscriptionPlan["id"], string> = {
  "creator-week": "pri_01m6c0bhxqphkfg1jn61adspbv",
  "creator-month": "pri_01m6c0cbdagd3gy5rbq33p1ymq",
  "creator-year": "pri_01m6c0d52pjj37bs29cr0apaz5",
  "pro-week": "pri_01m6c0ey3qfxnkfy71989z91kh",
  "pro-month": "pri_01m6c0fhwhrm5manpdzxhnr5pn",
  "pro-year": "pri_01m6c0g64gg45qcesbfmf31xjk",
};

const ENV: Record<SubscriptionPlan["id"], string | undefined> = {
  "creator-week": process.env.NEXT_PUBLIC_PADDLE_PRICE_CREATOR_WEEK,
  "creator-month": process.env.NEXT_PUBLIC_PADDLE_PRICE_CREATOR_MONTH,
  "creator-year": process.env.NEXT_PUBLIC_PADDLE_PRICE_CREATOR_YEAR,
  "pro-week": process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_WEEK,
  "pro-month": process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_MONTH,
  "pro-year": process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO_YEAR,
};

const priceId = (id: SubscriptionPlan["id"]) => (ENV[id] ?? "").trim() || SANDBOX[id];

const plan = (
  tier: SubTier,
  period: SubPeriod,
  priceUsd: number,
  credits: number
): SubscriptionPlan => {
  const id = `${tier}-${period}` as SubscriptionPlan["id"];
  return {
    id,
    tier,
    period,
    name: tier === "creator" ? "Creator" : "Pro",
    priceUsd,
    credits,
    grantEvery: period === "week" ? "week" : "month",
    paddlePriceId: priceId(id),
  };
};

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  plan("creator", "week", 9, 380),
  plan("creator", "month", 29, 1500),
  plan("creator", "year", 319, 1500),
  plan("pro", "week", 21, 1000),
  plan("pro", "month", 69, 4000),
  plan("pro", "year", 759, 4000),
];

export const TIER_COPY: Record<SubTier, { tagline: string; idealFor: string; featured: boolean }> = {
  creator: {
    tagline: "A steady publishing rhythm.",
    idealFor: "One channel posting a few Shorts every week.",
    featured: false,
  },
  pro: {
    tagline: "Daily output, more channels.",
    idealFor: "Daily Shorts, several channels or languages, long-form episodes.",
    featured: true,
  },
};

export const PERIOD_LABEL: Record<SubPeriod, { toggle: string; per: string; note?: string }> = {
  week: { toggle: "Weekly", per: "week" },
  month: { toggle: "Monthly", per: "month" },
  year: { toggle: "Yearly", per: "year", note: "1 month free" },
};

/** Plans that can be bought (a price ID is configured). */
export function availablePlans(): SubscriptionPlan[] {
  return SUBSCRIPTION_PLANS.filter((p) => p.paddlePriceId);
}

export function getSubscriptionPlanByPriceId(id: string | null | undefined): SubscriptionPlan | undefined {
  if (!id) return undefined;
  return SUBSCRIPTION_PLANS.find((p) => p.paddlePriceId === id);
}

export function getSubscriptionPlan(id: string | null | undefined): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id);
}

/** What a payment leaves after Paddle (5% + $0.50 per transaction). */
export function netRevenueUsd(priceUsd: number): number {
  return priceUsd * 0.95 - 0.5;
}

/** Net revenue behind ONE credit grant (a yearly payment covers 12 monthly grants). */
export function netPerGrantUsd(p: SubscriptionPlan): number {
  return netRevenueUsd(p.priceUsd) / (p.period === "year" ? 12 : 1);
}

/** Credits a plan adds per month on average (for "≈ N videos a month" copy). */
export function monthlyCredits(p: SubscriptionPlan): number {
  return p.grantEvery === "week" ? Math.round((p.credits * 52) / 12) : p.credits;
}

/** Effective monthly price (yearly plans: price / 12). */
export function monthlyPrice(p: SubscriptionPlan): number {
  if (p.period === "year") return Math.round((p.priceUsd / 12) * 100) / 100;
  if (p.period === "week") return Math.round(((p.priceUsd * 52) / 12) * 100) / 100;
  return p.priceUsd;
}

/** Next grant time for a yearly plan: one month after `from` (UTC, clamped to month length). */
export function addOneMonth(from: Date): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
