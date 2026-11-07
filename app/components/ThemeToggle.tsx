"use client";

// app/components/ThemeToggle.tsx
// Light / dark switch. The choice lives in localStorage ("nv_theme") and on <html data-theme>;
// app/layout.tsx applies it before the first paint so the page never flashes the wrong theme.
// Dark is the default (the brand look); "Light" flips the palette in app/globals.css.

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

export type Theme = "dark" | "light";
export const THEME_KEY = "nv_theme";

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent("nv-theme", { detail: theme }));
}

function subscribe(onChange: () => void) {
  window.addEventListener("nv-theme", onChange);
  return () => window.removeEventListener("nv-theme", onChange);
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, current, () => "dark");
}

/** Navbar button: icon plus the mode it switches to, so nobody has to hunt for it.
 *  `labelClass` controls when the words show (e.g. "hidden sm:inline"). */
export default function ThemeToggle({ className = "", labelClass = "" }: { className?: string; labelClass?: string }) {
  const theme = useTheme();
  const next: Theme = theme === "light" ? "dark" : "light";
  const label = next === "light" ? "Light mode" : "Dark mode";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-sm text-gray-400 transition hover:bg-white/[0.06] hover:text-white ${className}`}
    >
      {next === "dark" ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
      <span className={labelClass}>{label}</span>
    </button>
  );
}

/** Two-option segmented control (sidebar). */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const opt = (value: Theme, label: string, Icon: typeof Sun) => (
    <button
      type="button"
      role="radio"
      aria-checked={theme === value}
      onClick={() => setTheme(value)}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
        theme === value ? "bg-white/[0.08] text-white" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      <Icon size={13} aria-hidden />
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Theme" className={`flex gap-1 rounded-xl bg-white/[0.03] p-1 ${className}`}>
      {opt("dark", "Dark", Moon)}
      {opt("light", "Light", Sun)}
    </div>
  );
}
