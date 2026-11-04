"use client";

// Settings → API: create and revoke keys for the Norveko API (/developers).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";

type KeyRow = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };

export default function ApiKeysCard() {
  const [state, setState] = useState<{ allowed: boolean; max: number; keys: KeyRow[] } | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => d.success && setState({ allowed: d.allowed, max: d.max, keys: d.keys }))
      .catch(() => undefined);
  }, []);

  if (!state) return null;

  async function create() {
    setBusy("create");
    setError("");
    try {
      const d = await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Could not create the key.");
      setFresh(d.key);
      setCopied(false);
      setName("");
      setState((s) => (s ? { ...s, keys: [...s.keys, d.record] } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the key.");
    } finally {
      setBusy("");
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    try {
      await fetch(`/api/keys?id=${id}`, { method: "DELETE" });
      setState((s) => (s ? { ...s, keys: s.keys.filter((k) => k.id !== id) } : s));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-amber-300" aria-hidden />
        <h2 className="font-semibold">API keys</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        Make videos from your own tools and automations. Videos made with the API use your credits like the workspace does.{" "}
        <Link href="/developers" className="text-sky-300 hover:text-white">
          Read the API guide
        </Link>
      </p>

      {!state.allowed ? (
        <p className="mt-4 text-sm text-gray-400">
          The API is available on any plan or pack.{" "}
          <Link href="/billing" className="text-sky-300 hover:text-white">
            See plans
          </Link>
        </p>
      ) : (
        <>
          {fresh && (
            <div className="mt-4 rounded-xl border border-amber-300/30 bg-amber-400/[0.07] p-4">
              <p className="text-sm font-medium text-amber-100">Copy your new key now — it won&apos;t be shown again.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-white">{fresh}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(fresh);
                    setCopied(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
          {state.keys.length > 0 && (
            <ul className="mt-4 space-y-2">
              {state.keys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#0d0d16] px-4 py-3 text-sm">
                  <span className="font-medium text-white">{k.name}</span>
                  <code className="font-mono text-xs text-gray-400">{k.prefix}…</code>
                  <span className="text-xs text-gray-500">
                    {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString("en-US")}` : "never used"}
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(k.id)}
                    disabled={busy === k.id}
                    aria-label={`Revoke ${k.name}`}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-gray-400 hover:text-red-300 disabled:opacity-50"
                  >
                    {busy === k.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          {state.keys.length < state.max && (
            <div className="mt-4 flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Key name, e.g. Zapier"
                className="w-full rounded-xl border border-white/10 bg-[#12121c] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400/50"
              />
              <button
                type="button"
                onClick={create}
                disabled={busy !== ""}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === "create" ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />} Create key
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
