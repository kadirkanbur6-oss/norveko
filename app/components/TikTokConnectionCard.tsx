"use client";

// Settings: connect / disconnect the TikTok account used for direct posts.

import { useEffect, useState } from "react";
import { Loader2, Music2, Unplug } from "lucide-react";

const MESSAGES: Record<string, string> = {
  connected: "TikTok connected — you can now post finished videos from any project.",
  cancelled: "Connecting TikTok was cancelled.",
  missing_permission: "Norveko needs permission to post videos. Connect again and allow it on TikTok's screen.",
  not_configured: "TikTok posting isn't enabled on this site yet.",
  error: "Couldn't connect TikTok. Please try again.",
};

export default function TikTokConnectionCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<{ displayName: string | null; avatarUrl: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("tiktok");
    if (status) {
      setTimeout(() => setMessage({ ok: status === "connected", text: MESSAGES[status] ?? MESSAGES.error }), 0);
      window.history.replaceState(null, "", window.location.pathname);
    }
    fetch("/api/tiktok")
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
      await fetch("/api/tiktok", { method: "DELETE" });
      setConnection(null);
      setMessage({ ok: true, text: "TikTok disconnected." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <Music2 size={18} className="text-pink-300" aria-hidden />
        <h2 className="font-semibold">TikTok posting</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">Connect your TikTok account to post finished videos straight from a project or a series.</p>
      {connection ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0d0d16] p-4">
          <div className="flex items-center gap-3">
            {connection.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connection.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-pink-500/20" />
            )}
            <div>
              <p className="text-sm font-semibold">{connection.displayName || "Your account"}</p>
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
        <a href="/api/tiktok/connect?returnTo=%2Fsettings" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-pink-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-pink-500">
          <Music2 size={16} aria-hidden /> Connect TikTok
        </a>
      )}
      {message && (
        <p className={`mt-3 rounded-xl border p-3 text-sm ${message.ok ? "border-green-400/30 bg-green-500/10 text-green-300" : "border-red-400/30 bg-red-500/10 text-red-300"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
