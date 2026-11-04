"use client";

// Shown in place of the progress screen when a video finishes while the
// creator is still on the page: play it right here. (It's also in Projects.)

import Link from "next/link";
import { CheckCircle2, Download, ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";

export default function FinishedVideo({
  title,
  url,
  projectId,
  vertical,
  onClose,
}: {
  title: string;
  url: string;
  projectId: string | null;
  vertical: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const download = `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(`${title}.mp4`)}`;
  return (
    <div ref={ref} className="scroll-mt-20 rounded-2xl border border-emerald-400/25 bg-[#0b1412] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-white">Your video is ready</p>
          <p className="truncate text-sm text-gray-400">{title} · also saved in Projects</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-white">
          <X size={16} />
        </button>
      </div>
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className={`mx-auto mt-4 rounded-xl bg-black ${vertical ? "max-h-[70vh] w-auto" : "w-full"}`}
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={download}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white"
        >
          <Download size={15} /> Download MP4
        </a>
        {projectId && (
          <Link
            href={`/projects/${projectId}?tab=publish`}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-200 hover:border-white/25"
          >
            <ExternalLink size={15} /> Open project &amp; publish
          </Link>
        )}
      </div>
    </div>
  );
}
