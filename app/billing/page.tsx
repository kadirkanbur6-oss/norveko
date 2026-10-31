"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Coins,
  CreditCard,
  Gift,
  Loader2,
  RotateCcw,
  Sparkles,
  Stamp,
  CheckCircle2,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { FREE_TRIAL_RULES, JOB_COSTS, PAID_INCLUDES, planDetails } from "@/lib/plans";
import { usePaddle } from "@/lib/usePaddle";
import {
  RESEARCH_CREDITS,
  SUBTITLES_CREDITS_PER_MIN,
  THUMBNAIL_CREDITS,
  VOICE_CREDITS_PER_MIN,
  scriptCredits,
  totalPipelineCredits,
} from "@/lib/pipeline/steps";
import { supabase } from "../lib/supabase";

interface Transaction {
  id: string;
  type: string;
  amount: number;
  reason: string | null;
  created_at: string;
}

const PIPELINE_COST = totalPipelineCredits(false);
const PIPELINE_COST_WITH_VOICEOVER = totalPipelineCredits(true);
const PIPELINE_COST_WITH_SUBTITLES = totalPipelineCredits({ voiceover: true, subtitles: true });

const PLANS = planDetails();

const COST_ROWS: Array<[string, string]> = [
  ["60 s script package + thumbnail", `${scriptCredits("60 seconds") + THUMBNAIL_CREDITS} credits`],
  ["Web research with sources", `+${RESEARCH_CREDITS}`],
  ["Norveko narrator", `+${VOICE_CREDITS_PER_MIN.gemini} / min`],
  ["ElevenLabs voice artist", `+${VOICE_CREDITS_PER_MIN.elevenlabs} / min`],
  ["Word-timed subtitles", `+${SUBTITLES_CREDITS_PER_MIN} / min`],
  ["Finished 30 s video (beta)", `${JOB_COSTS.video30} credits`],
  ["Finished 60 s video (beta)", `${JOB_COSTS.video60} credits`],
];

