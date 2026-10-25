"use client";

import { useEffect } from "react";
import Link from "next/link";
import BrandMark from "./components/BrandMark";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a12] px-6 text-center text-white">
      <BrandMark size={64} />
      <h1 className="mt-8 text-3xl font-bold">Something went wrong</h1>
      <p className="mt-3 max-w-md text-gray-400">
        We hit an unexpected error. Your projects and credits are safe.
        {error.digest ? (
          <span className="mt-2 block text-xs text-gray-500">Reference: {error.digest}</span>
        ) : null}
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-gray-300 transition hover:text-white"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
