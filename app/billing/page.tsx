"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Coins,
  CreditCard,
  Gift,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import { CREDIT_PACKAGES } from "@/lib/packages";
import { usePaddle } from "@/lib/usePaddle";
import { supabase } from "../lib/supabase";

interface Transaction {
  id: string;
  type: string;
  amount: number;
  reason: string | null;
  created_at: string;
}

const PACKAGE_DETAILS = {
  starter: {
    description: "For creators just getting started.",
    highlight: false,
  },
  pro: {
    description: "For channels publishing every week.",
    highlight: true,
  },
  business: {
    description: "For teams and daily publishers.",
    highlight: false,
  },
};

export default function BillingPage() {
  const [credits, setCredits] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const paddle = usePaddle();

  useEffect(() => {
    async function loadCredits() {
      try {
        const res = await fetch("/api/credits");
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to load billing data.");
        }

        setCredits(data.credits);
        setTransactions(data.transactions);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    loadCredits();
  }, []);

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
    <div className="flex min-h-screen bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="flex-1 p-8">
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
              <div className="mt-8 rounded-2xl border border-yellow-400/20 bg-gradient-to-br from-yellow-500/10 to-orange-500/5 p-8">
                <div className="flex items-center justify-between">
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
                  <div className="text-right text-sm text-gray-400">
                    <p>Content package: 5 credits</p>
                    <p className="mt-1 text-lg font-semibold text-white">
                      Full AI pipeline: 15 credits
                    </p>
                  </div>
                </div>
              </div>

              {/* Packages */}
              <h2 className="mt-12 text-xl font-bold">Credit packages</h2>

              <div className="mt-6 grid gap-6 sm:grid-cols-3">
                {CREDIT_PACKAGES.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`relative rounded-2xl border p-6 ${
                      PACKAGE_DETAILS[pkg.id].highlight
                        ? "border-blue-400/50 bg-blue-500/10"
                        : "border-white/10 bg-white/[0.03]"
                    }`}
                  >
                    {PACKAGE_DETAILS[pkg.id].highlight && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 px-3 py-1 text-xs font-semibold">
                        Most popular
                      </span>
                    )}

                    <h3 className="text-lg font-semibold">{pkg.name}</h3>
                    <p className="mt-1 text-sm text-gray-400">
                      {PACKAGE_DETAILS[pkg.id].description}
                    </p>

                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-3xl font-bold">${pkg.priceUsd}</span>
                      <span className="text-sm text-gray-400">one-time</span>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-sm text-yellow-300">
                      <Coins size={16} />
                      {pkg.credits.toLocaleString()} credits
                    </div>

                    <p className="mt-1 text-xs text-gray-500">
                      ≈ {Math.floor(pkg.credits / 5)} AI generations
                    </p>

                    <button
                      onClick={() => handlePurchase(pkg.paddlePriceId)}
                      disabled={!paddle || !userId}
                      className={`mt-6 w-full rounded-xl py-3 text-sm font-semibold disabled:opacity-60 ${
                        PACKAGE_DETAILS[pkg.id].highlight
                          ? "bg-gradient-to-r from-blue-500 to-purple-600"
                          : "border border-white/10 bg-white/[0.03] text-gray-300"
                      }`}
                    >
                      <span className="flex items-center justify-center gap-2">
                        <Sparkles size={16} />
                        Purchase
                      </span>
                    </button>
                  </div>
                ))}
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
                      className={`flex items-center justify-between px-6 py-4 ${
                        index !== transactions.length - 1
                          ? "border-b border-white/5"
                          : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {transactionIcon(tx.type)}
                        <div>
                          <p className="text-sm">
                            {tx.reason || tx.type}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatDate(tx.created_at)}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`text-sm font-semibold ${
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