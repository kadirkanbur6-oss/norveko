"use client";

// app/components/LanguageMenu.tsx
// Language picker for the site itself (14 Nov 2026). Sits in the landing navbar between
// FAQ and the theme switch, in the app sidebar, and floats bottom-right on pages that
// have no header of their own. The choice is applied by SiteTranslator.

import { useEffect, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { SITE_LANGUAGES, siteLanguage } from "@/lib/i18n/languages";
import { setSiteLanguage, useSiteLanguage } from "@/lib/i18n/store";

export default function LanguageMenu({
  className = "",
  placement = "down",
  align = "right",
  floating = false,
}: {
  className?: string;
  /** Where the list opens: below the button (navbar) or above it (sidebar, floating). */
  placement?: "down" | "up";
  align?: "left" | "right";
  floating?: boolean;
}) {
  const lang = useSiteLanguage();
  const current = siteLanguage(lang);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={`relative ${className}`} data-lang-menu translate="no" {...(floating ? { "data-lang-floating": true } : {})}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Language: ${current.english}. Change language`}
        title="Language"
        className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-sm text-gray-400 transition hover:bg-white/[0.06] hover:text-white ${
          floating ? "border border-white/10 bg-[var(--nv-panel)] shadow-lg shadow-black/30" : ""
        }`}
      >
        <Globe size={16} aria-hidden />
        <span>{current.label}</span>
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Language"
          className={`nv-no-scrollbar absolute z-50 max-h-80 w-52 overflow-y-auto rounded-xl border border-white/10 bg-[var(--nv-panel)] p-1 shadow-xl shadow-black/40 ${
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2"
          } ${align === "left" ? "left-0" : "right-0"}`}
        >
          {SITE_LANGUAGES.map((l) => {
            const selected = l.code === current.code;
            return (
              <li key={l.code} role="option" aria-selected={selected}>
                <button
                  type="button"
                  lang={l.code}
                  onClick={() => {
                    setSiteLanguage(l.code);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-white/[0.06] ${
                    selected ? "text-white" : "text-gray-300"
                  }`}
                >
                  <span aria-hidden>{l.flag}</span>
                  <span className="flex-1">{l.label}</span>
                  {selected && <Check size={14} aria-hidden className="text-blue-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
