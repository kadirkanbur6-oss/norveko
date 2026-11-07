// lib/plans.ts
// What each credit pack actually buys, computed from the single source of
// credit prices (lib/pipeline/steps.ts) so the billing page and the landing
// page never drift from real pricing. Also the free-trial rules (watermark)
// and the "why Norveko" comparison shown on the landing page.

import { CREDIT_PACKAGES, type CreditPackage } from "./packages";
import { totalPipelineCredits } from "./pipeline/steps";

/**
 * Credits every new account starts with. 6 Nov 2026: 50 → 70 so a new user can make one
 * narrated 30 s video (stock + AI) instead of getting the costlier free trial video.
 * The grant itself happens in the database on sign-up (see supabase/README.md "Sign-up credits").
 */
export const FREE_TRIAL_CREDITS = 70;

/** Finished videos are open to everyone (launch): the landing copy may promise one. */
const FULL_VIDEO_PUBLIC = process.env.NEXT_PUBLIC_FULL_VIDEO_ENABLED === "true";

/** Typical jobs, priced exactly like the generator prices them. */
export const JOB_COSTS = {
  /** 60 s content package: research + script + scenes + SEO + thumbnail + narration + subtitles. */
  package60: totalPipelineCredits({ research: true, voiceover: true, subtitles: true, duration: "60 seconds" }),
  /** Same without narration. */
  packageText: totalPipelineCredits({ research: true, duration: "60 seconds" }),
  /** Finished 30 s / 60 s MP4 (hybrid footage, image→video clips). */
  video30: totalPipelineCredits({ research: true, fullVideo: true, footage: "hybrid", duration: "30 seconds" }),
  video60: totalPipelineCredits({ research: true, fullVideo: true, footage: "hybrid", duration: "60 seconds" }),
  /** Cheapest finished video: 30 s, stock footage + AI scenes, Norveko narrator, subtitles. */
  video30Stock: totalPipelineCredits({ research: true, fullVideo: true, footage: "stock", subtitles: true, duration: "30 seconds" }),
  /** 8-minute long-form script package with a Norveko narrator. */
  longForm: totalPipelineCredits({ research: true, voiceover: true, subtitles: true, duration: "10 minutes" }),
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
    idealFor: "New channels testing a niche, a few Shorts a month.",
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
      `or ≈ ${plural(n(c, JOB_COSTS.longForm), "10-minute narrated long-form script", "10-minute narrated long-form scripts")}`,
    ];
    return { pack, ...COPY[pack.id], buys };
  });
}

/** Included in every paid plan and pack (they differ only in how many credits you get). */
export const PAID_INCLUDES = [
  "No Norveko watermark on thumbnails and videos",
  "Commercial use of everything you generate",
  "Web research with sources + automatic fact check",
  "29 languages, Norveko narrators and native voice artists",
  "Word-timed subtitles (.srt / .vtt) and story-matched music",
  "Pack credits never expire, and failed steps are refunded automatically",
  "Your finished videos are kept as long as your account exists",
];

/**
 * Full videos are still a private beta; only advertise the free trial video
 * once they are public (set NEXT_PUBLIC_FULL_VIDEO_ENABLED=true together with
 * FULL_VIDEO_ENABLED=true at launch).
 */
// The free trial video is off (lib/pipeline/trial.ts TRIAL_VIDEO_ENABLED); its copy stays hidden.
export const TRIAL_VIDEO_PUBLIC = false;

/** What the sign-up credits buy, in words ("two researched scripts with thumbnails"). */
export const FREE_CREDITS_BUY = (() => {
  const packs = Math.floor(FREE_TRIAL_CREDITS / JOB_COSTS.packageText);
  const narrated = Math.floor(FREE_TRIAL_CREDITS / JOB_COSTS.package60);
  const words = ["zero", "one", "two", "three", "four", "five"];
  const w = (n: number) => words[n] ?? String(n);
  const scripts = `${w(packs)} researched script${packs === 1 ? "" : "s"} with scene plan, SEO and thumbnail`;
  // Finished videos are advertised only once they are open to everyone.
  if (FULL_VIDEO_PUBLIC && FREE_TRIAL_CREDITS >= JOB_COSTS.video30Stock) return `one finished 30-second narrated video, or ${scripts}`;
  return `${scripts}, or ${w(narrated)} with narration and subtitles`;
})();

