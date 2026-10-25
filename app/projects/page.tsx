"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, FolderOpen, Loader2, Search, Trash2, Wand2, X } from "lucide-react";
import Sidebar from "../components/Sidebar";
import ConfirmDialog from "../components/ConfirmDialog";

interface Project {
  id: string;
  title: string;
  platform: string | null;
  style: string | null;
  duration: string | null;
  idea: string | null;
  status: string;
  created_at: string;
}

const PAGE_SIZE = 24;

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("all");
  const [style, setStyle] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/projects");
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to load projects.");
      }

      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      void loadProjects();
    }, 0);
    return () => clearTimeout(id);
  }, [loadProjects]);

  async function handleDelete(id: string) {
    setDeletingId(id);

    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to delete.");
      }

      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDeletingId(null);
      setPendingDelete(null);
    }
  }

  const platforms = useMemo(
    () => Array.from(new Set(projects.map((p) => p.platform).filter(Boolean))) as string[],
    [projects]
  );
  const styles = useMemo(
    () => Array.from(new Set(projects.map((p) => p.style).filter(Boolean))) as string[],
    [projects]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const list = projects.filter((p) => {
      if (platform !== "all" && p.platform !== platform) return false;
      if (style !== "all" && p.style !== style) return false;
      if (!terms.length) return true;
      const hay = `${p.title} ${p.idea ?? ""} ${p.platform ?? ""} ${p.style ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    list.sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const d = Date.parse(a.created_at) - Date.parse(b.created_at);
      return sort === "oldest" ? d : -d;
    });
    return list;
  }, [projects, query, platform, style, sort]);

  const shown = filtered.slice(0, visible);
  const hasFilters = query.trim() !== "" || platform !== "all" || style !== "all";

  function resetFilters() {
    setQuery("");
    setPlatform("all");
    setStyle("all");
    setVisible(PAGE_SIZE);
  }

  const selectClass =
    "rounded-xl border border-white/10 bg-[#0d0d16] px-3 py-2 text-sm text-gray-200 outline-none focus:border-blue-400/50";

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
              <FolderOpen className="text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Projects</h1>
              <p className="text-sm text-gray-400">
                Your saved video projects
              </p>
            </div>
          </div>

          {!loading && projects.length > 0 && (
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-[#0d0d16] px-3 py-2 focus-within:border-blue-400/50">
                <Search size={16} className="shrink-0 text-gray-500" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setVisible(PAGE_SIZE);
                  }}
                  placeholder="Search title or idea…"
                  aria-label="Search projects"
                  className="w-full min-w-0 bg-transparent text-sm text-white outline-none placeholder:text-gray-500"
                />
                {query && (
                  <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-gray-500 hover:text-white">
                    <X size={14} />
                  </button>
                )}
              </label>
              {platforms.length > 1 && (
                <select value={platform} onChange={(e) => { setPlatform(e.target.value); setVisible(PAGE_SIZE); }} aria-label="Filter by platform" className={selectClass}>
                  <option value="all">All platforms</option>
                  {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              {styles.length > 1 && (
                <select value={style} onChange={(e) => { setStyle(e.target.value); setVisible(PAGE_SIZE); }} aria-label="Filter by style" className={selectClass}>
                  <option value="all">All styles</option>
                  {styles.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-400">
                <ArrowUpDown size={14} />
                <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort projects" className={selectClass}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="title">Title A–Z</option>
                </select>
              </label>
            </div>
          )}

          {error && (
            <p className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </p>
          )}

          {loading ? (
            <div className="mt-16 flex justify-center">
              <Loader2 size={32} className="animate-spin text-blue-300" />
            </div>
          ) : projects.length === 0 ? (
            <div className="mt-16 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center sm:p-12">
              <FolderOpen size={40} className="mx-auto text-gray-500" />
              <p className="mt-4 text-gray-400">No saved projects yet.</p>
              <Link
                href="/chat"
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3 font-semibold text-white transition hover:opacity-90"
              >
                <Wand2 size={18} />
                Generate Your First Project
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
              <p className="text-gray-400">No projects match your filters.</p>
              <button type="button" onClick={resetFilters} className="mt-4 text-sm text-blue-300 hover:text-blue-200">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <p className="text-xs text-gray-500">
                Showing {shown.length} of {filtered.length}{hasFilters ? " matching" : ""} project{filtered.length === 1 ? "" : "s"}
              </p>
              {shown.map((project) => (
                <div
                  key={project.id}
                  className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition focus-within:border-blue-400/40 hover:border-blue-400/40 hover:bg-white/[0.05]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <Link
                      href={`/projects/${project.id}`}
                      className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-blue-400/60"
                    >
                      <h2 className="truncate text-lg font-semibold">
                        {project.title}
                      </h2>
                      {project.idea && (
                        <p className="mt-1 truncate text-sm text-gray-400">
                          {project.idea}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {project.platform && (
                          <span className="rounded-lg border border-blue-400/30 bg-blue-500/10 px-2 py-1 text-blue-200">
                            {project.platform}
                          </span>
                        )}
                        {project.style && (
                          <span className="rounded-lg border border-purple-400/30 bg-purple-500/10 px-2 py-1 text-purple-200">
                            {project.style}
                          </span>
                        )}
                        {project.duration && (
                          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-gray-300">
                            {project.duration}
                          </span>
                        )}
                        <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-gray-400">
                          {formatDate(project.created_at)}
                        </span>
                      </div>
                    </Link>

                    <button
                      type="button"
                      onClick={() => setPendingDelete(project)}
                      disabled={deletingId === project.id}
                      className="relative z-10 flex shrink-0 items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
                    >
                      {deletingId === project.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                      Delete
                    </button>
                  </div>
                </div>
              ))}

              {visible < filtered.length && (
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="w-full rounded-2xl border border-white/10 bg-white/[0.03] py-3 text-sm text-gray-300 transition hover:border-white/20 hover:text-white"
                >
                  Load {Math.min(PAGE_SIZE, filtered.length - visible)} more
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this project?"
        message={pendingDelete ? `"${pendingDelete.title}" and its generated content will be removed. This cannot be undone.` : ""}
        confirmLabel="Delete project"
        danger
        busy={deletingId !== null}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete.id)}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}