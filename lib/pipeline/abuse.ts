// lib/pipeline/abuse.ts
// Free-tier abuse protection (31 Oct 2026). Signup happens in the browser
// straight against Supabase, so blocking at signup could be bypassed — the
// checks live where free usage is actually spent: /api/pipeline/start.
//
// Applies only to accounts that have NOT bought a pack (paying customers and
// beta accounts are never affected):
//   1. Disposable/temporary e-mail domains get no free generations.
//   2. One IP (hashed, never stored raw) can feed at most FREE_ACCOUNTS_PER_IP
//      different free accounts per FREE_IP_WINDOW_DAYS.
//   3. The free trial video is once per IP (30 days) and once per normalised
//      e-mail (a+1@gmail.com, a.1@gmail.com … count as the same person).

import { createHash } from "node:crypto";
import disposableDomains from "disposable-email-domains/index.json";
import disposableWildcards from "disposable-email-domains/wildcard.json";
import type { SupabaseClient } from "@supabase/supabase-js";

export const FREE_ACCOUNTS_PER_IP = 3;
export const FREE_IP_WINDOW_DAYS = 7;
export const TRIAL_IP_WINDOW_DAYS = 30;

export const DISPOSABLE_EMAIL_MESSAGE =
  "Free credits aren't available for temporary email addresses. Sign up with a permanent email, or buy any pack to start generating.";
export const IP_LIMIT_MESSAGE =
  "Too many free accounts have been used from this network. Buy any pack to keep generating — credits never expire.";

let disposable: Set<string> | null = null;
let disposableWildcard: Set<string> | null = null;

function lists(): { exact: Set<string>; wildcard: Set<string> } {
  if (!disposable || !disposableWildcard) {
    // ~120k domains; the Set is built once per server instance.
    disposable = new Set<string>(disposableDomains as string[]);
    disposableWildcard = new Set<string>(disposableWildcards as string[]);
  }
  return { exact: disposable, wildcard: disposableWildcard };
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
}

/** True for throwaway inboxes (mailinator, 10minutemail …), including their subdomains. */
export function isDisposableEmail(email: string | null | undefined): boolean {
  const domain = emailDomain(email ?? "");
  if (!domain) return false;
  const { exact, wildcard } = lists();
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join(".");
    if (exact.has(candidate) || wildcard.has(candidate)) return true;
  }
  return false;
}

const DOTLESS_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Same person, same key: lower-case, "+tag" removed, Gmail dots removed. */
export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  let local = lower.slice(0, at).split("+")[0];
  let domain = lower.slice(at + 1);
  if (DOTLESS_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/** Salted one-way hash — raw IPs and e-mails are never written to job rows. */
export function abuseHash(kind: "ip" | "email", value: string): string {
  const salt = process.env.PIPELINE_WORKER_SECRET || "norveko";
  return createHash("sha256").update(`${kind}:${salt}:${value}`).digest("hex").slice(0, 32);
}

/** Client IP as Vercel reports it (first hop of x-forwarded-for). */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-vercel-forwarded-for") || headers.get("x-forwarded-for") || headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0]?.trim();
  return ip || null;
}

export interface AbuseContext {
  email?: string | null;
  ip?: string | null;
}

/** Markers stored in pipeline_jobs.options for free (non-purchaser) jobs. */
export function freeJobMarkers(ctx: AbuseContext): { freeIp?: string; freeEmail?: string } {
  return {
    freeIp: ctx.ip ? abuseHash("ip", ctx.ip) : undefined,
    freeEmail: ctx.email ? abuseHash("email", normalizeEmail(ctx.email)) : undefined,
  };
}

/**
 * Can this free (non-purchaser) account spend its free credits?
 * Returns an English error message when it can't. Fails OPEN on lookup
 * errors: a database hiccup must not lock out a genuine new user.
 */
export async function freeUsageBlock(
  db: SupabaseClient,
  userId: string,
  ctx: AbuseContext
): Promise<string | null> {
  if (isDisposableEmail(ctx.email)) return DISPOSABLE_EMAIL_MESSAGE;
  if (!ctx.ip) return null;
  const since = new Date(Date.now() - FREE_IP_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("pipeline_jobs")
    .select("user_id")
    .eq("options->>freeIp", abuseHash("ip", ctx.ip))
    .neq("user_id", userId)
    .gte("created_at", since)
    .limit(200);
  if (error) {
    console.warn("[abuse] ip lookup failed:", error.message);
    return null;
  }
  const others = new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
  return others.size >= FREE_ACCOUNTS_PER_IP ? IP_LIMIT_MESSAGE : null;
}

/**
 * Has the free trial video already been used by this person on another
 * account (same normalised e-mail ever, or same IP within 30 days)?
 * Fails CLOSED like hasUsedTrialVideo: never hand out a second free video by accident.
 */
export async function trialUsedElsewhere(db: SupabaseClient, userId: string, ctx: AbuseContext): Promise<boolean> {
  if (isDisposableEmail(ctx.email)) return true;
  const { freeIp, freeEmail } = freeJobMarkers(ctx);
  if (freeEmail) {
    const { count, error } = await db
      .from("pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("options->>trialVideo", "true")
      .eq("options->>freeEmail", freeEmail)
      .neq("user_id", userId);
    if (error) return true;
    if ((count ?? 0) > 0) return true;
  }
  if (freeIp) {
    const since = new Date(Date.now() - TRIAL_IP_WINDOW_DAYS * 86_400_000).toISOString();
    const { count, error } = await db
      .from("pipeline_jobs")
      .select("id", { count: "exact", head: true })
      .eq("options->>trialVideo", "true")
      .eq("options->>freeIp", freeIp)
      .neq("user_id", userId)
      .gte("created_at", since);
    if (error) return true;
    if ((count ?? 0) > 0) return true;
  }
  return false;
}
