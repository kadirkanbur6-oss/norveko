'use client';

import { Bell, ChevronDown, LogOut, Search, User } from "lucide-react";
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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <header className="flex items-center justify-between mb-10">
      <div>
        <h1 className="text-5xl font-bold">Dashboard</h1>

        <p className="mt-2 text-gray-400">
          Manage your AI content workflow in one place.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <Search size={18} className="text-gray-400" />

          <input
            placeholder="Search..."
            className="bg-transparent outline-none text-sm w-52"
          />
        </div>

        <button className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Bell size={18} />

          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-red-500"></span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 transition hover:border-violet-300/30"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-gray-300">
              <User size={18} />
            </div>

            <div className="text-left">
              <p className="font-semibold text-white">{displayName}</p>
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
                <span className="inline-block h-4 w-4 rounded-full bg-blue-400/50" />
                Change Channel
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="mt-2 flex w-full items-center gap-2 rounded-3xl px-4 py-3 text-sm text-white transition hover:bg-white/5"
              >
                <LogOut size={16} />
                Log out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}