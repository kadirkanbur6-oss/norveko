"use client";

import { useState } from "react";
import { Check, Copy, FolderPlus, Loader2, Sparkles, Wand2 } from "lucide-react";
import Sidebar from "../components/Sidebar";

const PLATFORMS = ["YouTube Shorts", "TikTok", "Instagram Reels", "YouTube Uzun Video"];
const STYLES = ["Gizem", "Belgesel", "Korku", "Eğitici", "Reklam", "Sinematik"];
const DURATIONS = ["30 saniye", "60 saniye", "3 dakika", "8 dakika"];

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

export default function ChatPage() {
  const [idea, setIdea] = useState("");
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [style, setStyle] = useState(STYLES[0]);
  const [duration, setDuration] = useState(DURATIONS[1]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState<VideoContent | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("script");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleGenerate() {
    if (idea.trim().length < 5) {
      setError("Lütfen video fikrini biraz daha detaylı yaz.");
      return;
    }

    setLoading(true);
    setError("");
    setContent(null);
    setSaved(false);
    setSaveError("");

    try {
      const res = await fetch("/api/generate-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idea, platform, style, duration }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Üretim başarısız oldu.");
      }

      setContent(data.content);
      setActiveTab("script");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!content) return;

    setSaving(true);
    setSaveError("");

    try {
      const projectTitle =
        content.titles?.[0]?.trim() || idea.trim().slice(0, 80);

      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: projectTitle,
          platform,
          style,
          duration,
          idea,
          content,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Kaydetme başarısız oldu.");
      }

      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSaving(false);
    }
  }

  function getTabText(tab: TabId): string {
    if (!content) return "";
    switch (tab) {
      case "script":
        return `HOOK:\n${content.hook}\n\nSENARYO:\n${content.script}`;
      case "scenes":
        return content.scenes
          .map((s) => `Sahne ${s.sceneNumber}: ${s.description}`)
          .join("\n\n");
      case "prompts":
        return content.scenes
          .map((s) => `Sahne ${s.sceneNumber}:\n${s.videoPrompt}`)
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

  return (
    <div className="flex min-h-screen bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="flex-1 p-8">
        <div className="mx-auto max-w-4xl">
          {/* Başlık */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
              <Wand2 className="text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">AI Workspace</h1>
              <p className="text-sm text-gray-400">
                Fikrini yaz, üretim paketini al
              </p>
            </div>
          </div>

          {/* Form */}
          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <label className="text-sm text-gray-400">Video Fikri</label>
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="Örn: Bermuda Şeytan Üçgeni'nde kaybolan uçakların gizemi..."
              rows={3}
              className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] p-4 text-white placeholder-gray-500 outline-none focus:border-blue-400/50"
            />

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <label className="text-sm text-gray-400">Platform</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-white outline-none focus:border-blue-400/50"
                >
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Stil</label>
                <select
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-white outline-none focus:border-blue-400/50"
                >
                  {STYLES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-gray-400">Süre</label>
                <select
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-white outline-none focus:border-blue-400/50"
                >
                  {DURATIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={loading}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 py-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Üretiliyor... (30-60 saniye sürebilir)
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  Üret
                </>
              )}
            </button>

            {error && (
              <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </p>
            )}
          </div>

          {/* Sonuçlar */}
          {content && (
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

              {/* Aksiyon butonları */}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={handleSave}
                  disabled={saving || saved}
                  className="flex items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-60"
                >
                  {saving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : saved ? (
                    <Check size={16} className="text-green-400" />
                  ) : (
                    <FolderPlus size={16} />
                  )}
                  {saving ? "Kaydediliyor..." : saved ? "Kaydedildi" : "Projeye Kaydet"}
                </button>

                <button
                  onClick={handleCopy}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-gray-300 transition hover:text-white"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                  {copied ? "Kopyalandı" : "Kopyala"}
                </button>
              </div>

              {saveError && (
                <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">
                  {saveError}
                </p>
              )}

              {/* İçerik */}
              <div className="mt-4 whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0d0d16] p-6 text-sm leading-relaxed text-gray-200">
                {getTabText(activeTab)}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}