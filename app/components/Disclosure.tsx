"use client";

// A quiet collapsible section: title + one-line summary of the current choice.
// Keeps long forms short — details open only when someone wants to change them.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export default function Disclosure({
  title,
  summary,
  icon,
  defaultOpen = false,
  children,
  className = "",
}: {
  title: string;
  summary?: ReactNode;
  icon?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-2xl border border-white/[0.07] bg-white/[0.02] ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        {icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-gray-300">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-white">{title}</span>
          {summary && !open && <span className="mt-0.5 block truncate text-xs text-gray-500">{summary}</span>}
        </span>
        <ChevronDown size={16} className={`shrink-0 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && <div className="border-t border-white/[0.06] px-4 pb-4 pt-1">{children}</div>}
    </div>
  );
}
