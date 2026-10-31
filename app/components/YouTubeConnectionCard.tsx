"use client";

// Settings: connect / disconnect the YouTube channel used for direct uploads.

import { useEffect, useState } from "react";
import { Loader2, SquarePlay, Unplug } from "lucide-react";

interface Connection {
  channelId: string;
  channelTitle: string | null;
  channelThumbnail: string | null;
}

const MESSAGES: Record<string, string> = {
  connected: "YouTube connected — you can now publish finished videos from any project.",
  cancelled: "Connecting YouTube was cancelled.",
  missing_permission: "Please allow Norveko to upload videos on the Google screen.",
  no_channel: "That Google account has no YouTube channel yet. Create one on youtube.com, then connect again.",
  not_configured: "YouTube publishing isn't enabled on this site yet.",
  error: "Couldn't connect YouTube. Please try again.",
};

export default function YouTubeConnectionCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("youtube");
    if (status) {
      setTimeout(() => setMessage({ ok: status === "connected", text: MESSAGES[status] ?? MESSAGES.error }), 0);
      window.history.replaceState(null, "", window.location.pathname);
    }
    fetch("/api/youtube")
      .then((r) => r.json())
      .then((d) => {
        setAvailable(Boolean(d.available));
        setConnection(d.connection ?? null);
      })
      .catch(() => setAvailable(false));
  }, []);

  if (!available) return null;

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/youtube", { method: "DELETE" });
      setConnection(null);
      setMessage({ ok: true, text: "YouTube disconnected. Norveko can no longer upload to your channel." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <SquarePlay size={18} className="text-red-400" aria-hidden />
        <h2 className="font-semibold">YouTube publishing</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        Connect your channel to publish finished videos straight from a project. Norveko can only upload — it can&apos;t
        delete or edit your existing videos.
      </p>

      {connection ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0d0d16] p-4">
          <div className="flex items-center gap-3">
            {connection.channelThumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connection.channelThumbnail} alt="" className="h-9 w-9 rounded-full" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-red-500/20" />
            )}
            <div>
              <p className="text-sm font-semibold">{connection.channelTitle || "Your channel"}</p>
              <p className="text-xs text-gray-500">Connected</p>
            </div>
          </div>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 transition hover:border-red-400/30 hover:text-red-300 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Unplug size={15} aria-hidden />}
            Disconnect
          </button>
        </div>
      ) : (
        <a
          href="/api/youtube/connect?returnTo=%2Fsettings"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500"
        >
          <SquarePlay size={16} aria-hidden /> Connect YouTube
        </a>
      )}

      {message && (
        <p
          className={`mt-3 rounded-xl border p-3 text-sm ${
            message.ok ? "border-green-400/30 bg-green-500/10 text-green-300" : "border-red-400/30 bg-red-500/10 text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