export const FREE_TRIAL_RULES = [
  `${FREE_TRIAL_CREDITS} free credits on signup, no card needed (≈ ${FREE_CREDITS_BUY})`,
  ...(TRIAL_VIDEO_PUBLIC ? ["One finished 30-second video, free, once per account"] : []),
  "Every feature unlocked so you can judge the quality",
  "One free trial per person; temporary emails aren't eligible",
  "Thumbnails and videos carry a small Norveko watermark",
  "Finished videos are kept for 7 days, so download what you want to keep",
  "Subscribe or buy any pack and the watermark disappears, also from what you already made",
];

/**
 * "Why Norveko": what Norveko itself does, grouped by what it is for. 7 Nov 2026: the old
 * table claimed a "Typical AI tool" lacked each feature; that claim could not be checked,
 * so the page now only states what we ship.
 */
export const WHY_NORVEKO: Array<{ title: string; items: Array<{ feature: string; detail: string }> }> = [
  {
    title: "A story you can trust",
    items: [
      { feature: "Web research before writing", detail: "Live sources, cited in your project" },
      { feature: "Automatic fact check", detail: "Every sentence checked against the research" },
      { feature: "Story editor pass", detail: "One connected story, no filler, no contradictions" },
      { feature: "You approve the script first", detail: "Fix names, facts and scenes before anything is made" },
    ],
  },
  {
    title: "A video that sounds and looks right",
    items: [
      { feature: "Narrators and native voices in 29 languages", detail: "Or your own cloned voice" },
      { feature: "Visuals made from each scene", detail: "AI clips, stills, stock and archive photos" },
      { feature: "Music chosen by the story's tone", detail: "Licensed tracks, credit added for you" },
      { feature: "Word-timed subtitles", detail: "Correct casing in every language, .srt and .vtt" },
    ],
  },
  {
    title: "Fair to use",
    items: [
      { feature: "Everything is yours to download", detail: "MP4, thumbnail, voice-over and subtitle files" },
      { feature: "Automatic refunds on failed steps", detail: "You only pay for what was delivered" },
      { feature: "Pack credits never expire", detail: "Or a weekly, monthly or yearly plan, cancel anytime" },
    ],
  },
];

/**
 * What an account that never paid may make with its sign-up credits (7 Nov 2026, Yağmur:
 * "settings stay locked, everything else leads to buying"). Checked in /api/pipeline/start
 * and mirrored in /chat; skits, talking characters and swaps need a purchase.
 */
export const FREE_PLAN = {
  /** Finished video: one fixed setup (≈ 67 credits). */
  videoDuration: "30 seconds",
  videoFootage: "stock",
  /** Script / narration packages (before full video is public). */
  packageDurations: ["30 seconds", "60 seconds"] as readonly string[],
};

export const FREE_PLAN_UPGRADE_MESSAGE =
  "Free credits make a 30-second Stock + AI video with a Norveko narrator. Buy a pack or a plan to unlock every length, footage style, voice and studio.";

/** Why a free account may not start this, or null when it may. */
export function freePlanViolation(o: {
  fullVideo: boolean;
  duration: string;
  footage?: string;
  voiceEngine?: string;
  video?: boolean;
  presenter?: boolean;
  characters?: number;
}): string | null {
  if (o.video) return FREE_PLAN_UPGRADE_MESSAGE;
  if (o.voiceEngine === "elevenlabs") return FREE_PLAN_UPGRADE_MESSAGE;
  if (o.presenter || (o.characters ?? 0) > 0) return FREE_PLAN_UPGRADE_MESSAGE;
  if (o.fullVideo) {
    if (o.duration !== FREE_PLAN.videoDuration || o.footage !== FREE_PLAN.videoFootage) return FREE_PLAN_UPGRADE_MESSAGE;
    return null;
  }
  return FREE_PLAN.packageDurations.includes(o.duration) ? null : FREE_PLAN_UPGRADE_MESSAGE;
}

