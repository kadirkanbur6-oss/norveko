// lib/payments.ts
// Are real purchases open? (9 Nov 2026, Yağmur: launch before the company /
// Paddle live verification exists.) Until Paddle runs in production, Buy and
// Subscribe buttons become "Opening soon" with a waitlist, except for admins,
// who keep the sandbox checkout for testing. Flip by setting
// NEXT_PUBLIC_PADDLE_ENV=production (the real switch) or, to open earlier for
// any reason, NEXT_PUBLIC_PAYMENTS_LIVE=true.
import { isPaddleProduction } from "@/lib/paddle-env";

export const PAYMENTS_LIVE = process.env.NEXT_PUBLIC_PAYMENTS_LIVE === "true" || isPaddleProduction;

export const PAYMENTS_SOON_TITLE = "Plans and packs open soon";
export const PAYMENTS_SOON_BODY =
  "Payments go live in a few days. Your free credits work now; join the list and we'll e-mail you the moment plans open, with a launch bonus on your first purchase.";
