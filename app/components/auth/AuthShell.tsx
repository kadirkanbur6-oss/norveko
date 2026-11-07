// app/components/auth/AuthShell.tsx
// Ortak giriş/kayıt kabuğu: üstte ana sayfaya dönen Norveko logosu, ortada kart,
// altta Terms / Privacy linkleri. Login, signup, forgot-password ve
// reset-password sayfaları aynı görünümü paylaşır.

import Link from "next/link";
import BrandMark from "../BrandMark";

export default function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  /** Not shown any more (all-caps labels looked templated). */
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Kartın altındaki küçük metin (ör. "Don't have an account? Sign up"). */
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--nv-bg)] px-4 py-10 text-white sm:py-12">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-3 self-start rounded-2xl text-lg font-semibold tracking-tight text-white/90 transition hover:text-white"
          aria-label="Norveko home"
        >
          <BrandMark size={36} />
          <span>Norveko</span>
        </Link>

        <main id="main-content" className="rounded-[32px] border border-white/10 bg-white/5 p-6 shadow-[0_25px_100px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-10">
          <div className="mb-8 space-y-3">
            <h1 className="text-4xl font-semibold">{title}</h1>
            {description ? <p className="text-sm text-gray-400">{description}</p> : null}
          </div>

          {children}

          {footer ? <p className="mt-6 text-center text-sm text-gray-400">{footer}</p> : null}
        </main>

        <p className="mt-6 text-center text-xs text-gray-500">
          By continuing you agree to our{" "}
          <Link href="/terms" className="text-violet-300 hover:text-violet-100">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-violet-300 hover:text-violet-100">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
