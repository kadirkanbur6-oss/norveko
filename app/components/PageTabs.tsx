"use client";

// Section tabs for long pages (Settings, Billing…): one panel at a time keeps
// pages short. The active tab lives in ?tab= so links and reloads keep it.

import { useCallback, useEffect, useState, type ReactNode } from "react";

export interface PageTab {
  id: string;
  label: string;
  icon?: ReactNode;
}

export function useTabParam(tabs: PageTab[], fallback: string): [string, (id: string) => void] {
  const [tab, setTab] = useState(fallback);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("tab");
    if (id && tabs.some((t) => t.id === id)) {
      const t = setTimeout(() => setTab(id), 0);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const select = useCallback((id: string) => {
    setTab(id);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", id);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }, []);
  return [tab, select];
}

export default function PageTabs({ tabs, active, onChange }: { tabs: PageTab[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="nv-no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-white/[0.07] px-1">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={`relative flex shrink-0 items-center gap-2 px-3 pb-3 pt-2 text-sm transition ${
              on ? "font-medium text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {t.icon}
            {t.label}
            {on && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-gradient-to-r from-blue-400 to-purple-500" />}
          </button>
        );
      })}
    </div>
  );
}

/** Quiet page title used on every app page. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
