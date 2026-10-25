"use client";

// app/components/ProjectSearch.tsx
// Dashboard search box: filters the user's projects by title / idea /
// platform as you type, with keyboard navigation. Loads the project list once
// (same /api/projects the Projects page uses) and matches client-side.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, Search } from "lucide-react";

interface ProjectHit {
  id: string;
  title: string;
  platform: string | null;
  idea: string | null;
  created_at: string;
}

const MAX_RESULTS = 8;

export default function ProjectSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [projects, setProjects] = useState<ProjectHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load once, lazily, the first time the box is focused.
  useEffect(() => {
    if (!focused || projects !== null || loading) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setProjects(data?.success ? data.projects : []);
      } catch {
        if (!cancelled) setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [focused, projects, loading]);

  // "/" focuses the search from anywhere on the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!focused) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [focused]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !projects) return [];
    const terms = q.split(/\s+/);
    return projects
      .filter((p) => {
        const hay = `${p.title} ${p.idea ?? ""} ${p.platform ?? ""}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, MAX_RESULTS);
  }, [query, projects]);

  const open = focused && query.trim().length > 0;

  function go(id: string) {
    setFocused(false);
    setQuery("");
    router.push(`/projects/${id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].id);
    } else if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={wrapRef} className="relative min-w-0 flex-1 sm:flex-none">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 transition focus-within:border-violet-300/30">
        {loading ? (
          <Loader2 size={18} className="animate-spin text-gray-400" />
        ) : (
          <Search size={18} className="text-gray-400" />
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder="Search projects…"
          aria-label="Search projects"
          role="combobox"
          aria-expanded={open}
          aria-controls="project-search-results"
          className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-gray-500 sm:w-52"
        />
        <kbd className="hidden rounded-md border border-white/10 px-1.5 text-[10px] text-gray-500 sm:block">/</kbd>
      </div>

      {open && (
        <div
          id="project-search-results"
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-2 overflow-hidden rounded-[20px] border border-white/10 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:left-auto sm:w-80"
        >
          {projects === null && (
            <p className="px-3 py-4 text-sm text-gray-400">Loading projects…</p>
          )}
          {projects !== null && results.length === 0 && (
            <p className="px-3 py-4 text-sm text-gray-400">
              No projects match &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          {results.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(p.id)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                i === active ? "bg-white/[0.06]" : "hover:bg-white/5"
              }`}
            >
              <FolderOpen size={16} className="mt-0.5 shrink-0 text-blue-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-white">{p.title}</span>
                <span className="block truncate text-xs text-gray-400">
                  {p.platform ? `${p.platform} · ` : ""}
                  {new Date(p.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </span>
            </button>
          ))}
          {results.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFocused(false);
                router.push("/projects");
              }}
              className="mt-1 block w-full rounded-xl px-3 py-2 text-left text-xs text-gray-500 transition hover:bg-white/5 hover:text-gray-300"
            >
              See all projects →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
