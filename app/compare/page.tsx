import type { Metadata } from "next";
import LegalLayout from "@/app/components/LegalLayout";
import { JOB_COSTS } from "@/lib/plans";
import { SUBSCRIPTION_PLANS } from "@/lib/subscriptions";

// DRAFT (7 Nov 2026): not linked anywhere, not in the sitemap, not in
// proxy.ts PUBLIC_PAGES (only signed-in users can open it). To publish:
// re-check every competitor row on its own pricing page, update CHECKED,
// then add "/compare" to PUBLIC_PAGES and app/sitemap.ts and link it.
export const metadata: Metadata = {
  title: "Norveko vs other AI video tools",
  robots: { index: false, follow: false },
};

const CHECKED = "7 November 2026";

const creator = SUBSCRIPTION_PLANS.find((p) => p.id === "creator-month")!;
const pro = SUBSCRIPTION_PLANS.find((p) => p.id === "pro-month")!;
const perVideo = (p: { credits: number; priceUsd: number }) =>
  (p.priceUsd / Math.floor(p.credits / JOB_COSTS.video30)).toFixed(2);

const ROWS: Array<{
  tool: string;
  plan: string;
  price: string;
  allowance: string;
  notes: string;
  source: string;
  url: string;
}> = [
  {
    tool: "Revid",
    plan: "Growth",
    price: "€39 / month (page showed euros; currency follows location)",
    allowance: "2,000 AI credits / month",
    notes:
      "Publishes to TikTok, Instagram, YouTube and X; 70+ language voiceovers. Creating and cloning your own voices is listed only on Ultra (€199, 12,000 credits).",
    source: "revid.ai/pricing",
    url: "https://www.revid.ai/pricing",
  },
  {
    tool: "InVideo AI",
    plan: "Ultra",
    price: "$40 / seat / month billed annually ($80 monthly)",
    allowance: "3,000 credits / seat / month",
    notes:
      "Credit-based; the page equates 3,000 credits to about 78 Seedance 2 videos. Other tiers were not readable on the page we checked.",
    source: "invideo.io/pricing",
    url: "https://invideo.io/pricing",
  },
  {
    tool: "Pictory",
    plan: "Professional",
    price: "$35 / month billed annually (listed as previously $59)",
    allowance: "72,000 credits granted upfront; up to 1,080 min / year",
    notes: "Includes voice clones, cloned avatars and 5 brand kits. Annual plans grant all credits upfront.",
    source: "pictory.ai/pricing",
    url: "https://pictory.ai/pricing",
  },
  {
    tool: "Fliki",
    plan: "Standard",
    price: "Shown in local currency (yearly billing is 25% off)",
    allowance: "180 credits / month (Premium: 600)",
    notes:
      "1,000 voices, 1080p, videos up to 15 minutes, 80+ languages, one voice clone, YouTube publishing.",
    source: "fliki.ai/pricing",
    url: "https://fliki.ai/pricing",
  },
];

export default function ComparePage() {
  return (
    <LegalLayout title="Norveko vs other AI video tools">
      <section>
        <p>
          Prices and allowances below were read from each tool&apos;s own
          pricing page on {CHECKED}. Plans change often, so check the linked
          page before you buy. We only list what the page itself showed.
        </p>
      </section>

      <section>
        <h2>Norveko</h2>
        <ul>
          <li>
            Creator: ${creator.priceUsd} / month, {creator.credits.toLocaleString("en-US")} credits
            — about {Math.floor(creator.credits / JOB_COSTS.video30)} finished 30-second narrated
            videos (≈ ${perVideo(creator)} each).
          </li>
          <li>
            Pro: ${pro.priceUsd} / month, {pro.credits.toLocaleString("en-US")} credits — about{" "}
            {Math.floor(pro.credits / JOB_COSTS.video30)} finished 30-second videos (≈ $
            {perVideo(pro)} each).
          </li>
          <li>
            Narration in 29 languages, a clone of your own voice on the Pro plan and the Business pack,
            and skits and talking characters in the same workspace.
          </li>
          <li>
            Subscription credits are valid for their own period and do not roll
            over; one-time pack credits don&apos;t expire while your account is active.
          </li>
        </ul>
      </section>

      <section>
        <h2>Others (from their own pricing pages)</h2>
        {ROWS.map((r) => (
          <div key={r.tool} className="mt-4 rounded-lg border border-white/10 p-4">
            <h3 className="font-semibold text-white">
              {r.tool} — {r.plan}
            </h3>
            <ul>
              <li>Price: {r.price}</li>
              <li>Allowance: {r.allowance}</li>
              <li>{r.notes}</li>
              <li>
                Source:{" "}
                <a href={r.url} rel="nofollow noopener noreferrer" target="_blank">
                  {r.source}
                </a>
                , checked {CHECKED}
              </li>
            </ul>
          </div>
        ))}
      </section>

      <section>
        <h2>How to read this</h2>
        <p>
          Credits, minutes and videos are not the same unit, so the cheapest
          sticker price is not always the cheapest finished video. Compare what
          you need to make each month, not the plan name.
        </p>
      </section>
    </LegalLayout>
  );
}
