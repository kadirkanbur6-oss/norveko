// lib/payments.ts
// Are real purchases open? (9 Nov 2026, Yağmur: launch before the company /
// Paddle live verification exists.) Until Paddle runs in production, Buy and
// Subscribe buttons become "Opening soon" with a waitlist, except for admins,
// who keep the sandbox checkout for testing. Flip by setting
// NEXT_PUBLIC_PADDLE_ENV=production (the real switch) or, to open earlier for
// any reason, NEXT_PUBLIC_PAYMENTS_LIVE=true.
import { isPaddleProduction } from "@/lib/paddle-env";

export const PAYMENTS_LIVE = process.env.NEXT_PUBLIC_PAYMENTS_LIVE === "true" || isPaddleProduction;

export const PAYMENTS_SOON_TITLE = "Plans and packs are opening soon";
export const PAYMENTS_SOON_BODY =
  "We're finishing payment setup. Your free credits work right now, so you can make a video today. Join the list and we'll e-mail you the moment plans and packs open.";
