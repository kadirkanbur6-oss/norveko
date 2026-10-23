// lib/pipeline/features.ts
// Feature gates for expensive pipeline steps. Server-only.
//
// Launch lock: set GENERATION_ENABLED=false while the product is still being
// built. Then only the user ids in BETA_USER_IDS (comma-separated auth.users
// ids) can start a generation; everyone else is rejected BEFORE any credit is
// charged. Unset or "true" means open to all signed-in users.
//
// Video generation has its own, stricter gate: OFF unless
// VIDEO_GENERATION_ENABLED=true, with VIDEO_BETA_USER_IDS as the test allowlist.

import "server-only";

function parseIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isAllowlisted(userId: string | null | undefined, raw: string | undefined): boolean {
  return Boolean(userId) && parseIds(raw).includes(userId as string);
}

/** May this user run the content pipeline at all? */
export function isGenerationEnabled(userId: string | null | undefined): boolean {
  if (process.env.GENERATION_ENABLED !== "false") return true;
  return isAllowlisted(userId, process.env.BETA_USER_IDS);
}

/** May this user add Kling video clips to a generation? */
export function isVideoGenerationEnabled(userId: string | null | undefined): boolean {
  if (!isGenerationEnabled(userId)) return false;
  if (process.env.VIDEO_GENERATION_ENABLED === "true") return true;
  return isAllowlisted(userId, process.env.VIDEO_BETA_USER_IDS);
}

/** Message shown to users while the launch lock is on. */
export const LAUNCH_LOCK_MESSAGE =
  "Norveko is launching soon. Content generation is temporarily closed while we finish building — your credits are safe and nothing has been charged.";
