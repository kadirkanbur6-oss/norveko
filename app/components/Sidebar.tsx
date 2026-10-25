"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SignOutButton from "./SignOutButton";
import BrandMark from "./BrandMark";
import { supabase } from "../lib/supabase";
import {
  BarChart3,
  Coins,
  CreditCard,
  FolderOpen,
  Menu,
  Settings,
  Wand2,
  X,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: BarChart3, href: "/dashboard" },
  { label: "AI Workspace", icon: Wand2, href: "/chat" },
  { label: "Projects", icon: FolderOpen, href: "/projects" },
  { label: "Billing", icon: CreditCard, href: "/billing" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [credits, setCredits] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (active) setEmail(data.user?.email ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    async function loadCredits() {
      try {
        const res = await fetch("/api/credits");
        const data = await res.json();
        if (data.success) {
          setCredits(data.credits);
        }
      } catch {
        // Silently ignore — balance just won't show
      }
    }

    loadCredits();
  }, [pathname]);

  // Lock body scroll while the mobile drawer is open
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const creditsLabel = credits === null ? "—" : credits;

  return (
    <>
      {/* Mobile / tablet top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-[#0a0a12]/90 px-4 backdrop-blur-xl lg:hidden">
        <Link href="/" aria-label="Norveko home" className="flex items-center gap-2.5">
          <BrandMark size={36} />
          <span className="text-lg font-bold tracking-wide text-white">
            NORVEKO
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            href="/billing"
            className="flex items-center gap-1.5 rounded-xl border border-yellow-400/20 bg-yellow-500/5 px-3 py-2 text-sm font-semibold text-yellow-300"
          >
            <Coins size={15} className="text-yellow-400" />
            {creditsLabel}
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-white transition hover:border-white/20"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* Backdrop (mobile only) */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Sidebar: drawer on mobile/tablet, static column on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-white/10 bg-[#0a0a12] p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-w-none lg:translate-x-0 lg:bg-white/[0.03] lg:shrink-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="Norveko home"
            onClick={() => setOpen(false)}
            className="group flex items-center gap-3 rounded-2xl transition hover:opacity-90"
          >
            <BrandMark size={48} className="shadow-[0_8px_24px_rgba(99,102,241,0.35)]" />

            <div>
              <h1 className="text-2xl font-bold tracking-tight">NORVEKO</h1>
              <p className="text-xs text-gray-400">Creator Studio</p>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gray-300 transition hover:text-white lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-10 flex-1 overflow-y-auto">
          <p className="mb-4 text-sm uppercase tracking-[4px] text-gray-500">
            Menu
          </p>

          <div className="space-y-3">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`block w-full rounded-2xl border px-4 py-4 text-left transition ${
                    isActive
                      ? "border-blue-400/40 bg-blue-500/10 text-white"
                      : "border-white/10 bg-white/[0.03] text-gray-300 hover:border-white/20 hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={18} className="text-blue-300" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Credit balance — links to Billing */}
        <Link
          href="/billing"
          onClick={() => setOpen(false)}
          className="mt-6 block rounded-2xl border border-yellow-400/20 bg-yellow-500/5 px-4 py-4 transition hover:border-yellow-400/40 hover:bg-yellow-500/10"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Coins size={18} className="text-yellow-400" />
              <span className="text-sm text-gray-300">Credits</span>
            </div>
            <span className="text-lg font-bold text-yellow-300">
              {creditsLabel}
            </span>
          </div>
        </Link>

        {/* Account */}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-500">Signed in as</p>
            <p className="truncate text-sm text-gray-200">{email ?? "—"}</p>
          </div>
          <SignOutButton
            onDone={() => setOpen(false)}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-300 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-60"
          />
        </div>
      </aside>
    </>
  );
}
