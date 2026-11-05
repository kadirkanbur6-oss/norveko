// app/api/admin/actions/route.ts
// Admin panel actions (owner only, lib/admin.ts). Every call is written to
// `admin_actions` (SQL in supabase/README.md) so there is a record of who did
// what. POST { action, ... }:
//
//   credits        { userId, amount, note }       add (or take back, negative) credits
//   access         { userId, beta?, fullVideo?, note? }  grants (lib/access.ts → user_access)
//   suspend        { userId, suspended }          Supabase auth ban on/off (sign-in refused)
//   resetPassword  { userId }                     e-mail a password reset link
//   deleteUser     { userId, confirm: <email> }   permanent deletion (lib/account.ts)
//   failJob        { table, id }                  stop a running job and refund unfinished steps
//   retryRender    { id }                         retry a video whose final render failed (free)
//   nudge          { table, id }                  re-trigger a job that looks stuck
//
// `table` is "pipeline" | "skit" | "swap".

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";
import { adminDb } from "@/lib/api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = Record<string, unknown>;
const TABLES = { pipeline: "pipeline_jobs", skit: "skit_jobs", swap: "swap_jobs" } as const;
type Table = keyof typeof TABLES;

const MAX_CREDITS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const uuid = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : "");

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://norveko.app").replace(/\/$/, "");
}

async function log(db: SupabaseClient, entry: { admin_id: string; action: string; target_user_id?: string | null; target_id?: string | null; amount?: number | null; note?: string | null; detail?: Record<string, unknown> | null }) {
  const { error } = await db.from("admin_actions").insert({ ...entry, created_at: new Date().toISOString() });
  // A missing table must not block the action itself; the response says so.
  return error ? error.message : null;
}

async function targetUser(db: SupabaseClient, userId: string) {
  const { data } = await db.auth.admin.getUserById(userId);
  return data?.user ?? null;
}

