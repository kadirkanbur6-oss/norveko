// lib/paddle-env.ts
// Single source of truth for which Paddle environment is active.
// NEXT_PUBLIC_PADDLE_ENV is readable on both client and server, so it is the
// only variable that decides sandbox vs production. The legacy PADDLE_ENV is
// still honoured on the server as a fallback.

export type PaddleEnvironment = "sandbox" | "production";

export function getPaddleEnvironment(): PaddleEnvironment {
  const raw =
    process.env.NEXT_PUBLIC_PADDLE_ENV ?? process.env.PADDLE_ENV ?? "sandbox";
  return raw === "production" ? "production" : "sandbox";
}

export const isPaddleProduction = getPaddleEnvironment() === "production";
