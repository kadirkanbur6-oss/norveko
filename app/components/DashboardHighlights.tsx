"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Coins,
  FolderOpen,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";

interface Project {
  id: string;
  title: string;
  platform: string | null;
  created_at: string;
}

export default function DashboardHighlights() {
  const [credits, setCredits] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [creditsRes, projectsRes] = await Promise.all([
          fetch("/api/credits"),
          fetch("/api/projects"),
        ]);

        const creditsData = await creditsRes.json();
        const projectsData = await projectsRes.json();

        if (creditsData.success) {
          setCredits(creditsData.credits);
        }
        if (projectsData.success) {
          setProjects(projectsData.projects.slice(0, 3));
        }
      } catch {
        // Sections will just show empty states
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
    });
  }

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-3">
      {/* Quick action */}
      <div className="rounded-2xl border border-blue-400/30 bg-gradient-to-br from-blue-500/10 to-purple-600/10 p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/30 bg-blue-500/10">
          <Wand2 size={18} className="text-blue-300" />
        </div>
        <h3 className="mt-4 font-semibold">Create something new</h3>
        <p className="mt-1 text-sm text-gray-400">
          Turn your next idea into a full production package.
        </p>
        <Link
          href="/chat"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2.5 text-sm font-semibold transition hover:opacity-90"
        >
          <Sparkles size={16} />
          Generate content
        </Link>
      </div>

      {/* Credits */}
      <div className="rounded-2xl border border-yellow-400/20 bg-yellow-500/5 p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-yellow-400/30 bg-yellow-500/10">
          <Coins size={18} className="text-yellow-400" />
        </div>
        <h3 className="mt-4 font-semibold">Credit balance</h3>
        <p className="mt-1 text-3xl font-bold text-yellow-300">
          {loading ? (
            <Loader2 size={24} className="animate-spin text-yellow-400" />
          ) : (
            credits ?? 0
          )}
        </p>
        <Link
          href="/billing"
          className="mt-3 inline-flex items-center gap-1 text-sm text-gray-400 transition hover:text-white"
        >
          View billing
          <ArrowRight size={14} />
        </Link>
      </div>

      {/* Recent projects */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05]">
          <FolderOpen size={18} className="text-blue-300" />
        </div>
        <h3 className="mt-4 font-semibold">Recent projects</h3>

        {loading ? (
          <Loader2 size={20} className="mt-3 animate-spin text-blue-300" />
        ) : projects.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No projects yet — generate your first one.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block truncate rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm text-gray-300 transition hover:border-white/20 hover:text-white"
              >
                <span className="text-xs text-gray-500">
                  {formatDate(project.created_at)}
                </span>{" "}
                {project.title}
              </Link>
            ))}
          </div>
        )}

        <Link
          href="/projects"
          className="mt-3 inline-flex items-center gap-1 text-sm text-gray-400 transition hover:text-white"
        >
          All projects
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  );
}