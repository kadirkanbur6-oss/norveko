"use client";

// app/admin/AdminActions.tsx
// The parts of the admin panel that change things: the per-user "Manage"
// dialog (credits, access, suspend, password reset, delete) and the per-job
// buttons (stop & refund, retry render, nudge). All go through
// POST /api/admin/actions; the page reloads its data afterwards.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Ban, Coins, KeyRound, Loader2, ShieldCheck, Trash2, X } from "lucide-react";

export interface ManagedUser {
  id: string;
  email: string;
  credits: number;
  admin: boolean;
  suspended: boolean;
  access: { beta: boolean; fullVideo: boolean; note: string | null; envBeta: boolean; envFullVideo: boolean };
}

export async function adminAction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch("/api/admin/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; logError?: string | null } & Record<string, unknown>;
  if (!res.ok || !json.success) throw new Error(json.error || `Request failed (${res.status}).`);
  if (json.logError) console.warn("[admin] action not logged:", json.logError);
  return json;
}

const BTN = "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const BTN_NEUTRAL = `${BTN} border-white/[0.09] bg-white/[0.04] text-gray-200 hover:bg-white/[0.08]`;
const BTN_DANGER = `${BTN} border-red-400/30 bg-red-400/10 text-red-200 hover:bg-red-400/20`;
const BTN_PRIMARY = `${BTN} border-transparent bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:brightness-110`;
const INPUT = "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20";

