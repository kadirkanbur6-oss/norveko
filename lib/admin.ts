// lib/admin.ts
// Who may open the owner's admin panel (/admin, /api/admin). Server-only.
//
// ADMIN_USER_IDS = comma-separated auth.users ids. While it is not set, the
// launch allowlist BETA_USER_IDS is used instead (today that is only the
// owner). Set ADMIN_USER_IDS before adding other people to the beta list.

import "server-only";

function parseIds(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdmin(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const admins = parseIds(process.env.ADMIN_USER_IDS);
  const list = admins.length ? admins : parseIds(process.env.BETA_USER_IDS);
  return list.includes(userId);
}
