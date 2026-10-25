"use client";

// app/components/ExportMenu.tsx
// "Export" dropdown for a project: copy everything as Markdown, or download
// .md / .txt (narration) / .srt + .vtt (word-timed when the project has a
// voiceover, otherwise estimated from reading speed).

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, Download, FileText } from "lucide-react";
import {
  contentToMarkdown,
  contentToPlainText,
  contentToSrt,
  contentToVtt,
  hasTimedCaptions,
  type ProjectContent,
} from "@/lib/project-content";

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "norveko-project"
  );
}

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ExportMenu({
  title,
  content,
}: {
  title: string;
  content: ProjectContent;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const base = slug(title);

  async function copyAll() {
    await navigator.clipboard.writeText(contentToMarkdown(title, content));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    setOpen(false);
  }

  const items = [
    {
      label: copied ? "Copied!" : "Copy everything",
      icon: copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />,
      onClick: copyAll,
    },
    {
      label: "Download Markdown (.md)",
      icon: <FileText size={14} />,
      onClick: () => {
        download(`${base}.md`, contentToMarkdown(title, content), "text/markdown");
        setOpen(false);
      },
    },
    {
      label: "Download narration (.txt)",
      icon: <FileText size={14} />,
      onClick: () => {
        download(`${base}.txt`, contentToPlainText(content), "text/plain");
        setOpen(false);
      },
    },
    {
      label: "Download subtitles (.srt)",
      icon: <FileText size={14} />,
      onClick: () => {
        download(`${base}.srt`, contentToSrt(content), "application/x-subrip");
        setOpen(false);
      },
    },
    {
      label: "Download subtitles (.vtt)",
      icon: <FileText size={14} />,
      onClick: () => {
        download(`${base}.vtt`, contentToVtt(content), "text/vtt");
        setOpen(false);
      },
    },
  ];
  const timed = hasTimedCaptions(content);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-300 transition hover:text-white"
      >
        <Download size={16} />
        Export
        <ChevronDown size={14} className="text-gray-500" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={item.onClick}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-gray-200 transition hover:bg-white/5 hover:text-white"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <p className="px-3 pb-1.5 pt-2 text-[11px] leading-snug text-gray-500">
            {timed
              ? `Subtitles are word-timed from the voiceover (${content.captions!.length} cues).`
              : "No voiceover: subtitle timings are estimated from reading speed — adjust in your editor."}
          </p>
        </div>
      )}
    </div>
  );
}
