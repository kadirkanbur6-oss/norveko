"use client";

// Settings: connect / disconnect the Instagram professional account used for Reels.

import { useEffect, useState } from "react";
import { Camera, Loader2, Unplug } from "lucide-react";

const MESSAGES: Record<string, string> = {
  connected: "Instagram connected — you can now post vertical videos as Reels from any project.",
  cancelled: "Connecting Instagram was cancelled.",
  missing_permission: "Norveko needs permission to publish content. Connect again and allow it on Instagram's screen.",
  not_professional: "Reels can only be posted to a professional (Business or Creator) Instagram account. Switch it in the Instagram app, then connect again.",
  not_configured: "Instagram posting isn't enabled on this site yet.",
  error: "Couldn't connect Instagram. Please try again.",
};

export default function InstagramConnectionCard() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connection, setConnection] = useState<{ username: string | null; avatarUrl: string | null; expired?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("instagram");
    if (status) {
      setTimeout(() => setMessage({ ok: status === "connected", text: MESSAGES[status] ?? MESSAGES.error }), 0);
      window.history.replaceState(null, "", window.location.pathname + (params.get("tab") ? `?tab=${params.get("tab")}` : ""));
    }
    fetch("/api/instagram")
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
      await fetch("/api/instagram", { method: "DELETE" });
      setConnection(null);
      setMessage({ ok: true, text: "Instagram disconnected. You can also remove Norveko under Instagram → Settings → Apps and websites." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <Camera size={18} className="text-fuchsia-300" aria-hidden />
        <h2 className="font-semibold">Instagram Reels</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">Connect a professional Instagram account to post finished vertical videos as Reels.</p>
      {connection && !connection.expired ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#0d0d16] p-4">
          <div className="flex items-center gap-3">
            {connection.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={connection.avatarUrl} alt="" className="h-9 w-9 rounded-full" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-fuchsia-500/20" />
            )}
            <div>
              <p className="text-sm font-semibold">{connection.username ? `@${connection.username}` : "Your account"}</p>
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
          href="/api/instagram/connect?returnTo=%2Fsettings%3Ftab%3Dconnections"
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <Camera size={16} aria-hidden /> {connection?.expired ? "Reconnect Instagram" : "Connect Instagram"}
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
