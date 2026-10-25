"use client";

// app/components/NotificationsMenu.tsx
// Bell button + dropdown fed by /api/notifications. The unread dot shows only
// when there is an item newer than the last time the menu was opened
// (timestamp kept in localStorage; purely a per-browser convenience).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  Coins,
  Gift,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { NotificationItem } from "@/lib/notifications-types";

const SEEN_KEY = "norveko:notifications-seen";

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function writeSeen(ts: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(ts));
  } catch {
    // ignore
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Icon({ kind }: { kind: NotificationItem["kind"] }) {
  switch (kind) {
    case "job_completed":
      return <CheckCircle2 size={16} className="text-green-400" />;
    case "job_failed":
      return <XCircle size={16} className="text-red-400" />;
    case "purchase":
      return <Coins size={16} className="text-yellow-400" />;
    case "refund":
      return <RotateCcw size={16} className="text-blue-300" />;
    case "welcome":
      return <Gift size={16} className="text-green-400" />;
  }
}

export default function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState(false);
  const [seenAt, setSeenAt] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Initial load (deferred so the effect does not set state synchronously).
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      setSeenAt(readSeen());
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        const data = await res.json();
        if (active && data?.success) setItems(data.items);
        else if (active) setError(true);
      } catch {
        if (active) setError(true);
      }
    }, 0);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const newest = items?.[0] ? Date.parse(items[0].created_at) : 0;
  const unreadCount = (items ?? []).filter((i) => Date.parse(i.created_at) > seenAt).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && newest) {
      writeSeen(newest);
      // Keep the dot visible until the menu closes so the user sees what was new.
      setTimeout(() => setSeenAt(newest), 300);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} new` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-violet-300/30"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[#070B17]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/95 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <p className="text-sm font-semibold text-white">Notifications</p>
            <span className="text-xs text-gray-500">Last {items?.length ?? 0}</span>
          </div>

          <div className="max-h-[22rem] overflow-y-auto p-2">
            {items === null && !error && (
              <div className="flex justify-center py-8">
                <Loader2 size={18} className="animate-spin text-blue-300" />
              </div>
            )}

            {error && (
              <p className="px-3 py-6 text-center text-sm text-gray-400">
                Couldn&apos;t load notifications.
              </p>
            )}

            {items && items.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-gray-400">
                Nothing yet. Generate your first content package and results will show up here.
              </p>
            )}

            {items?.map((item) => {
              const isNew = Date.parse(item.created_at) > seenAt;
              const inner = (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    <Icon kind={item.kind} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm text-white">
                      <span className="truncate">{item.title}</span>
                      {isNew && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
                    </p>
                    {item.detail && (
                      <p className="mt-0.5 truncate text-xs text-gray-400">{item.detail}</p>
                    )}
                    <p className="mt-1 text-[11px] text-gray-500">{timeAgo(item.created_at)}</p>
                  </div>
                </div>
              );
              const cls =
                "block rounded-2xl px-3 py-2.5 transition hover:bg-white/5 " +
                (isNew ? "bg-white/[0.03]" : "");
              return item.href ? (
                <Link key={item.id} href={item.href} onClick={() => setOpen(false)} className={cls}>
                  {inner}
                </Link>
              ) : (
                <div key={item.id} className={cls}>
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