function Notice({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-3 py-2 text-xs ${tone === "error" ? "border-red-400/30 bg-red-400/10 text-red-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}
    >
      {children}
    </p>
  );
}

function Toggle({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint?: string }) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <span>
        <span className="block text-sm text-white">{label}</span>
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${checked ? "bg-violet-500" : "bg-white/15"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${checked ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/* ------------------------------------------------------------------ user dialog */

export function ManageUserDialog({ user, onClose, onChanged }: { user: ManagedUser; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [credits, setCredits] = useState(user.credits);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [beta, setBeta] = useState(user.access.beta);
  const [fullVideo, setFullVideo] = useState(user.access.fullVideo);
  const [suspended, setSuspended] = useState(user.suspended);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleted, setDeleted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("input,button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(label: string, body: Record<string, unknown>, after?: (r: Record<string, unknown>) => void) {
    setBusy(label);
    setError(null);
    setOk(null);
    try {
      const r = await adminAction({ ...body, userId: user.id });
      after?.(r);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const amountNumber = Math.trunc(Number(amount));
  const amountOk = Number.isFinite(amountNumber) && amountNumber !== 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-user-title"
        className="nv-no-scrollbar max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0f1020] p-5 shadow-2xl sm:rounded-3xl sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="manage-user-title" className="truncate text-lg font-semibold text-white">
              {user.email || "(no email)"}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
              <span className="font-mono">{user.id}</span>
              {user.admin && (
                <span className="inline-flex items-center gap-1 text-violet-300">
                  <ShieldCheck size={12} /> admin
                </span>
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
        {ok && <div className="mb-3"><Notice tone="ok">{ok}</Notice></div>}

        {deleted ? (
          <Notice tone="ok">Account deleted.</Notice>
        ) : (
          <div className="space-y-5">
            {/* ---- credits ---- */}
            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-medium text-white">
                <Coins size={15} className="text-amber-300" /> Credits
                <span className="ml-auto text-sm tabular-nums text-gray-300">{credits.toLocaleString("en-US")} now</span>
              </h3>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!amountOk) return;
                  run("credits", { action: "credits", amount: amountNumber, note }, (r) => {
                    setCredits(Number(r.credits));
                    setOk(`${amountNumber > 0 ? "Added" : "Removed"} ${Math.abs(amountNumber).toLocaleString("en-US")} credits.`);
                    setAmount("");
                    setNote("");
                  });
                }}
              >
                <input
                  type="number"
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="+100 or −50"
                  aria-label="Credits to add (negative to remove)"
                  className={`${INPUT} sm:w-32`}
                />
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (shown in the user's history)" aria-label="Reason" maxLength={300} className={INPUT} />
                <button type="submit" disabled={busy !== null || !amountOk || !note.trim()} className={`${BTN_PRIMARY} justify-center`}>
                  {busy === "credits" ? <Loader2 size={14} className="animate-spin" /> : null} Apply
                </button>
              </form>
            </section>

            {/* ---- access ---- */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-white">Access</h3>
              <Toggle
                label="Beta account"
                hint={user.access.envBeta ? "Also in BETA_USER_IDS (env). That stays on regardless." : "Generate while the launch lock is on; no watermark; API & teams."}
                checked={beta}
                disabled={busy !== null}
                onChange={(v) => {
                  setBeta(v);
                  run("access", { action: "access", beta: v }, () => setOk(v ? "Beta access granted." : "Beta access removed."));
                }}
              />
              <Toggle
                label="Full video"
                hint={user.access.envFullVideo ? "Also in FULL_VIDEO_BETA_USER_IDS (env)." : "One sentence → MP4, skits, talking characters, swaps, series."}
                checked={fullVideo}
                disabled={busy !== null}
                onChange={(v) => {
                  setFullVideo(v);
                  run("access", { action: "access", fullVideo: v }, () => setOk(v ? "Full-video access granted." : "Full-video access removed."));
                }}
              />
              <p className="text-xs text-gray-500">Changes reach every server within a minute.</p>
            </section>

            {/* ---- account ---- */}
            <section className="space-y-2">
              <h3 className="text-sm font-medium text-white">Account</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run("resetPassword", { action: "resetPassword" }, (r) => setOk(`Password reset e-mail sent to ${String(r.email)}.`))}
                  className={BTN_NEUTRAL}
                >
                  {busy === "resetPassword" ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Send password reset
                </button>
                {!user.admin && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      const next = !suspended;
                      if (next && !window.confirm(`Suspend ${user.email}? They can't sign in until you lift it; running jobs are stopped and refunded.`)) return;
                      run("suspend", { action: "suspend", suspended: next }, () => {
                        setSuspended(next);
                        setOk(next ? "Account suspended." : "Suspension lifted.");
                      });
                    }}
                    className={suspended ? BTN_NEUTRAL : BTN_DANGER}
                  >
                    {busy === "suspend" ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} {suspended ? "Lift suspension" : "Suspend account"}
                  </button>
                )}
              </div>
              {suspended && (
                <p className="flex items-center gap-1.5 text-xs text-amber-300">
                  <AlertTriangle size={13} /> This account is suspended. Sign-in is refused.
                </p>
              )}
            </section>

            {/* ---- delete ---- */}
            {!user.admin && (
              <section className="space-y-2 rounded-2xl border border-red-400/20 bg-red-400/[0.04] p-3">
                <h3 className="flex items-center gap-2 text-sm font-medium text-red-200">
                  <Trash2 size={15} /> Delete account
                </h3>
                <p className="text-xs text-gray-400">
                  Removes the user, their projects, videos, connections and credits for good. The subscription (if any) is cancelled at Paddle. Type the e-mail to confirm.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder={user.email} aria-label="Type the e-mail to confirm deletion" className={INPUT} autoComplete="off" />
                  <button
                    type="button"
                    disabled={busy !== null || confirmDelete.trim().toLowerCase() !== user.email.toLowerCase()}
                    onClick={() => run("deleteUser", { action: "deleteUser", confirm: confirmDelete.trim() }, () => setDeleted(true))}
                    className={`${BTN_DANGER} justify-center`}
                  >
                    {busy === "deleteUser" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ job buttons */

export function JobActions({ job, onChanged }: { job: { id: string; table: "pipeline" | "skit" | "swap"; status: string; canRetryRender: boolean }; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(label: string, body: Record<string, unknown>, okText: string) {
    setBusy(label);
    setError(null);
    try {
      await adminAction({ ...body, id: job.id, table: job.table });
      setDone(okText);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  if (done) return <span className="text-xs text-emerald-300">{done}</span>;
  const running = job.status === "running";
  if (!running && !job.canRetryRender) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {running && (
        <>
          <button type="button" disabled={busy !== null} onClick={() => run("nudge", { action: "nudge" }, "Nudged")} className={BTN_NEUTRAL} title="Re-trigger a job that looks stuck">
            {busy === "nudge" ? <Loader2 size={12} className="animate-spin" /> : null} Nudge
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              const note = window.prompt("Stop this job and refund its unfinished steps. Reason (optional):", "");
              if (note === null) return;
              run("failJob", { action: "failJob", note }, "Stopped & refunded");
            }}
            className={BTN_DANGER}
          >
            {busy === "failJob" ? <Loader2 size={12} className="animate-spin" /> : null} Stop & refund
          </button>
        </>
      )}
      {job.canRetryRender && (
        <button type="button" disabled={busy !== null} onClick={() => run("retryRender", { action: "retryRender" }, "Render queued")} className={BTN_NEUTRAL} title="Free: the visuals exist, only the final render failed">
          {busy === "retryRender" ? <Loader2 size={12} className="animate-spin" /> : null} Retry render
        </button>
      )}
      {error && <span className="basis-full text-right text-xs text-red-300">{error}</span>}
    </div>
  );
}
