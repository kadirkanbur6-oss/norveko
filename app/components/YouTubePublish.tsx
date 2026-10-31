"use client";

// Publish a finished video straight to the creator's YouTube channel.
// Shown under "Final video" on the project page.

import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, ExternalLink, Loader2, Upload, SquarePlay } from "lucide-react";

type Privacy = "private" | "unlisted" | "public";

interface Upload {
  videoId: string;
  url: string;
  privacy: Privacy;
  channelTitle?: string;
  publishAt?: string;
  uploadedAt: string;
  privacyApplied?: boolean;
  thumbnailSet?: boolean;
}

interface Connection {
  channelId: string;
  channelTitle: string | null;
  channelThumbnail: string | null;
}

const PRIVACY: Array<{ id: Privacy; label: string; hint: string }> = [
  { id: "public", label: "Public", hint: "Everyone can watch" },
  { id: "unlisted", label: "Unlisted", hint: "Only people with the link" },
  { id: "private", label: "Private", hint: "Only you" },
];

const CONNECT_MESSAGES: Record<string, string> = {
  connected: "YouTube connected.",
  cancelled: "Connecting YouTube was cancelled.",
  missing_permission: "Please allow Norveko to upload videos on the Google screen.",
  no_channel: "That Google account has no YouTube channel yet. Create one on youtube.com, then connect again.",
  not_configured: "YouTube publishing isn't enabled on this site yet.",
  error: "Couldn't connect YouTube. Please try again.",
};

/** datetime-local value for "in two hours", in the viewer's time zone. */
function defaultSchedule(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function YouTubePublish({
  projectId,
  titles,
  description,
  tags,
  initial,
}: {
  projectId: string;
  titles: string[];
  description: string;
  tags: string[];
  initial: Upload | null;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [upload, setUpload] = useState<Upload | null>(initial);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(titles[0] ?? "");
  const [desc, setDesc] = useState(description);
  const [tagText, setTagText] = useState(tags.join(", "));
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [schedule, setSchedule] = useState(false);
  const [publishAt, setPublishAt] = useState(defaultSchedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("youtube");
    if (status) {
      const message = CONNECT_MESSAGES[status] ?? CONNECT_MESSAGES.error;
      setTimeout(() => {
        if (status === "connected") {
          setOpen(true);
          setNotice(message);
        } else setError(message);
      }, 0);
      params.delete("youtube");
      const q = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
    fetch("/api/youtube")
      .then((r) => r.json())
      .then((d) => {
        setAvailable(Boolean(d.available));
        setConnection(d.connection ?? null);
      })
      .catch(() => setAvailable(false));
  }, []);

  if (available === null || (!available && !upload)) return null;

  const connectHref = `/api/youtube/connect?returnTo=${encodeURIComponent(`/projects/${projectId}`)}`;

  async function publish(again = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/projects/${projectId}/youtube`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: desc,
          tags: tagText.split(",").map((t) => t.trim()).filter(Boolean),
          privacy,
          publishAt: schedule ? new Date(publishAt).toISOString() : null,
          again,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        if (data.code === "not_connected") setConnection(null);
        throw new Error(data.error || "Upload failed.");
      }
      setUpload(data.youtube);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-red-400/25 bg-gradient-to-br from-red-500/[0.08] to-transparent p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15">
            <SquarePlay size={20} className="text-red-400" aria-hidden />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Publish to YouTube</h3>
            <p className="text-xs text-gray-400">
              {connection
                ? <>Uploads to <span className="text-gray-200">{connection.channelTitle || "your channel"}</span></>
                : "Upload this video to your channel in one click."}
            </p>
          </div>
        </div>
        {!connection ? (
          <a href={connectHref} className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500">
            <SquarePlay size={15} aria-hidden /> Connect YouTube
          </a>
        ) : !open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500"
          >
            <Upload size={15} aria-hidden /> {upload ? "Upload again" : "Publish"}
          </button>
        ) : null}
      </div>

      {notice && <p className="mt-3 rounded-xl border border-green-400/30 bg-green-500/10 p-3 text-sm text-green-300">{notice}</p>}

      {upload && !open && (
        <div className="mt-4 rounded-xl border border-white/10 bg-[#0d0d16] p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-green-300">
              <CheckCircle2 size={16} aria-hidden />
              {upload.publishAt ? `Scheduled for ${new Date(upload.publishAt).toLocaleString()}` : `On YouTube · ${upload.privacy}`}
            </span>
            <a href={upload.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-red-300 hover:text-red-200">
              Open on YouTube <ExternalLink size={13} aria-hidden />
            </a>
          </div>
          {upload.privacyApplied === false && (
            <p className="mt-2 text-xs text-yellow-200/90">
              YouTube kept this upload private for now. Open it in YouTube Studio to change the visibility.
            </p>
          )}
          {upload.thumbnailSet === false && (
            <p className="mt-2 text-xs text-gray-400">
              The custom thumbnail wasn&apos;t applied (YouTube allows it only on verified channels). Download it from this page and set it in YouTube Studio.
            </p>
          )}
        </div>
      )}

      {connection && open && (
        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="yt-title" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Title</label>
            <input
              id="yt-title"
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-red-400/50"
            />
            {titles.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {titles.slice(0, 5).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTitle(t.slice(0, 100))}
                    className={`rounded-full border px-3 py-1 text-xs transition ${t === title ? "border-red-400/50 bg-red-500/15 text-red-100" : "border-white/10 text-gray-400 hover:text-white"}`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label htmlFor="yt-desc" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Description</label>
            <textarea
              id="yt-desc"
              rows={5}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-red-400/50"
            />
            <p className="mt-1 text-xs text-gray-500">Keep the music credit at the end — the track&apos;s license requires it.</p>
          </div>
          <div>
            <label htmlFor="yt-tags" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Tags (comma separated)</label>
            <input
              id="yt-tags"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-red-400/50"
            />
          </div>
          <fieldset>
            <legend className="mb-2 text-xs uppercase tracking-wider text-gray-500">Visibility</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {PRIVACY.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={privacy === p.id && !schedule}
                  onClick={() => {
                    setPrivacy(p.id);
                    setSchedule(false);
                  }}
                  className={`rounded-xl border p-3 text-left transition ${privacy === p.id && !schedule ? "border-red-400/50 bg-red-500/10" : "border-white/10 hover:border-white/25"}`}
                >
                  <span className="block text-sm font-semibold text-white">{p.label}</span>
                  <span className="block text-xs text-gray-400">{p.hint}</span>
                </button>
              ))}
            </div>
            <label className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-300">
              <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="h-4 w-4 accent-red-500" />
              <CalendarClock size={15} className="text-gray-400" aria-hidden />
              Schedule it
              {schedule && (
                <input
                  type="datetime-local"
                  value={publishAt}
                  onChange={(e) => setPublishAt(e.target.value)}
                  aria-label="Publish time"
                  className="rounded-lg border border-white/10 bg-[#12121c] px-2 py-1 text-sm text-white [color-scheme:dark]"
                />
              )}
            </label>
          </fieldset>
          <p className="text-xs text-gray-500">
            Norveko marks the upload as AI-generated content, as YouTube requires for realistic AI visuals and voices.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={busy || !title.trim()}
              onClick={() => publish(Boolean(upload))}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
              {busy ? "Uploading… this takes up to a minute" : schedule ? "Schedule on YouTube" : "Upload to YouTube"}
            </button>
            {!busy && (
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-gray-400 hover:text-white">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
