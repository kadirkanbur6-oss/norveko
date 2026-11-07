// lib/packages.ts
// Credit packages and their Paddle price IDs.
//
// Price IDs come from env so sandbox and production can differ without a
// code change:
//   NEXT_PUBLIC_PADDLE_PRICE_STARTER
//   NEXT_PUBLIC_PADDLE_PRICE_PRO
//   NEXT_PUBLIC_PADDLE_PRICE_BUSINESS
// The hardcoded values below are the SANDBOX IDs and only act as a fallback
// for local development. Production MUST set the env vars (see .env.example).

export interface CreditPackage {
  id: "starter" | "pro" | "business";
  name: string;
  credits: number;
  priceUsd: number;
  paddlePriceId: string;
}

const SANDBOX_PRICE_IDS = {
  starter: "pri_01kx1v9m0pehh3w39rz8mwe3je",
  pro: "pri_01kx1vdp549r57a0m7605n4250",
  business: "pri_01kx1vfk0e7y02htvtk8tekhqh",
} as const;

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "starter",
    name: "Starter",
    credits: 500,
    priceUsd: 12,
    paddlePriceId:
      process.env.NEXT_PUBLIC_PADDLE_PRICE_STARTER ?? SANDBOX_PRICE_IDS.starter,
  },
  {
    id: "pro",
    // Display name only (the id and Paddle price stay "pro"); renamed 5 Nov 2026 so the
    // one-time pack is not confused with the "Pro" subscription plan.
    name: "Growth",
    credits: 2000,
    priceUsd: 39,
    paddlePriceId:
      process.env.NEXT_PUBLIC_PADDLE_PRICE_PRO ?? SANDBOX_PRICE_IDS.pro,
  },
  {
    id: "business",
    name: "Business",
    credits: 5000,
    priceUsd: 89,
    paddlePriceId:
      process.env.NEXT_PUBLIC_PADDLE_PRICE_BUSINESS ?? SANDBOX_PRICE_IDS.business,
  },
];

export function getPackageByPriceId(
  priceId: string
): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.paddlePriceId === priceId);
}
