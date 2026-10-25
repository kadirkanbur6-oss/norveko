import Link from "next/link";
import BrandMark from "./components/BrandMark";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a12] px-6 text-center text-white">
      <BrandMark size={64} />
      <p className="mt-8 text-sm uppercase tracking-[0.3em] text-violet-300/80">404</p>
      <h1 className="mt-2 text-3xl font-bold">This page doesn&apos;t exist</h1>
      <p className="mt-3 max-w-md text-gray-400">
        The link may be broken or the page may have moved.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
        >
          Go home
        </Link>
        <Link
          href="/dashboard"
          className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm text-gray-300 transition hover:text-white"
        >
          Open dashboard
        </Link>
      </div>
    </main>
  );
}
