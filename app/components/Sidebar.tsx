"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  FileText,
  FolderOpen,
  Layers,
  Sparkles,
  TrendingUp,
  Users,
  Wand2,
} from "lucide-react";

const navItems = [
  { label: "Dashboard", icon: BarChart3, href: "/" },
  { label: "AI Workspace", icon: Wand2, href: "/chat" },
  { label: "Projeler", icon: FolderOpen, href: "/projects" },
  { label: "AI Insights", icon: Sparkles, href: null },
  { label: "Content", icon: FileText, href: null },
  { label: "Audience", icon: Users, href: null },
  { label: "Growth", icon: TrendingUp, href: null },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-72 border-r border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10">
          <Layers className="text-blue-300" />
        </div>

        <div>
          <h1 className="text-2xl font-bold">NORVEKO</h1>
          <p className="text-xs text-gray-400">Creator Studio</p>
        </div>
      </div>

      <div className="mt-10">
        <p className="mb-4 text-sm uppercase tracking-[4px] text-gray-500">
          Menü
        </p>

        <div className="space-y-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.href !== null && pathname === item.href;

            if (item.href === null) {
              return (
                <div
                  key={item.label}
                  className="w-full cursor-not-allowed rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-4 text-left text-gray-600"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon size={18} />
                      {item.label}
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-gray-600">
                      Yakında
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={item.label}
                href={item.href}
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
    </aside>
  );
}