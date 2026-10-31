"use client";

// Invite & earn: the user's invite link and what it has earned (lib/referrals/referrals.ts).

import { useEffect, useState } from "react";
import { Check, Copy, Gift } from "lucide-react";

interface Data {
  link: string;
  sharePercent: number;
  months: number;
  signups: number;
  buyers: number;
  creditsEarned: number;
}

export default function ReferralCard() {
  const [data, setData] = useState<Data | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/referrals")
      .then((r) => r.json())
      .then((d) => d.success && setData(d))
      .catch(() => undefined);
  }, []);

  if (!data) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(data!.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: the field is selectable
    }
  }

  const stat = (label: string, value: number) => (
    <div className="rounded-xl border border-white/10 bg-[#0d0d16] p-3 text-center">
      <p className="text-lg font-bold text-white">{value.toLocaleString()}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.06] to-transparent p-6">
      <div className="flex items-center gap-2">
        <Gift size={18} className="text-amber-300" aria-hidden />
        <h2 className="font-semibold">Invite &amp; earn</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        Share your link. When someone signs up with it, you get {data.sharePercent}% of the credits of every pack they buy in their first {data.months} months.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          readOnly
          value={data.link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Your invite link"
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-[#12121c] p-2.5 text-sm text-white outline-none"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-amber-400"
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {stat("Sign-ups", data.signups)}
        {stat("Bought a pack", data.buyers)}
        {stat("Credits earned", data.creditsEarned)}
      </div>
    </div>
  );
}
