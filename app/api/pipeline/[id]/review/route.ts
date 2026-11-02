// POST /api/pipeline/[id]/review — storyboard review (options.review).
// The job pauses after the script; the creator can edit the hook, narration,
// scene descriptions and visual prompts, then approve (the video is made) or
// cancel (everything not yet made is refunded; the script stays as a project).

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";

export const dynamic = "force-dynamic";

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\r/g, "").replace(/[<>]/g, " ").trim().slice(0, max) : null;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = adminDb();
  const { data: job } = await db.from("pipeline_jobs").select("id, user_id, status, steps, options").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!job) return NextResponse.json({ success: false, error: "Job not found." }, { status: 404 });
  const steps = (job.steps ?? {}) as Record<string, Record<string, unknown>>;
  const waiting =
    job.status === "running" &&
    (job.options as { review?: boolean } | null)?.review === true &&
    steps.script?.status === "completed" &&
    !steps.script?.approved_at;
  if (!waiting) return NextResponse.json({ success: false, error: "This video isn't waiting for review." }, { status: 409 });

  if (body.action === "cancel") {
    const { failJob } = await import("@/lib/pipeline/runner");
    await failJob(id, "Cancelled at review. Everything not yet made was refunded; the script is saved as a project.");
    return NextResponse.json({ success: true });
  }
  if (body.action !== "approve") return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });

  const script = { ...steps.script };
  const hook = clean(body.hook, 300);
  const narration = clean(body.script, 20_000);
  if (hook !== null && hook) script.hook = hook;
  if (narration !== null) {
    if (narration.split(/\s+/).filter(Boolean).length < 5) {
      return NextResponse.json({ success: false, error: "The narration is empty." }, { status: 400 });
    }
    // The narrator opens with the on-screen hook.
    const h = String(script.hook ?? "").trim();
    script.script = h && !narration.startsWith(h) ? `${h} ${narration}` : narration;
  }
  if (Array.isArray(body.scenes) && Array.isArray(script.scenes)) {
    const edits = new Map(
      (body.scenes as Array<Record<string, unknown>>).map((s) => [Number(s.sceneNumber), s] as const)
    );
    script.scenes = (script.scenes as Array<Record<string, unknown>>).map((scene) => {
      const e = edits.get(Number(scene.sceneNumber));
      if (!e) return scene;
      const description = clean(e.description, 600);
      const videoPrompt = clean(e.videoPrompt, 800);
      return {
        ...scene,
        ...(description ? { description } : {}),
        ...(videoPrompt ? { videoPrompt } : {}),
      };
    });
  }
  script.approved_at = new Date().toISOString();
  script.edited_at_review = Boolean(narration || hook || Array.isArray(body.scenes)) || undefined;

  const next = ["voiceover", "thumbnail", "video", "render"].find((k) => steps[k]?.status === "pending");
  const patched = { ...steps, script, ...(next ? { [next]: { ...steps[next], queued_at: new Date().toISOString() } } : {}) };
  const { error } = await db.from("pipeline_jobs").update({ steps: patched }).eq("id", id).eq("status", "running");
  if (error) return NextResponse.json({ success: false, error: "Could not save. Please try again." }, { status: 500 });
  const { kickJob } = await import("@/lib/pipeline/runner");
  await kickJob(id);
  return NextResponse.json({ success: true });
}
