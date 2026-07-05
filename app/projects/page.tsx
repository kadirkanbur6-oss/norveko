"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, Trash2, Wand2 } from "lucide-react";
import Sidebar from "../components/Sidebar";

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

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
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
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation(); // Prevent card click

    const confirmed = window.confirm(
      "Are you sure you want to delete this project? This cannot be undone."
    );
    if (!confirmed) return;

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
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="flex-1 p-8">
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
            <div className="mt-16 rounded-2xl border border-white/10 bg-white/[0.03] p-12 text-center">
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
          ) : (
            <div className="mt-8 space-y-4">
              {projects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => router.push(`/projects/${project.id}`)}
                  className="cursor-pointer rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-blue-400/40 hover:bg-white/[0.05]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
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
                    </div>

                    <button
                      onClick={(e) => handleDelete(e, project.id)}
                      disabled={deletingId === project.id}
                      className="flex shrink-0 items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
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
            </div>
          )}
        </div>
      </main>
    </div>
  );
}