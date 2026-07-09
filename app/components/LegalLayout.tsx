import Link from "next/link";
import { Layers } from "lucide-react";
import { LEGAL_LAST_UPDATED } from "@/app/lib/legal";

interface LegalLayoutProps {
  title: string;
  children: React.ReactNode;
}

export default function LegalLayout({ title, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-[#0a0a12] text-gray-300">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10">
              <Layers size={20} className="text-blue-300" />
            </div>
            <span className="text-lg font-bold text-white">NORVEKO</span>
          </Link>

          <nav className="flex gap-5 text-sm text-gray-400">
            <Link href="/terms" className="transition hover:text-white">
              Terms
            </Link>
            <Link href="/privacy" className="transition hover:text-white">
              Privacy
            </Link>
            <Link href="/refund" className="transition hover:text-white">
              Refunds
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Last updated: {LEGAL_LAST_UPDATED}
        </p>

        <div className="mt-10 space-y-8 leading-relaxed [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
          {children}
        </div>
      </main>

      <footer className="border-t border-white/10 py-8 text-center text-sm text-gray-500">
        © {new Date().getFullYear()} Norveko. All rights reserved.
      </footer>
    </div>
  );
}