export async function POST(req: NextRequest) {
  const { user: admin } = await requireUser();
  if (!admin || !isAdmin(admin)) return bad("Not found.", 404);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Invalid request.");
  }
  const action = str(body.action, 40);
  const db = adminDb();
  const note = str(body.note, 300) || null;

  try {
    switch (action) {
      // ---------------------------------------------------------------- credits
      case "credits": {
        const userId = uuid(body.userId);
        const amount = Math.trunc(Number(body.amount));
        if (!userId) return bad("Pick a user.");
        if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > MAX_CREDITS) return bad(`Amount must be between −${MAX_CREDITS} and ${MAX_CREDITS}, not 0.`);
        if (!note) return bad("Write a short note. It appears in the user's credit history.");
        const target = await targetUser(db, userId);
        if (!target) return bad("User not found.", 404);
        const { error } = await db.rpc("add_credits", {
          p_user_id: userId,
          p_amount: amount,
          p_type: "admin",
          p_reason: `Admin adjustment: ${note}`,
        });
        if (error) throw new Error(error.message);
        const { data: bal } = await db.from("user_credits").select("credits").eq("user_id", userId).maybeSingle();
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: userId, amount, note });
        return NextResponse.json({ success: true, credits: Number(bal?.credits ?? 0), logError });
      }

      // ----------------------------------------------------------------- access
      case "access": {
        const userId = uuid(body.userId);
        if (!userId) return bad("Pick a user.");
        const target = await targetUser(db, userId);
        if (!target) return bad("User not found.", 404);
        const patch: { beta?: boolean; full_video?: boolean; note?: string | null } = {};
        if (typeof body.beta === "boolean") patch.beta = body.beta;
        if (typeof body.fullVideo === "boolean") patch.full_video = body.fullVideo;
        if (body.note !== undefined) patch.note = note;
        if (!Object.keys(patch).length) return bad("Nothing to change.");
        const { setAccess } = await import("@/lib/access");
        const access = await setAccess(db, userId, patch, admin.id);
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: userId, note, detail: patch });
        return NextResponse.json({ success: true, access: { beta: access.beta, fullVideo: access.full_video, note: access.note }, logError });
      }

      // ---------------------------------------------------------------- suspend
      case "suspend": {
        const userId = uuid(body.userId);
        const suspended = body.suspended === true;
        if (!userId) return bad("Pick a user.");
        if (userId === admin.id) return bad("You can't suspend your own account.");
        const target = await targetUser(db, userId);
        if (!target) return bad("User not found.", 404);
        if (isAdmin(target)) return bad("Admins can't be suspended from here.");
        // A ban makes Supabase refuse sign-in and token refresh; "none" lifts it.
        const { error } = await db.auth.admin.updateUserById(userId, { ban_duration: suspended ? "876000h" : "none" });
        if (error) throw new Error(error.message);
        if (suspended) {
          // Stop anything still running on their behalf (credits refunded as usual).
          const { failJob } = await import("@/lib/pipeline/runner");
          const { data: running } = await db.from("pipeline_jobs").select("id").eq("user_id", userId).eq("status", "running");
          for (const j of running ?? []) await failJob(String(j.id), "Stopped: account suspended.");
        }
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: userId, note, detail: { suspended } });
        return NextResponse.json({ success: true, suspended, logError });
      }

      // ----------------------------------------------------------- resetPassword
      case "resetPassword": {
        const userId = uuid(body.userId);
        if (!userId) return bad("Pick a user.");
        const target = await targetUser(db, userId);
        if (!target?.email) return bad("This account has no e-mail address.", 404);
        const { error } = await db.auth.resetPasswordForEmail(target.email, {
          redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
        });
        if (error) throw new Error(error.message);
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: userId });
        return NextResponse.json({ success: true, email: target.email, logError });
      }

      // ------------------------------------------------------------- deleteUser
      case "deleteUser": {
        const userId = uuid(body.userId);
        if (!userId) return bad("Pick a user.");
        if (userId === admin.id) return bad("You can't delete your own account from here. Use Settings.");
        const target = await targetUser(db, userId);
        if (!target) return bad("User not found.", 404);
        if (isAdmin(target)) return bad("Admins can't be deleted from here.");
        if (!target.email || str(body.confirm, 320).toLowerCase() !== target.email.toLowerCase()) return bad("Type the user's e-mail address to confirm.");
        const { deleteAccount, AccountBusyError, SubscriptionCancelError } = await import("@/lib/account");
        try {
          await deleteAccount(userId);
        } catch (err) {
          if (err instanceof AccountBusyError) return bad(err.message, 409);
          if (err instanceof SubscriptionCancelError) return bad(err.message, 502);
          throw err;
        }
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: userId, note: target.email });
        return NextResponse.json({ success: true, logError });
      }

      // ---------------------------------------------------------------- failJob
      case "failJob": {
        const table = str(body.table, 20) as Table;
        const id = uuid(body.id);
        if (!TABLES[table] || !id) return bad("Pick a job.");
        const message = note ? `Stopped by admin: ${note}` : "Stopped by admin. Unused credits were refunded.";
        let stopped = false;
        if (table === "pipeline") {
          const { failJob } = await import("@/lib/pipeline/runner");
          stopped = await failJob(id, message);
        } else if (table === "skit") {
          stopped = await (await import("@/lib/skit/skit")).failSkitJob(db, id, message);
        } else {
          stopped = await (await import("@/lib/swap/swap")).failSwapJob(db, id, message);
        }
        if (!stopped) return bad("This job isn't running (or was already refunded).", 409);
        const { data: row } = await db.from(TABLES[table]).select("user_id").eq("id", id).maybeSingle();
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: row?.user_id ? String(row.user_id) : null, target_id: id, note, detail: { table } });
        return NextResponse.json({ success: true, logError });
      }

      // ------------------------------------------------------------ retryRender
      case "retryRender": {
        const id = uuid(body.id);
        if (!id) return bad("Pick a job.");
        const { data: job } = await db.from("pipeline_jobs").select("user_id").eq("id", id).maybeSingle();
        if (!job) return bad("Job not found.", 404);
        const { retryFailedRender } = await import("@/lib/pipeline/rerender");
        await retryFailedRender(db, id, String(job.user_id));
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: String(job.user_id), target_id: id, note });
        return NextResponse.json({ success: true, logError });
      }

      // ------------------------------------------------------------------ nudge
      case "nudge": {
        const table = str(body.table, 20) as Table;
        const id = uuid(body.id);
        if (!TABLES[table] || !id) return bad("Pick a job.");
        const { data: row } = await db.from(TABLES[table]).select("*").eq("id", id).maybeSingle();
        if (!row) return bad("Job not found.", 404);
        if (row.status !== "running") return bad("Only a running job can be nudged.", 409);
        if (table === "pipeline") {
          // reconcileJob re-queues a forgotten step / polls async work, then the worker is kicked.
          const { reconcileJob, kickJob } = await import("@/lib/pipeline/runner");
          await reconcileJob(row as Parameters<typeof reconcileJob>[0]);
          await kickJob(id);
        } else if (table === "skit") {
          // A worker that died mid-step leaves its lease behind; clear it so the step can be claimed again.
          await db.from("skit_jobs").update({ lease_until: null }).eq("id", id);
          const { advanceSkitJob } = await import("@/lib/skit/skit");
          await advanceSkitJob(db, { ...(row as object), lease_until: null } as Parameters<typeof advanceSkitJob>[1]);
        } else {
          const { advanceSwapJob } = await import("@/lib/swap/swap");
          await advanceSwapJob(db, row as Parameters<typeof advanceSwapJob>[1]);
        }
        const logError = await log(db, { admin_id: admin.id, action, target_user_id: String(row.user_id), target_id: id, detail: { table } });
        return NextResponse.json({ success: true, logError });
      }

      default:
        return bad("Unknown action.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[admin] ${action} failed:`, message);
    return bad(message, 500);
  }
}
