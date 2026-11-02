"use client";

// Settings → Team: one shared credit balance for several people.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Link2, Loader2, LogOut, Trash2, Users } from "lucide-react";

type Team = {
  role: "owner" | "member";
  team: { id: string; name: string; ownerId: string };
  members: Array<{ userId: string; email: string | null; joinedAt: string; you: boolean }>;
  invites: Array<{ id: string; createdAt: string; expiresAt: string }>;
};

export default function TeamCard() {
  const [state, setState] = useState<{ team: Team | null; canCreate: boolean; maxMembers: number } | null>(null);
  const [name, setName] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch("/api/team")
      .then((r) => r.json())
      .then((d) => d.success && setState({ team: d.team, canCreate: d.canCreate, maxMembers: d.maxMembers }))
      .catch(() => undefined);
  }, []);

  if (!state) return null;

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action + (extra.id ?? extra.userId ?? ""));
    setError("");
    try {
      const d = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) }).then((r) => r.json());
      if (!d.success) throw new Error(d.error || "Something went wrong.");
      setState((s) => (s ? { ...s, team: d.team ?? null, canCreate: action === "delete" || action === "leave" ? true : s.canCreate } : s));
      if (d.link) {
        setLink(d.link);
        setCopied(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy("");
      setConfirmDelete(false);
    }
  }

  const t = state.team;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-sky-300" aria-hidden />
        <h2 className="font-semibold">Team</h2>
      </div>
      <p className="mt-2 text-sm text-gray-400">
        Invite up to {state.maxMembers} people. Everyone signs in with their own account and keeps their own projects; videos use the team owner&apos;s credits.
      </p>

      {!t ? (
        state.canCreate ? (
          <div className="mt-4 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder="Team name, e.g. Tarih Kanalı"
              className="w-full rounded-xl border border-white/10 bg-[#12121c] px-3 py-2 text-sm text-white outline-none placeholder:text-gray-600 focus:border-sky-400/50"
            />
            <button
              type="button"
              onClick={() => act("create", { name })}
              disabled={busy !== ""}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === "create" && <Loader2 size={15} className="animate-spin" />} Create team
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">
            Teams are available on any plan or pack.{" "}
            <Link href="/billing" className="text-sky-300 hover:text-white">
              See plans
            </Link>
          </p>
        )
      ) : (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-white">
            <span className="font-semibold">{t.team.name}</span>{" "}
            <span className="text-xs text-gray-500">· {t.role === "owner" ? "you own this team" : "you're a member"}</span>
          </p>
          <ul className="space-y-2">
            {t.role === "member" && (
              <li className="rounded-xl border border-white/10 bg-[#0d0d16] px-4 py-2.5 text-sm text-gray-300">Owner pays for everyone&apos;s videos</li>
            )}
            {t.members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0d0d16] px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-200">
                  {m.email ?? "Member"} {m.you && <span className="text-xs text-gray-500">(you)</span>}
                </span>
                <span className="text-xs text-gray-500">joined {new Date(m.joinedAt).toLocaleDateString()}</span>
                {t.role === "owner" && (
                  <button
                    type="button"
                    onClick={() => act("remove", { userId: m.userId })}
                    disabled={busy !== ""}
                    aria-label={`Remove ${m.email ?? "member"}`}
                    className="text-gray-500 hover:text-red-300 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {t.role === "owner" && (
            <>
              {link && (
                <div className="rounded-xl border border-sky-300/30 bg-sky-400/[0.07] p-4">
                  <p className="text-sm text-sky-100">Send this link to the person you invite. It works once, for 7 days.</p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-black/40 px-3 py-2 font-mono text-xs text-white">{link}</code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(link);
                        setCopied(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
              {t.invites.length > 0 && (
                <p className="text-xs text-gray-500">
                  {t.invites.length} open invite{t.invites.length > 1 ? "s" : ""} ·{" "}
                  {t.invites.map((i) => (
                    <button key={i.id} type="button" onClick={() => act("revokeInvite", { id: i.id })} className="mr-2 text-gray-400 underline hover:text-white">
                      cancel one from {new Date(i.createdAt).toLocaleDateString()}
                    </button>
                  ))}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => act("invite")}
                  disabled={busy !== ""}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy === "invite" ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Create invite link
                </button>
                {confirmDelete ? (
                  <button type="button" onClick={() => act("delete")} className="rounded-xl border border-red-400/40 px-4 py-2 text-sm text-red-300">
                    Yes, delete the team
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-400 hover:text-red-300">
                    Delete team
                  </button>
                )}
              </div>
            </>
          )}
          {t.role === "member" && (
            <button
              type="button"
              onClick={() => act("leave")}
              disabled={busy !== ""}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-gray-300 hover:text-red-300 disabled:opacity-50"
            >
              <LogOut size={15} /> Leave the team
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
    </div>
  );
}
