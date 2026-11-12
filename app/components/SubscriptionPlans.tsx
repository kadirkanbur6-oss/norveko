"use client";

// Weekly / monthly / yearly subscription cards (lib/subscriptions.ts), shared by
// the landing page (CTA → sign up) and /billing (CTA → Paddle checkout).

import Link from "next/link";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  availablePlans,
  monthlyCredits,
  monthlyPrice,
  PERIOD_LABEL,
  SUBSCRIPTION_PLANS,
  TIER_COPY,
  type SubPeriod,
  type SubscriptionPlan,
} from "@/lib/subscriptions";
import { JOB_COSTS } from "@/lib/plans";
import { PAYMENTS_LIVE } from "@/lib/payments";

const PERIODS: SubPeriod[] = ["week", "month", "year"];

function buys(p: SubscriptionPlan): string[] {
  const per = p.grantEvery === "week" ? "week" : "month";
  const v60 = Math.floor(p.credits / JOB_COSTS.video60);
  const v30 = Math.floor(p.credits / JOB_COSTS.video30);
  return [
    `${p.credits.toLocaleString("en-US")} credits every ${per}${p.period === "year" ? " (billed yearly)" : ""}`,
    v60 > 0
      ? `≈ ${v60} finished 60 s video${v60 === 1 ? "" : "s"} a ${per} (or ${v30} × 30 s)`
      : `≈ ${v30} finished 30 s video${v30 === 1 ? "" : "s"} a ${per}`,
    `≈ ${Math.floor(p.credits / JOB_COSTS.package60)} narrated content packages a ${per}`,
    "Fresh credits every period; unused plan credits don't roll over",
    "Renews automatically until you cancel",
    "Cancel anytime in Billing",
  ];
}

export default function SubscriptionPlans({
  mode,
  onSubscribe,
  busyPriceId,
  currentPlanId,
  disabled,
  comingSoon = false,
}: {
  mode: "landing" | "billing";
  onSubscribe?: (plan: SubscriptionPlan) => void;
  busyPriceId?: string | null;
  /** The user's active plan: its card says "Current plan", others are disabled. */
  currentPlanId?: string | null;
  disabled?: boolean;
  /** Payments not live yet: buttons read "Opening soon" and do nothing. */
  comingSoon?: boolean;
}) {
  const [period, setPeriod] = useState<SubPeriod>("month");
  const purchasable = new Set(availablePlans().map((p) => p.id));
  const plans = SUBSCRIPTION_PLANS.filter((p) => p.period === period);

  return (
    <div>
      <div role="tablist" aria-label="Billing period" className="mx-auto flex w-fit gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={period === p}
            onClick={() => setPeriod(p)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              period === p ? "bg-white text-[var(--nv-page)]" : "text-gray-300 hover:text-white"
            }`}
          >
            {PERIOD_LABEL[p].toggle}
            {PERIOD_LABEL[p].note && (
              <span className={`ml-1.5 rounded-full px-1.5 py-px text-[10px] ${period === p ? "bg-green-600 text-white" : "bg-green-500/15 text-green-300"}`}>
                {PERIOD_LABEL[p].note}
              </span>
            )}
          </button>
        ))}
      </div>

      {mode === "landing" && !PAYMENTS_LIVE && (
        <p className="mx-auto mt-4 max-w-xl text-center text-xs text-amber-200/90">
          Paid plans and packs are opening soon. Sign up now and make your first video with free credits.
        </p>
      )}
      <div className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const copy = TIER_COPY[plan.tier];
          const current = currentPlanId === plan.id;
          const canBuy = mode === "landing" || purchasable.has(plan.id);
          return (
            <div
              key={plan.id}
              className={`flex h-full flex-col rounded-2xl border p-5 ${
                copy.featured ? "border-blue-400/40 bg-blue-500/[0.06]" : "border-white/10 bg-white/[0.03]"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold text-white">{plan.name}</h3>
                  <p className="mt-1 text-sm text-gray-400">{copy.tagline}</p>
                </div>
                {copy.featured && (
                  <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-blue-200">
                    Best value
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-3xl font-black tracking-tight text-white">${plan.priceUsd}</span>
                <span className="pb-1 text-sm text-gray-500">/ {PERIOD_LABEL[plan.period].per}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {plan.period === "month"
                  ? `≈ ${monthlyCredits(plan).toLocaleString("en-US")} credits a month`
                  : `≈ $${monthlyPrice(plan)} a month · ${monthlyCredits(plan).toLocaleString("en-US")} credits a month`}
              </p>
              <ul className="mt-3 flex-1 space-y-1.5 text-xs text-gray-300">
                {buys(plan).map((line) => (
                  <li key={line} className="flex gap-1.5">
                    <Check size={13} className="mt-0.5 shrink-0 text-blue-300" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-gray-500">{copy.idealFor}</p>
              {mode === "landing" ? (
                <Link
                  href="/signup"
                  className={`mt-4 inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition hover:opacity-90 ${
                    copy.featured
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                      : "border border-white/10 bg-white/[0.03] text-gray-200 hover:border-white/20 hover:text-white"
                  }`}
                >
                  Start free
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => onSubscribe?.(plan)}
                  disabled={comingSoon || disabled || current || !canBuy || Boolean(currentPlanId) || busyPriceId === plan.paddlePriceId}
                  className={`mt-4 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
                    copy.featured
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                      : "border border-white/10 bg-white/[0.03] text-gray-200 hover:border-white/20 hover:text-white"
                  }`}
                >
                  {busyPriceId === plan.paddlePriceId && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  {current ? "Current plan" : comingSoon || !canBuy ? "Opening soon" : currentPlanId ? "You already have a plan" : `Subscribe: $${plan.priceUsd}/${PERIOD_LABEL[plan.period].per}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-xs text-gray-400">Prices are in USD, excluding tax. Any VAT or sales tax is added at checkout.</p>
    </div>
  );
}
