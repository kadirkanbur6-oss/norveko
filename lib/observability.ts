// lib/observability.ts
// Tiny wrapper around Sentry so the rest of the code never imports the SDK
// directly. Everything here is a no-op when NEXT_PUBLIC_SENTRY_DSN is unset
// (local dev, tests), so callers can use it unconditionally.

type Context = Record<string, string | number | boolean | null | undefined>;

function enabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
}

/** Report an exception with a few searchable tags (jobId, step, route…). */
export async function captureError(error: unknown, context: Context = {}): Promise<void> {
  if (!enabled()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined && value !== null) scope.setTag(key, String(value));
      }
      Sentry.captureException(error);
    });
  } catch {
    // Monitoring must never break the request.
  }
}

/** Report a plain message (something odd but not an exception). */
export async function captureMessage(message: string, context: Context = {}): Promise<void> {
  if (!enabled()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        if (value !== undefined && value !== null) scope.setTag(key, String(value));
      }
      Sentry.captureMessage(message, "warning");
    });
  } catch {
    // best effort
  }
}
