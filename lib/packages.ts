// lib/packages.ts
// Kredi paketleri ve Paddle price ID eşleştirmesi.
// DİKKAT: Bu ID'ler SANDBOX ID'leridir. Canlıya geçerken
// live hesapta yeniden oluşturulup güncellenmeleri gerekir.

export interface CreditPackage {
  id: "starter" | "pro" | "business";
  name: string;
  credits: number;
  priceUsd: number;
  paddlePriceId: string;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "starter",
    name: "Starter",
    credits: 500,
    priceUsd: 9,
    paddlePriceId: "pri_01kx1v9m0pehh3w39rz8mwe3je",
  },
  {
    id: "pro",
    name: "Pro",
    credits: 2000,
    priceUsd: 29,
    paddlePriceId: "pri_01kx1vdp549r57a0m7605n4250",
  },
  {
    id: "business",
    name: "Business",
    credits: 5000,
    priceUsd: 59,
    paddlePriceId: "pri_01kx1vfk0e7y02htvtk8tekhqh",
  },
];

export function getPackageByPriceId(
  priceId: string
): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.paddlePriceId === priceId);
}

export function getPackageById(
  id: string
): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}
