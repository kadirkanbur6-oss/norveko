"use client";

// Project page → Publish: post the finished vertical video as an Instagram Reel.

import { useEffect, useState } from "react";
import { Camera, ExternalLink, Loader2 } from "lucide-react";

type Post = { mediaId: string; permalink?: string; username?: string; postedAt: string };

export default function InstagramPublish({
  projectId,
  defaultCaption,
  initial,
  vertical,
  watermarked,
}: {
  projectId: string;
  defaultCaption: string;
  initial: Post | null;
  vertical: boolean;
  watermarked: boolean;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<{ username: string | null; expired?: boolean } | null>(null);
  const [caption, setCaption] = useState(defaultCaption);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [post, setPost] = useState<Post | null>(initial);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/instagram")
      .then((r) => r.json())
      .then((d) => {
        setAvailable(Boolean(d.available));
        setConnection(d.connection ?? null);
      })
      .catch(() => setAvailable(false));
  }, []);

  if (!available) return null;

  async function publish() {
    setBusy(true);
    setError("");
    try {
      const d = await fetch(`/api/projects/${projectId}/instagram`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption, shareToFeed }),
      }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Couldn't post to Instagram.");
      setPost(d.instagram);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't post to Instagram.");
    } finally {
      setBusy(false);
    }
  }

  const ready = connection && !connection.expired;

  return (
    <div className="mt-6 rounded-2xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/[0.07] to-transparent p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Camera size={17} className="text-fuchsia-300" aria-hidden />
        <h3 className="text-sm font-semibold text-white">Post to Instagram Reels</h3>
        {ready && connection.username && <span className="text-xs text-gray-500">as @{connection.username}</span>}
      </div>

      {post && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-green-400/30 bg-green-500/10 p-3 text-sm text-green-200">
          Posted {new Date(post.postedAt).toLocaleString()}.
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
              Open on Instagram <ExternalLink size={13} aria-hidden />
            </a>
          )}
        </p>
      )}

      {!vertical ? (
        <p className="mt-2 text-xs text-gray-400">Reels are vertical. Cut a Short from this video (above), then post the Short from its own page.</p>
      ) : watermarked ? (
        <p className="mt-2 text-xs text-gray-400">Free-trial videos carry the Norveko badge and can&apos;t be posted. Remove it with any plan or pack.</p>
      ) : !ready ? (
        <a
          href={`/api/instagram/connect?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=publish`)}`}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <Camera size={15} aria-hidden /> {connection?.expired ? "Reconnect Instagram" : "Connect Instagram"}
        </a>
      ) : (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="mb-1 flex justify-between text-xs text-gray-400">
              <span>Caption</span>
              <span>{caption.length}/2200</span>
            </span>
            <textarea
              rows={4}
              maxLength={2200}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-fuchsia-400/50"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={shareToFeed} onChange={(e) => setShareToFeed(e.target.checked)} />
            Also show it on my profile grid
          </label>
          <button
            type="button"
            onClick={publish}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Camera size={15} aria-hidden />}
            {busy ? "Posting — Instagram is processing the video…" : post ? "Post again" : "Post Reel"}
          </button>
          <p className="text-xs text-gray-500">Instagram labels AI-generated content automatically where required. Up to 25 posts a day.</p>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
