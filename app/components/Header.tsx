'use client';

// Dashboard header: same quiet title as every other page, with project search
// and notifications. Account actions live in the sidebar.

import ProjectSearch from "./ProjectSearch";
import NotificationsMenu from "./NotificationsMenu";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function Header() {
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const email = data?.user?.email;
      if (email) setDisplayName(email.split("@")[0]);
    });
  }, []);

  return (
    <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">{displayName ? `Welcome back, ${displayName}.` : "Your workspace at a glance."}</p>
      </div>
      <div className="flex items-center gap-3">
        <ProjectSearch />
        <NotificationsMenu />
      </div>
    </header>
  );
}
