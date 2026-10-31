// lib/plans.ts
// What each credit pack actually buys, computed from the single source of
// credit prices (lib/pipeline/steps.ts) so the billing page and the landing
// page never drift from real pricing. Also the free-trial rules (watermark)
// and the "why Norveko" comparison shown on the landing page.

import { CREDIT_PACKAGES, type CreditPackage } from "./packages";
import { totalPipelineCredits } from "./pipeline/steps";

export const FREE_TRIAL_CREDITS = 50;

/** Typical jobs, priced exactly like the generator prices them. */
export const JOB_COSTS = {
  /** 60 s content package: research + script + scenes + SEO + thumbnail + narration + subtitles. */
  package60: totalPipelineCredits({ research: true, voiceover: true, subtitles: true, duration: "60 seconds" }),
  /** Same without narration. */
  packageText: totalPipelineCredits({ research: true, duration: "60 seconds" }),
  /** Finished 30 s / 60 s MP4 (hybrid footage, image→video clips). */
  video30: totalPipelineCredits({ research: true, fullVideo: true, footage: "hybrid", duration: "30 seconds" }),
  video60: totalPipelineCredits({ research: true, fullVideo: true, footage: "hybrid", duration: "60 seconds" }),
  /** 8-minute long-form script package with a Norveko narrator. */
  longForm: totalPipelineCredits({ research: true, voiceover: true, subtitles: true, duration: "8 minutes" }),
};

export interface PlanDetail {
  pack: CreditPackage;
  tagline: string;
  idealFor: string;
  /** "≈ N …" lines computed from real prices. */
  buys: string[];
  featured: boolean;
}

const COPY: Record<CreditPackage["id"], { tagline: string; idealFor: string; featured: boolean }> = {
  starter: {
    tagline: "Try the full workflow on real videos.",
    idealFor: "New channels testing a niche — a few Shorts a month.",
    featured: false,
  },
  pro: {
    tagline: "A steady publishing rhythm.",
    idealFor: "Channels posting several Shorts a week, or a long-form episode or two.",
    featured: true,
  },
  business: {
    tagline: "Daily output for teams and agencies.",
    idealFor: "Daily Shorts across multiple channels and languages.",
    featured: false,
  },
};

const n = (credits: number, cost: number) => Math.floor(credits / cost);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function planDetails(): PlanDetail[] {
  return CREDIT_PACKAGES.map((pack) => {
    const c = pack.credits;
    const buys = [
      `≈ ${plural(n(c, JOB_COSTS.package60), "content package", "content packages")} with research, voiceover & subtitles`,
      n(c, JOB_COSTS.video60) > 0
        ? `or ≈ ${plural(n(c, JOB_COSTS.video60), "finished 60 s video", "finished 60 s videos")} (≈ ${n(c, JOB_COSTS.video30)} × 30 s)`
        : `or ≈ ${plural(n(c, JOB_COSTS.video30), "finished 30 s video", "finished 30 s videos")}`,
      `or ≈ ${plural(n(c, JOB_COSTS.longForm), "8-minute narrated long-form script", "8-minute narrated long-form scripts")}`,
    ];
    return { pack, ...COPY[pack.id], buys };
  });
}

/** Included in every paid pack (packs differ only in how many credits you get). */
export const PAID_INCLUDES = [
  "No Norveko watermark on thumbnails and videos",
  "Commercial use of everything you generate",
  "Web research with sources + automatic fact check",
  "29 languages, Norveko narrators and native voice artists",
  "Word-timed subtitles (.srt / .vtt) and story-matched music",
  "Credits never expire — failed steps are refunded automatically",
];

/**
 * Full videos are still a private beta; only advertise the free trial video
 * once they are public (set NEXT_PUBLIC_FULL_VIDEO_ENABLED=true together with
 * FULL_VIDEO_ENABLED=true at launch).
 */
export const TRIAL_VIDEO_PUBLIC = process.env.NEXT_PUBLIC_FULL_VIDEO_ENABLED === "true";

export const FREE_TRIAL_RULES = [
  `${FREE_TRIAL_CREDITS} free credits on signup — no card needed`,
  ...(TRIAL_VIDEO_PUBLIC ? ["One finished 30-second video, free — once per account"] : []),
  "Every feature unlocked so you can judge the quality",
  "Thumbnails and videos carry a small Norveko watermark",
  "Buy any pack and the watermark disappears — also from what you already made",
];

/** "Why Norveko" comparison. The right column is deliberately generic. */
export const COMPARISON: Array<{ feature: string; detail: string }> = [
  { feature: "Web research before writing", detail: "Live sources, cited in your project" },
  { feature: "Automatic fact check", detail: "Every sentence checked against the research" },
  { feature: "Story editor pass", detail: "One connected story — no filler, no contradictions" },
  { feature: "Native voice artists in 29 languages", detail: "Plus multilingual Norveko narrators" },
  { feature: "Clips animated from each scene's image", detail: "Visuals match what the narrator says" },
  { feature: "Music chosen by the story's tone", detail: "Licensed tracks, credit added for you" },
  { feature: "Word-timed, language-aware subtitles", detail: "Correct Turkish İ/ı, exportable .srt/.vtt" },
  { feature: "Pay per video, credits never expire", detail: "No monthly subscription to cancel" },
  { feature: "Automatic refunds on failed steps", detail: "You only pay for what was delivered" },
];
