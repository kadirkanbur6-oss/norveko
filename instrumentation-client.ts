// Sentry — browser. Next.js loads this file before the app hydrates.
// No-op unless NEXT_PUBLIC_SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.05,
  // No session replay: it costs quota and records user content. PII is off by default in SDK v11.
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
