"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  FolderOpen,
  Loader2,
  Trash2,
} from "lucide-react";
import Sidebar from "../../components/Sidebar";

interface VideoScene {
  sceneNumber: number;
  description: string;
  videoPrompt: string;
}

interface VideoContent {
  hook: string;
  script: string;
  scenes: VideoScene[];
  titles: string[];
  description: string;
  tags: string[];
  thumbnailIdea: string;
}

interface Project {
  id: string;
  title: string;
  platform: string | null;
  style: string | null;
  duration: string | null;
  idea: string | null;
  content: VideoContent | null;
  status: string;
  created_at: string;
}

const TABS = [
  { id: "script", label: "Senaryo" },
  { id: "scenes", label: "Sahne Planı" },
  { id: "prompts", label: "Video Promptları" },
  { id: "titles", label: "Başlıklar" },
  { id: "description", label: "Açıklama" },
  { id: "tags", label: "Etiketler" },
  { id: "thumbnail", label: "Thumbnail" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("script");
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function loadProject() {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || "Proje yüklenemedi.");
        }

        setProject(data.project);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Bilinmeyen hata");
      } finally {
        setLoading(false);
      }
    }

    loadProject();
  }, [projectId]);

  function getTabText(tab: TabId): string {
    const content = project?.content;
    if (!content) return "";
    switch (tab) {
      case "script":
        return `HOOK:\n${content.hook}\n\nSENARYO:\n${content.script}`;
      case "scenes":
        return (content.scenes ?? [])
          .map((s) => `Sahne ${s.sceneNumber}: ${s.description}`)
          .join("\n\n");
      case "prompts":
        return (content.scenes ?? [])
          .map((s) => `Sahne ${s.sceneNumber}:\n${s.videoPrompt}`)
          .join("\n\n");
      case "titles":
        return (content.titles ?? []).join("\n");
      case "description":
        return content.description ?? "";
      case "tags":
        return (content.tags ?? []).join(", ");
      case "thumbnail":
        return content.thumbnailIdea ?? "";
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(getTabText(activeTab));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      "Bu projeyi silmek istediğine emin misin? Bu işlem geri alınamaz."
    );
    if (!confirmed) return;

    setDeleting(true);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Silme başarısız oldu.");
      }

      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
      setDeleting(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("tr-TR", {
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
          {/* Geri dön */}
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-sm text-gray-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Projelere Dön
          </Link>

          {loading ? (
            <div className="mt-16 flex justify-center">
              <Loader2 size={32} className="animate-spin text-blue-300" />
            </div>
          ) : error ? (
            <p className="mt-8 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </p>
          ) : project ? (
            <>
              {/* Başlık */}
              <div className="mt-6 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
                    <FolderOpen className="text-blue-300" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold">{project.title}</h1>
                    {project.idea && (
                      <p className="mt-1 text-sm text-gray-400">
                        {project.idea}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex shrink-0 items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
                >
                  {deleting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Trash2 size={16} />
                  )}
                  Sil
                </button>
              </div>

              {/* Etiketler */}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
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

              {/* İçerik */}
              {project.content ? (
                <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  {/* Sekmeler */}
                  <div className="flex flex-wrap gap-2">
                    {TABS.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`rounded-xl border px-4 py-2 text-sm transition ${
                          activeTab === tab.id
                            ? "border-blue-400/40 bg-blue-500/10 text-white"
                            : "border-white/10 bg-white/[0.03] text-gray-400 hover:text-white"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* Kopyala */}
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={handleCopy}
                      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-gray-300 transition hover:text-white"
                    >
                      {copied ? (
                        <Check size={16} className="text-green-400" />
                      ) : (
                        <Copy size={16} />
                      )}
                      {copied ? "Kopyalandı" : "Kopyala"}
                    </button>
                  </div>

                  <div className="mt-4 whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0d0d16] p-6 text-sm leading-relaxed text-gray-200">
                    {getTabText(activeTab)}
                  </div>
                </div>
              ) : (
                <p className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-gray-400">
                  Bu projede kayıtlı içerik bulunamadı.
                </p>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}