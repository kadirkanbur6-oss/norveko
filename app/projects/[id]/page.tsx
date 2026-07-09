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
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import Sidebar from "../../components/Sidebar";

interface VideoScene {
  sceneNumber: number;
  description: string;
  videoPrompt: string;
}

interface VideoContent {
  hook?: string;
  script?: string;
  scenes?: VideoScene[];
  titles?: string[];
  description?: string;
  tags?: string[];
  thumbnailIdea?: string;
  thumbnailUrl?: string;
  voiceoverUrl?: string;
  audio_url?: string;
  voiceover?: {
    url?: string;
    publicUrl?: string;
    downloadUrl?: string;
    audio_url?: string;
    storagePath?: string;
    fileName?: string;
  };
}

interface NormalizedVideoContent {
  hook: string;
  script: string;
  scenes: VideoScene[];
  titles: string[];
  description: string;
  tags: string[];
  thumbnailIdea: string;
  thumbnailUrl?: string;
  voiceoverUrl?: string;
  audio_url?: string;
  voiceover?: {
    url?: string;
    publicUrl?: string;
    downloadUrl?: string;
    audio_url?: string;
    storagePath?: string;
    fileName?: string;
  };
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
  { id: "script", label: "Script" },
  { id: "scenes", label: "Scene Plan" },
  { id: "prompts", label: "Video Prompts" },
  { id: "titles", label: "Titles" },
  { id: "description", label: "Description" },
  { id: "tags", label: "Tags" },
  { id: "thumbnail", label: "Thumbnail" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function normalizeContent(
  content: VideoContent | null | undefined
): NormalizedVideoContent {
  if (!content) {
    return {
      hook: "",
      script: "",
      scenes: [],
      titles: [],
      description: "",
      tags: [],
      thumbnailIdea: "",
    };
  }

  return {
    ...content,
    hook: content.hook ?? "",
    script: content.script ?? "",
    scenes: Array.isArray(content.scenes) ? content.scenes : [],
    titles: Array.isArray(content.titles) ? content.titles : [],
    description: content.description ?? "",
    tags: Array.isArray(content.tags) ? content.tags : [],
    thumbnailIdea: content.thumbnailIdea ?? "",
  };
}

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

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState<NormalizedVideoContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    async function loadProject() {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to load project.");
        }

        setProject({
          ...data.project,
          content: data.project?.content
            ? normalizeContent(data.project.content as VideoContent)
            : null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    loadProject();
  }, [projectId]);

  function startEditing() {
    if (!project?.content) return;
    setEditTitle(project.title);
    // Deep copy so the original stays intact
    setEditContent(JSON.parse(JSON.stringify(normalizeContent(project.content))));
    setEditing(true);
    setSaveMessage("");
  }

  function cancelEditing() {
    setEditing(false);
    setEditContent(null);
    setSaveMessage("");
  }

  async function handleSave() {
    if (!editContent) return;

    setSaving(true);
    setSaveMessage("");

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          content: editContent,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to save.");
      }

      // Update local state
      setProject((prev) =>
        prev ? { ...prev, title: editTitle.trim(), content: editContent } : prev
      );
      setEditing(false);
      setSaveMessage("Changes saved ✓");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (err) {
      setSaveMessage(
        err instanceof Error ? err.message : "An unknown error occurred."
      );
    } finally {
      setSaving(false);
    }
  }

  function getTabText(tab: TabId): string {
    const content = project?.content ? normalizeContent(project.content) : null;
    if (!content) return "";
    switch (tab) {
      case "script":
        return `HOOK:\n${content.hook}\n\nSCRIPT:\n${content.script}`;
      case "scenes":
        return content.scenes
          .map((s) => `Scene ${s.sceneNumber}: ${s.description}`)
          .join("\n\n");
      case "prompts":
        return content.scenes
          .map((s) => `Scene ${s.sceneNumber}:\n${s.videoPrompt}`)
          .join("\n\n");
      case "titles":
        return content.titles.join("\n");
      case "description":
        return content.description;
      case "tags":
        return content.tags.join(", ");
      case "thumbnail":
        return content.thumbnailIdea;
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(getTabText(activeTab));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      "Are you sure you want to delete this project? This cannot be undone."
    );
    if (!confirmed) return;

    setDeleting(true);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to delete.");
      }

