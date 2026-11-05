"use client";

// Section tabs for long pages (Settings, Billing…): one panel at a time keeps
// pages short. The active tab lives in ?tab= so links and reloads keep it.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

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
  // On phones the tab row scrolls sideways: fade the edge that hides more tabs and keep
  // the active tab in view, so "Connected channels" or "Invite & earn" aren't lost off-screen.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () =>
      setEdges({ left: row.scrollLeft > 4, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 4 });
    update();
    row.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      row.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [tabs.length]);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !el) return;
    const left = el.offsetLeft - 16;
    const right = el.offsetLeft + el.offsetWidth + 16 - row.clientWidth;
    if (row.scrollLeft > left) row.scrollTo({ left, behavior: "smooth" });
    else if (row.scrollLeft < right) row.scrollTo({ left: right, behavior: "smooth" });
  }, [active]);

  return (
    <div className="relative">
      <div ref={rowRef} role="tablist" className="nv-no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b border-white/[0.07] px-1">
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
      {edges.left && <div aria-hidden className="pointer-events-none absolute inset-y-0 -left-1 w-8 bg-gradient-to-r from-[#0a0a12] to-transparent" />}
      {edges.right && <div aria-hidden className="pointer-events-none absolute inset-y-0 -right-1 w-10 bg-gradient-to-l from-[#0a0a12] to-transparent" />}
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
