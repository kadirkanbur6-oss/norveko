// Where to go after signing in: only a path on this site ("/team/join?token=…"), never another host.
export function safeNext(value: string | null | undefined): string | null {
  return typeof value === "string" && /^\/(?![\/\\])/.test(value) ? value : null;
}

/** The auth callback URL, carrying `next` when there is one. */
export function callbackUrl(next: string | null): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}
