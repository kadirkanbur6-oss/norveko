// lib/cron-auth.ts
// Cron endpoints accept Vercel Cron (CRON_SECRET) and the Supabase pg_cron
// heartbeat (HEARTBEAT_SECRET) — see supabase/README.md "Heartbeat".

export function isCronRequest(request: Request): boolean {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  return [process.env.CRON_SECRET, process.env.HEARTBEAT_SECRET].some((s) => Boolean(s) && s === token);
}
