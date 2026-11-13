"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SignOutButton from "./SignOutButton";
import BrandMark from "./BrandMark";
import { supabase } from "../lib/supabase";
import { ThemeSwitch } from "./ThemeToggle";
import LanguageMenu from "./LanguageMenu";
import {
  BarChart3,
  Coins,
  CreditCard,
  FolderOpen,
  Menu,
  Settings,
  Wand2,
  X,
  Repeat,
  ShieldCheck,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: BarChart3, href: "/dashboard" },
  { label: "AI Workspace", icon: Wand2, href: "/chat" },
  { label: "Projects", icon: FolderOpen, href: "/projects" },
  { label: "Series", icon: Repeat, href: "/series" },
  { label: "Billing", icon: CreditCard, href: "/billing" },
  { label: "Settings", icon: Settings, href: "/settings" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [credits, setCredits] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [providerAlerts, setProviderAlerts] = useState<Array<{ label: string; level: string; reason: string }>>([]);
  const [email, setEmail] = useState<string | null>(null);

  // Red dot next to "Admin" when a provider is low or out of credit (owner only).
  useEffect(() => {
    if (!admin) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/admin/alerts", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json.success) setProviderAlerts(json.alerts ?? []);
      } catch {
        /* keep the last answer */
      }
    };
    check();
    const timer = setInterval(check, 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [admin]);

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
          setAdmin(data.admin === true);
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

  const creditsLabel = credits === null ? "…" : credits;

  return (
    <>
      {/* Mobile / tablet top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/10 bg-[var(--nv-bg)]/90 px-4 backdrop-blur-xl lg:hidden">
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

      {/* Sidebar: drawer on mobile/tablet, static column on desktop.
          Compact on purpose: the whole menu fits any laptop height without an
          inner scrollbar. */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col border-r border-white/[0.06] bg-[var(--nv-bg)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5 transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-w-none lg:translate-x-0 lg:shrink-0 lg:bg-[var(--nv-bg)] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-2">
          <Link
            href="/"
            aria-label="Norveko home"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-xl transition hover:opacity-90"
          >
            <BrandMark size={34} className="shadow-[0_6px_18px_rgba(99,102,241,0.35)]" />
            <span className="text-[17px] font-semibold tracking-[0.08em] text-white">NORVEKO</span>
          </Link>

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white/5 hover:text-white lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav aria-label="Main" className="nv-no-scrollbar mt-8 flex-1 space-y-0.5 overflow-y-auto">
          {(admin ? [...navItems, { label: "Admin", icon: ShieldCheck, href: "/admin" }] : navItems).map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

            return (
              <Link
                key={item.label}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] transition ${
                  isActive ? "bg-white/[0.07] font-medium text-white" : "text-gray-400 hover:bg-white/[0.04] hover:text-gray-100"
                }`}
              >
                {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-gradient-to-b from-blue-400 to-purple-500" />}
                <Icon size={17} className={isActive ? "text-blue-300" : "text-gray-500 transition group-hover:text-gray-300"} />
                {item.label}
                {item.href === "/admin" && providerAlerts.some((a) => a.level !== "stale") && (
                  <span
                    role="status"
                    title={providerAlerts.filter((a) => a.level !== "stale").map((a) => `${a.label}: ${a.reason}`).join("\n")}
                    className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[11px] font-semibold leading-none text-white"
                  >
                    <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                    {providerAlerts.filter((a) => a.level !== "stale").length} low
                    <span className="sr-only">: {providerAlerts.filter((a) => a.level !== "stale").map((a) => a.label).join(", ")} need credit</span>
                  </span>
                )}
                {item.href === "/admin" && !providerAlerts.some((a) => a.level !== "stale") && providerAlerts.length > 0 && (
                  <span
                    role="status"
                    title={providerAlerts.map((a) => `${a.label}: ${a.reason}`).join("\n")}
                    className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[11px] font-semibold leading-none text-black"
                  >
                    Update balances
                    <span className="sr-only">: {providerAlerts.map((a) => a.label).join(", ")}</span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Credits + account in one quiet block */}
        <div className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3">
          <Link
            href="/billing"
            onClick={() => setOpen(false)}
            className="flex items-center justify-between rounded-xl px-2 py-1.5 transition hover:bg-white/[0.04]"
          >
            <span className="flex items-center gap-2 text-sm text-gray-400">
              <Coins size={15} className="text-yellow-400" />
              Credits
            </span>
            <span className="text-base font-semibold tabular-nums text-yellow-200">{creditsLabel}</span>
          </Link>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.06] px-2 pt-2.5">
            <p className="min-w-0 truncate text-xs text-gray-500" title={email ?? undefined}>
              {email ?? "…"}
            </p>
            <SignOutButton
              onDone={() => setOpen(false)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-gray-400 transition hover:bg-red-500/10 hover:text-red-200 disabled:opacity-60"
            />
          </div>
          <ThemeSwitch className="mt-2" />
          <LanguageMenu placement="up" align="left" className="mt-1" />
        </div>
      </aside>
    </>
  );
}
