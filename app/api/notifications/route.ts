// app/api/notifications/route.ts
// Real activity for the bell menu: recent pipeline results and credit
// transactions for the signed-in user. No stored "notification" rows — this
// is derived from existing tables, so nothing is fabricated.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import type { NotificationItem } from "@/lib/notifications-types";

export const dynamic = "force-dynamic";

const LIMIT = 12;

export async function GET() {
  const { supabase, user } = await requireUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const [{ data: jobs }, { data: txns }] = await Promise.all([
    supabase
      .from("pipeline_jobs")
      .select("id, status, idea, error, credits_refunded, steps, created_at")
      .eq("user_id", user.id)
      .in("status", ["completed", "failed"])
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("credit_transactions")
      .select("id, type, amount, reason, created_at")
      .eq("user_id", user.id)
      .in("type", ["purchase", "refund", "welcome"])
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);

  const items: NotificationItem[] = [];

  for (const job of jobs ?? []) {
    const steps = (job.steps ?? {}) as Record<string, { project_id?: string }>;
    const projectId = steps.result?.project_id ?? null;
    const idea = String(job.idea ?? "").slice(0, 70);
    if (job.status === "completed") {
      items.push({
        id: `job-${job.id}`,
        kind: "job_completed",
        title: "Content package ready",
        detail: idea || null,
        href: projectId ? `/projects/${projectId}` : "/projects",
        created_at: job.created_at,
      });
    } else {
      items.push({
        id: `job-${job.id}`,
        kind: "job_failed",
        title: "Generation failed — credits refunded",
        detail: job.error ? String(job.error).slice(0, 90) : idea || null,
        href: "/chat",
        created_at: job.created_at,
      });
    }
  }

  for (const tx of txns ?? []) {
    const amount = Number(tx.amount ?? 0);
    if (tx.type === "purchase") {
      items.push({
        id: `tx-${tx.id}`,
        kind: "purchase",
        title: `+${amount} credits added`,
        detail: tx.reason ?? null,
        href: "/billing",
        created_at: tx.created_at,
      });
    } else if (tx.type === "welcome") {
      items.push({
        id: `tx-${tx.id}`,
        kind: "welcome",
        title: `Welcome! ${amount} free credits`,
        detail: "Start with your first idea in the AI Workspace.",
        href: "/chat",
        created_at: tx.created_at,
      });
    } else if (tx.type === "refund" && amount < 0) {
      // A Paddle refund that took credits back is worth surfacing;
      // pipeline refunds are already covered by the failed-job item.
      items.push({
        id: `tx-${tx.id}`,
        kind: "refund",
        title: `${amount} credits (payment refunded)`,
        detail: tx.reason ?? null,
        href: "/billing",
        created_at: tx.created_at,
      });
    }
  }

  items.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  return NextResponse.json({ success: true, items: items.slice(0, LIMIT) });
}