      router.push("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setDeleting(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-blue-400/50";
  const labelClass = "mb-1 block text-xs uppercase tracking-wider text-gray-500";

  const normalizedProjectContent = project?.content
    ? normalizeContent(project.content)
    : null;

  const voiceoverUrl =
    normalizedProjectContent?.voiceoverUrl ??
    normalizedProjectContent?.audio_url ??
    normalizedProjectContent?.voiceover?.url ??
    normalizedProjectContent?.voiceover?.publicUrl ??
    normalizedProjectContent?.voiceover?.downloadUrl ??
    normalizedProjectContent?.voiceover?.audio_url ??
    null;

  function renderEditForm() {
    if (!editContent) return null;

    return (
      <div className="mt-8 space-y-6 rounded-2xl border border-blue-400/30 bg-white/[0.03] p-6">
        <div>
          <label className={labelClass}>Project Title</label>
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>Hook</label>
          <textarea
            value={editContent.hook}
            onChange={(e) =>
              setEditContent({ ...editContent, hook: e.target.value })
            }
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <label className={labelClass}>Script (Voice-over)</label>
          <textarea
            value={editContent.script}
            onChange={(e) =>
              setEditContent({ ...editContent, script: e.target.value })
            }
            rows={8}
            className={`${inputClass} resize-y`}
          />
        </div>

        <div>
          <label className={labelClass}>Scenes</label>
          <div className="space-y-4">
            {editContent.scenes.map((scene, index) => (
              <div
                key={index}
                className="rounded-xl border border-white/10 bg-[#0d0d16] p-4"
              >
                <p className="mb-2 text-xs font-semibold text-blue-300">
                  Scene {scene.sceneNumber}
                </p>
                <label className={labelClass}>Description</label>
                <textarea
                  value={scene.description}
                  onChange={(e) => {
                    const scenes = [...editContent.scenes];
                    scenes[index] = {
                      ...scenes[index],
                      description: e.target.value,
                    };
                    setEditContent({ ...editContent, scenes });
                  }}
                  rows={2}
                  className={`${inputClass} mb-3 resize-none`}
                />
                <label className={labelClass}>Video Prompt (English)</label>
                <textarea
                  value={scene.videoPrompt}
                  onChange={(e) => {
                    const scenes = [...editContent.scenes];
                    scenes[index] = {
                      ...scenes[index],
                      videoPrompt: e.target.value,
                    };
                    setEditContent({ ...editContent, scenes });
                  }}
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <label className={labelClass}>
            Title Options (one per line)
          </label>
          <textarea
            value={editContent.titles.join("\n")}
            onChange={(e) =>
              setEditContent({
                ...editContent,
                titles: e.target.value.split("\n"),
              })
            }
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <label className={labelClass}>Description</label>
          <textarea
            value={editContent.description}
            onChange={(e) =>
              setEditContent({ ...editContent, description: e.target.value })
            }
            rows={4}
            className={`${inputClass} resize-y`}
          />
        </div>

        <div>
          <label className={labelClass}>Tags (comma separated)</label>
          <textarea
            value={editContent.tags.join(", ")}
            onChange={(e) =>
              setEditContent({
                ...editContent,
                tags: e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter((t) => t.length > 0),
              })
            }
            rows={2}
            className={`${inputClass} resize-none`}
          />
        </div>

        <div>
          <label className={labelClass}>Thumbnail Idea</label>
          <textarea
            value={editContent.thumbnailIdea}
            onChange={(e) =>
              setEditContent({ ...editContent, thumbnailIdea: e.target.value })
            }
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </div>

        {/* Save / Cancel */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Save size={18} />
            )}
            {saving ? "Saving..." : "Save"}
          </button>
          <button
            onClick={cancelEditing}
            disabled={saving}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3 text-gray-300 transition hover:text-white disabled:opacity-50"
          >
            <X size={18} />
            Cancel
          </button>
        </div>

        {saveMessage && (
          <p className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center text-sm text-gray-300">
            {saveMessage}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="flex-1 p-8">
        <div className="mx-auto max-w-4xl">
          {/* Back link */}
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-sm text-gray-400 transition hover:text-white"
          >
            <ArrowLeft size={16} />
            Back to Projects
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
              {/* Header */}
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

                <div className="flex shrink-0 gap-2">
                  {!editing && project.content && (
                    <button
                      onClick={startEditing}
                      className="flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200 transition hover:bg-blue-500/20"
                    >
                      <Pencil size={16} />
                      Edit
                    </button>
                  )}
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/15 disabled:opacity-50"
                  >
                    {deleting ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <Trash2 size={16} />
                    )}
                    Delete
                  </button>
                </div>
              </div>

              {/* Meta tags */}
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

              {saveMessage && !editing && (
                <p className="mt-4 rounded-xl border border-green-400/30 bg-green-500/10 p-3 text-sm text-green-300">
                  {saveMessage}
                </p>
              )}

              {/* Content: edit mode or view mode */}
              {editing ? (
                renderEditForm()
              ) : project.content ? (
                <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  {/* Tabs */}
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

                  {/* Copy */}
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
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="mt-4 whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0d0d16] p-6 text-sm leading-relaxed text-gray-200">
                    {getTabText(activeTab)}
                  </div>

                  {voiceoverUrl && (
                    <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0d16] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-gray-300">
                          Voiceover
                        </h4>
                        <a
                          href={voiceoverUrl}
                          download
                          className="text-xs text-blue-300 transition hover:text-blue-200"
                        >
                          Download MP3
                        </a>
                      </div>
                      <audio controls src={voiceoverUrl} className="mt-3 w-full" />
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-gray-400">
                  No content found in this project.
                </p>
              )}
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}