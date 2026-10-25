// Sentry — Node.js runtime (route handlers, server components, pipeline worker).
// Loaded from instrumentation.ts. Without NEXT_PUBLIC_SENTRY_DSN the SDK is
// initialised with an empty DSN, which makes every call a silent no-op.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  // Error monitoring only for now; keep performance sampling low to stay in
  // the free quota. Raise when we actually look at traces.
  tracesSampleRate: 0.05,
});
