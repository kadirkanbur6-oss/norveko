// lib/pipeline/features.ts
// Feature gates for expensive pipeline steps. Server-only.
//
// Video generation is OFF for everyone until VIDEO_GENERATION_ENABLED=true.
// While it is off, specific users (comma-separated ids in VIDEO_BETA_USER_IDS)
// can still use it for testing. The API checks this before any credit is
// charged, so a disabled feature can never touch a balance.

import "server-only";

export function isVideoGenerationEnabled(userId: string | null | undefined): boolean {
  if (process.env.VIDEO_GENERATION_ENABLED === "true") return true;
  if (!userId) return false;
  const allowlist = (process.env.VIDEO_BETA_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowlist.includes(userId);
}