export default function BillingPage() {
  const [credits, setCredits] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [purchaseNotice, setPurchaseNotice] = useState("");
  const [freeTrial, setFreeTrial] = useState(false);
  // Latest balance for the Paddle callback (which is created once).
  const creditsRef = useRef<number | null>(null);

  const loadCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/credits", { cache: "no-store" });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to load billing data.");
      }

      setCredits(data.credits);
      setFreeTrial(data.freeTrial === true);
      creditsRef.current = data.credits;
      setTransactions(data.transactions);
      return data.credits as number;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // After a successful checkout the webhook grants credits asynchronously,
  // so poll the balance for a short while until it changes.
  const paddle = usePaddle((event) => {
    if (event.name !== "checkout.completed") return;
    setPurchaseNotice("Payment received — adding credits to your balance…");
    const before = creditsRef.current ?? 0;
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      const latest = await loadCredits();
      if ((latest !== null && latest > before) || attempts >= 15) {
        clearInterval(timer);
        setPurchaseNotice(
          latest !== null && latest > before
            ? "Credits added. Happy creating!"
            : "Payment received. Credits will appear shortly — refresh in a minute."
        );
      }
    }, 2000);
  });

  useEffect(() => {
    // Deferred so the initial fetch does not set state synchronously inside the effect.
    const id = setTimeout(() => {
      void loadCredits();
    }, 0);
    return () => clearTimeout(id);
  }, [loadCredits]);

  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
    }

    loadUser();
  }, []);

  function handlePurchase(priceId: string) {
    if (!paddle || !userId) return;

    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customData: { userId },
    });
  }

  function transactionIcon(type: string) {
    switch (type) {
      case "welcome":
        return <Gift size={16} className="text-green-400" />;
      case "purchase":
        return <ArrowUpCircle size={16} className="text-green-400" />;
      case "refund":
        return <RotateCcw size={16} className="text-blue-300" />;
      case "spend":
      default:
        return <ArrowDownCircle size={16} className="text-red-300" />;
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0a0a12] text-white">
      <Sidebar />

      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
              <CreditCard className="text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Billing</h1>
              <p className="text-sm text-gray-400">
                Credits, packages and usage history
              </p>
            </div>
          </div>

          {error && (
            <p className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {loading ? (
            <div className="mt-16 flex justify-center">
              <Loader2 size={32} className="animate-spin text-blue-300" />
            </div>
          ) : (
            <>
              {/* Balance card */}
              <div className="mt-8 rounded-2xl border border-yellow-400/20 bg-gradient-to-br from-yellow-500/10 to-orange-500/5 p-6 sm:p-8">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm text-gray-400">Current balance</p>
                    <div className="mt-2 flex items-center gap-3">
                      <Coins size={28} className="text-yellow-400" />
                      <span className="text-4xl font-bold text-yellow-300">
                        {credits ?? 0}
                      </span>
                      <span className="text-gray-400">credits</span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-400 sm:text-right">
                    <p>Content package + thumbnail: {PIPELINE_COST} credits</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      With voiceover: {PIPELINE_COST_WITH_VOICEOVER} credits
                    </p>
                    <p className="text-xs text-gray-500">
                      + auto subtitles: {PIPELINE_COST_WITH_SUBTITLES} credits
                    </p>
                  </div>
                </div>
              </div>

              {purchaseNotice && (
                <p className="mt-4 rounded-xl border border-green-400/20 bg-green-500/5 px-4 py-3 text-sm text-green-200">
                  {purchaseNotice}
                </p>
              )}

              {/* Free trial status */}
              {freeTrial && (
                <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-purple-400/30 bg-gradient-to-r from-purple-500/10 to-blue-500/5 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <Stamp size={20} className="mt-0.5 shrink-0 text-purple-300" />
                    <div>
                      <p className="text-sm font-semibold text-white">You&apos;re on the free trial</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        Thumbnails and videos you make now carry a small &ldquo;Made with Norveko&rdquo; badge. Buy any pack and it
                        disappears — also from everything you already made.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Packages */}
              <h2 className="mt-12 text-xl font-bold">Credit packs</h2>
              <p className="mt-1 text-sm text-gray-400">
                One-time purchases, no subscription. Every pack unlocks every feature — packs differ only in how much you can make.
              </p>

              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {PLANS.map(({ pack, tagline, idealFor, buys, featured }) => (
                  <div
                    key={pack.id}
                    className={`relative flex flex-col rounded-2xl border p-6 ${
                      featured ? "border-blue-400/50 bg-blue-500/10 shadow-[0_0_40px_-12px_rgba(96,165,250,0.45)]" : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    {featured && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 px-3 py-1 text-xs font-semibold">
                        Most popular
                      </span>
                    )}

                    <h3 className="text-lg font-semibold">{pack.name}</h3>
                    <p className="mt-1 text-sm text-gray-400">{tagline}</p>

                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-3xl font-bold">${pack.priceUsd}</span>
                      <span className="text-sm text-gray-400">one-time</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-sm text-yellow-300">
                      <Coins size={16} />
                      {pack.credits.toLocaleString()} credits
                      <span className="text-xs text-gray-500">· ${((pack.priceUsd / pack.credits) * 100).toFixed(2)} per 100</span>
                    </div>

                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500">What you can make</p>
                    <ul className="mt-2 space-y-1.5 text-sm text-gray-200">
                      {buys.map((line) => (
                        <li key={line} className="flex gap-2">
                          <Sparkles size={14} className="mt-0.5 shrink-0 text-blue-300" />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Ideal for</p>
                    <p className="mt-1 text-sm text-gray-300">{idealFor}</p>

                    <button
                      onClick={() => handlePurchase(pack.paddlePriceId)}
                      disabled={!paddle || !userId}
                      className={`mt-6 w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-60 ${
                        featured ? "bg-gradient-to-r from-blue-500 to-purple-600" : "border border-white/10 bg-white/[0.03] text-gray-300"
                      }`}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <Sparkles size={16} />
                        Buy {pack.name}
                      </span>
                    </button>
                  </div>
                ))}
              </div>

              {/* What every pack includes + how credits are spent */}
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <h3 className="font-semibold">Every pack includes</h3>
                  <ul className="mt-3 space-y-2 text-sm text-gray-300">
                    {PAID_INCLUDES.map((line) => (
                      <li key={line} className="flex gap-2">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <h3 className="font-semibold">What things cost</h3>
                  <p className="mt-1 text-xs text-gray-500">The exact total is always shown before you click Generate.</p>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    {COST_ROWS.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-3 border-b border-white/5 pb-1.5 last:border-0">
                        <dt className="text-gray-400">{label}</dt>
                        <dd className="shrink-0 font-medium text-white">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                <h3 className="text-sm font-semibold">Free trial</h3>
                <ul className="mt-2 grid gap-1.5 text-xs text-gray-400 sm:grid-cols-2">
                  {FREE_TRIAL_RULES.map((line) => (
                    <li key={line} className="flex gap-2">
                      <Gift size={13} className="mt-0.5 shrink-0 text-green-400" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Transaction history */}
              <h2 className="mt-12 text-xl font-bold">Usage history</h2>

              {transactions.length === 0 ? (
                <p className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-gray-400">
                  No transactions yet.
                </p>
              ) : (
                <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                  {transactions.map((tx, index) => (
                    <div
                      key={tx.id}
                      className={`flex items-center justify-between gap-3 px-4 py-4 sm:px-6 ${
                        index !== transactions.length - 1
                          ? "border-b border-white/5"
                          : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {transactionIcon(tx.type)}
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {tx.reason || tx.type}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatDate(tx.created_at)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 text-sm font-semibold ${
                          tx.amount > 0 ? "text-green-400" : "text-red-300"
                        }`}
                      >
                        {tx.amount > 0 ? `+${tx.amount}` : tx.amount}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}