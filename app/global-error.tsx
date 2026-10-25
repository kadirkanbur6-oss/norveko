"use client";

// Catches errors thrown by the root layout itself (app/error.tsx cannot).
// Must render its own <html>/<body>.
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a12",
          color: "#fff",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          textAlign: "center",
          padding: "0 24px",
        }}
      >
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
        <p style={{ color: "#9ca3af", maxWidth: 420, marginTop: 12 }}>
          We hit an unexpected error. Your projects and credits are safe.
          {error.digest ? (
            <span style={{ display: "block", fontSize: 12, color: "#6b7280", marginTop: 8 }}>
              Reference: {error.digest}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: 32,
            padding: "10px 20px",
            borderRadius: 12,
            border: 0,
            background: "linear-gradient(90deg,#3b82f6,#9333ea)",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
