'use client';

import { ChevronDown, Search, Settings, User } from "lucide-react";
import NotificationsMenu from "./NotificationsMenu";
import SignOutButton from "./SignOutButton";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";

export default function Header() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("User");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    async function loadUser() {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        return;
      }

      const email = data?.user?.email;
      if (email) {
        setDisplayName(email.split("@")[0]);
      }
    }

    loadUser();
  }, []);

  return (
    <header className="mb-8 flex flex-col gap-5 lg:mb-10 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl lg:text-5xl">Dashboard</h1>

        <p className="mt-2 text-gray-400">
          Manage your AI content workflow in one place.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:flex-none">
          <Search size={18} className="text-gray-400" />

          <input
            placeholder="Search..."
            className="w-full min-w-0 bg-transparent text-sm outline-none sm:w-52"
          />
        </div>

        <NotificationsMenu />

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:border-violet-300/30"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-gray-300">
              <User size={18} />
            </div>

            <div className="hidden text-left sm:block">
              <p className="max-w-[10rem] truncate font-semibold text-white">{displayName}</p>
            </div>

            <ChevronDown size={18} className="text-gray-400" />
          </button>

          {menuOpen ? (
            <div className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <button
                type="button"
                onClick={() => {
                  router.push("/settings");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-3xl px-4 py-3 text-sm text-white transition hover:bg-white/5"
              >
                <Settings size={16} />
                Settings
              </button>
              <SignOutButton
                onDone={() => setMenuOpen(false)}
                className="mt-2 flex w-full items-center gap-2 rounded-3xl px-4 py-3 text-sm text-white transition hover:bg-white/5 disabled:opacity-60"
              />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}