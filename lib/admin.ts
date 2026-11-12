// lib/admin.ts
// Who may open the owner's admin panel (/admin, /api/admin). Server-only.
//
// An account is an admin when
//   - its id is in ADMIN_USER_IDS (comma-separated auth.users ids; while that
//     is not set, the launch allowlist BETA_USER_IDS is used instead), or
//   - its VERIFIED e-mail is in ADMIN_EMAILS (env, comma-separated) or in
//     OWNER_EMAILS below.
// Set ADMIN_USER_IDS before adding other people to the beta list.

import "server-only";

/** Owner accounts that are always admins (5 Nov 2026). */
const OWNER_EMAILS = ["yacesonat@gmail.com", "kadirkanbur6@gmail.com"];

interface AdminCandidate {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
}

function parse(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isAdmin(user: AdminCandidate | null | undefined): boolean {
  if (!user?.id) return false;
  const admins = parse(process.env.ADMIN_USER_IDS);
  const ids = admins.length ? admins : parse(process.env.BETA_USER_IDS);
  if (ids.includes(user.id)) return true;
  // E-mail match only counts once the address has been confirmed.
  if (!user.email || !user.email_confirmed_at) return false;
  const emails = [...OWNER_EMAILS, ...parse(process.env.ADMIN_EMAILS)].map((e) => e.toLowerCase());
  return emails.includes(user.email.toLowerCase());
}
