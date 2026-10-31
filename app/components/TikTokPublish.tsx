"use client";

// Post a finished video to the creator's TikTok account (Content Posting API,
// direct post). Follows TikTok's posting-UX rules: show the creator, let them
// pick visibility (no default), interaction toggles off by default and greyed
// out when the account disables them, music-usage consent before posting.

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Music2, Send } from "lucide-react";

interface Creator {
  creator_avatar_url?: string;
  creator_nickname?: string;
  creator_username?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
}

interface Post {
  publishId: string;
  status: string;
  privacy: string;
  displayName?: string;
  postedAt: string;
}

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

const MESSAGES: Record<string, string> = {
  connected: "TikTok connected.",
  cancelled: "Connecting TikTok was cancelled.",
  missing_permission: "Norveko needs permission to post videos. Connect again and allow it on TikTok's screen.",
  not_configured: "TikTok posting isn't enabled on this site yet.",
  error: "Couldn't connect TikTok. Please try again.",
};

export default function TikTokPublish({
  projectId,
  defaultCaption,
  initial,
}: {
  projectId: string;
  defaultCaption: string;
  initial: Post | null;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connected, setConnected] = useState<{ displayName: string | null } | null>(null);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState(defaultCaption.slice(0, 2200));
  const [privacy, setPrivacy] = useState("");
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [post, setPost] = useState<Post | null>(initial);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("tiktok");
    if (status) {
      setTimeout(() => (status === "connected" ? setNotice(MESSAGES.connected) : setError(MESSAGES[status] ?? MESSAGES.error)), 0);
      params.delete("tiktok");
      const q = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
    fetch("/api/tiktok")
      .then((r) => r.json())
      .then((d) => {
        setAvailable(Boolean(d.available));
        setConnected(d.connection ?? null);
      })
      .catch(() => setAvailable(false));
  }, []);

  async function openForm() {
    setOpen(true);
    setError("");
    setCreator(null);
    const d = await fetch("/api/tiktok?creator=1").then((r) => r.json()).catch(() => null);
    if (d?.creator) setCreator(d.creator);
    else if (d && !d.connection) setConnected(null);
    else setError("Couldn't load your TikTok account. Please try again.");
  }

  if (!available && !post) return null;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/tiktok`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption, privacy, allowComment, allowDuet, allowStitch, consent }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.code === "not_connected") setConnected(null);
        throw new Error(data.error || "Posting failed.");
      }
      setPost(data.tiktok);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Posting failed.");
    } finally {
      setBusy(false);
    }
  }

  const connectHref = `/api/tiktok/connect?returnTo=${encodeURIComponent(`/projects/${projectId}`)}`;
  const toggle = (label: string, value: boolean, set: (v: boolean) => void, disabled: boolean) => (
    <label className={`flex items-center gap-2 text-sm ${disabled ? "text-gray-600" : "text-gray-300"}`}>
      <input type="checkbox" checked={value && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-pink-500" />
      {label}
      {disabled && <span className="text-xs">(off in your TikTok settings)</span>}
    </label>
  );

  return (
    <div className="mt-4 rounded-2xl border border-pink-400/25 bg-gradient-to-br from-pink-500/[0.07] to-cyan-500/[0.04] p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-500/15">
            <Music2 size={20} className="text-pink-300" aria-hidden />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Post to TikTok</h3>
            <p className="text-xs text-gray-400">
              {connected ? <>Posts to <span className="text-gray-200">{connected.displayName || "your account"}</span></> : "Send this video to your TikTok account."}
            </p>
          </div>
        </div>
        {!connected ? (
          <a href={connectHref} className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-pink-500">
            <Music2 size={15} aria-hidden /> Connect TikTok
          </a>
        ) : !open ? (
          <button type="button" onClick={openForm} className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-pink-500">
            <Send size={15} aria-hidden /> {post ? "Post again" : "Post"}
          </button>
        ) : null}
      </div>

      {notice && <p className="mt-3 rounded-xl border border-green-400/30 bg-green-500/10 p-3 text-sm text-green-300">{notice}</p>}

      {post && !open && (
        <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0d16] p-4 text-sm">
          <span className="flex items-center gap-2 text-green-300">
            <CheckCircle2 size={16} aria-hidden />
            {post.status === "PUBLISH_COMPLETE" ? "Posted to TikTok" : "Sent to TikTok — it may take a few minutes to appear on your profile"}
            {" · "}
            {PRIVACY_LABEL[post.privacy] ?? post.privacy}
          </span>
        </div>
      )}

      {connected && open && (
        <div className="mt-5 space-y-4">
          {!creator && !error && (
            <p className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={15} className="animate-spin" aria-hidden /> Loading your TikTok account…
            </p>
          )}
          {creator && (
            <>
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0d0d16] p-3">
                {creator.creator_avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={creator.creator_avatar_url} alt="" className="h-9 w-9 rounded-full" />
                ) : (
                  <span className="h-9 w-9 rounded-full bg-pink-500/20" />
                )}
                <div>
                  <p className="text-sm font-semibold text-white">{creator.creator_nickname || connected.displayName}</p>
                  {creator.creator_username && <p className="text-xs text-gray-500">@{creator.creator_username}</p>}
                </div>
              </div>
              <div>
                <label htmlFor="tt-caption" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Caption</label>
                <textarea
                  id="tt-caption"
                  rows={4}
                  maxLength={2200}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-pink-400/50"
                />
              </div>
              <div>
                <label htmlFor="tt-privacy" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Who can view this video</label>
                <select
                  id="tt-privacy"
                  value={privacy}
                  onChange={(e) => setPrivacy(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-pink-400/50"
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  {creator.privacy_level_options.map((p) => (
                    <option key={p} value={p}>
                      {PRIVACY_LABEL[p] ?? p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                {toggle("Allow comments", allowComment, setAllowComment, creator.comment_disabled)}
                {toggle("Allow Duet", allowDuet, setAllowDuet, creator.duet_disabled)}
                {toggle("Allow Stitch", allowStitch, setAllowStitch, creator.stitch_disabled)}
              </div>
              <p className="text-xs text-gray-500">The post is labelled as AI-generated content on TikTok.</p>
              <label className="flex items-start gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-pink-500" />
                <span>
                  By posting, you agree to TikTok&apos;s{" "}
                  <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="text-pink-300 underline">
                    Music Usage Confirmation
                  </a>
                  .
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy || !privacy || !consent}
                  onClick={submit}
                  className="inline-flex items-center gap-2 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pink-500 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
                  {busy ? "Posting… up to a minute" : "Post to TikTok"}
                </button>
                {!busy && (
                  <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:text-white">
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
