// app/api/swap/route.ts — character swap (lib/swap/swap.ts).
//   GET [?id=] → your recent swaps (and moves a running one along)
//   POST {action:"uploadUrl", type, size} → signed upload for the source clip
//   POST {action:"quote", path} → length, orientation and price of an uploaded clip
//   POST {action:"start", path, characterId, prompt?, rights:true} → check, charge, start

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/api-keys";
import { isFullVideoEnabled, isGenerationEnabled, LAUNCH_LOCK_MESSAGE } from "@/lib/pipeline/features";
import { hasPurchased, isWatermarkExempt } from "@/lib/pipeline/watermark-policy";
import { readMp4 } from "@/lib/swap/mp4";
import { SWAP_MAX_BYTES, SWAP_MAX_SECONDS, advanceSwapJob, checkSourceVideo, submitSwap, swapCredits, type SwapRow } from "@/lib/swap/swap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ success: false, error, ...extra }, { status });
const MAX_RUNNING = 2;

function view(r: SwapRow) {
  return {
    id: r.id,
    status: r.status,
    phase: r.phase,
    characterName: r.character_name,
    seconds: r.source_seconds,
    vertical: r.vertical,
    credits: r.credits,
    outputUrl: r.output_url,
    projectId: r.project_id,
    error: r.error,
    createdAt: r.created_at,
  };
}

async function sourceInfo(db: ReturnType<typeof adminDb>, userId: string, path: unknown) {
  if (typeof path !== "string" || !new RegExp(`^${userId}/swap/src-[0-9a-f-]{36}\\.(mp4|mov)$`).test(path)) {
    throw new Error("Upload the clip first.");
  }
  const { data, error } = await db.storage.from("videos").download(path);
  if (error || !data) throw new Error("The uploaded clip wasn't found. Upload it again.");
  if (data.size > SWAP_MAX_BYTES) throw new Error("Clips can be up to 50 MB.");
  const bytes = Buffer.from(await data.arrayBuffer());
  const info = readMp4(bytes);
  if (info.seconds < 1) throw new Error("This clip is too short.");
  if (info.seconds > SWAP_MAX_SECONDS + 0.5) throw new Error(`Clips can be up to ${SWAP_MAX_SECONDS} seconds. Trim it and upload again.`);
  return { bytes, info, mime: path.endsWith(".mov") ? "video/quicktime" : "video/mp4" };
}

export async function GET(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  const db = adminDb();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const { data } = await db.from("swap_jobs").select("*").eq("id", id).eq("user_id", user.id).maybeSingle();
    if (!data) return bad("Not found", 404);
    return NextResponse.json({ success: true, swap: view(await advanceSwapJob(db, data as SwapRow)) });
  }
  const allowed =
    isGenerationEnabled(user.id) && isFullVideoEnabled(user.id) && (isWatermarkExempt(user.id) || (await hasPurchased(db, user.id)));
  const { data } = await db.from("swap_jobs").select("*").eq("user_id", user.id).or("kind.is.null,kind.eq.swap").order("created_at", { ascending: false }).limit(20);
  return NextResponse.json({ success: true, allowed, maxSeconds: SWAP_MAX_SECONDS, swaps: ((data ?? []) as SwapRow[]).map(view) });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return bad("Not authenticated", 401);
  if (!isGenerationEnabled(user.id) || !isFullVideoEnabled(user.id)) return bad(LAUNCH_LOCK_MESSAGE, 403);
  const db = adminDb();
  if (!(isWatermarkExempt(user.id) || (await hasPurchased(db, user.id)))) return bad("Character swaps are available on any plan or pack.", 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (body.action === "uploadUrl") {
    const type = String(body.type ?? "");
    const ext = type === "video/mp4" ? "mp4" : type === "video/quicktime" ? "mov" : null;
    if (!ext) return bad("Use an MP4 or MOV video.");
    if (Number(body.size) > SWAP_MAX_BYTES) return bad("Clips can be up to 50 MB.");
    const path = `${user.id}/swap/src-${randomUUID()}.${ext}`;
    const { data, error } = await db.storage.from("videos").createSignedUploadUrl(path);
    if (error || !data) return bad("Could not prepare the upload.", 500);
    return NextResponse.json({ success: true, path, token: data.token });
  }

  if (body.action === "quote") {
    try {
      const { info } = await sourceInfo(db, user.id, body.path);
      return NextResponse.json({ success: true, seconds: Math.round(info.seconds * 10) / 10, vertical: info.vertical, fps: Math.round(info.fps), credits: swapCredits(info) });
    } catch (err) {
      return bad(err instanceof Error ? err.message : "This clip can't be used.");
    }
  }

  if (body.action === "start") {
    if (body.rights !== true) return bad("Confirm that you may use this clip.");
    const characterId = typeof body.characterId === "string" ? body.characterId : "";
    const { data: character } = await db.from("characters").select("id, name, reference_paths").eq("id", characterId).eq("user_id", user.id).maybeSingle();
    const ref = (character?.reference_paths as string[] | undefined)?.[0];
    if (!character || !ref) return bad("Pick one of your characters.");
    const { count } = await db.from("swap_jobs").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "running");
    if ((count ?? 0) >= MAX_RUNNING) return bad(`Up to ${MAX_RUNNING} swaps are made at a time. Try again when one finishes.`, 429);

    {
      // Free plan: studios need a purchase (lib/plans.ts FREE_PLAN).
      const { isFreeAccount } = await import("@/lib/pipeline/trial");
      if (await isFreeAccount(db, user.id)) {
        const { FREE_PLAN_UPGRADE_MESSAGE } = await import("@/lib/plans");
        return NextResponse.json({ success: false, error: FREE_PLAN_UPGRADE_MESSAGE, code: "upgrade_required" }, { status: 403 });
      }
    }
    let source: Awaited<ReturnType<typeof sourceInfo>>;
    try {
      source = await sourceInfo(db, user.id, body.path);
    } catch (err) {
      return bad(err instanceof Error ? err.message : "This clip can't be used.");
    }
    const check = await checkSourceVideo(source.bytes, source.mime).catch(() => ({ ok: false as const, reason: "We couldn't check this video. Please try again." }));
    if (!check.ok) return bad(check.reason);

    const credits = swapCredits(source.info);
    const { payerFor } = await import("@/lib/teams");
    const payer = await payerFor(db, user.id);
    const { data: paid, error: payErr } = await db.rpc("deduct_credits", {
      p_user_id: payer,
      p_amount: credits,
      p_reason: `Character swap (${Math.round(source.info.seconds)} s, ${character.name})`,
    });
    if (payErr) return bad(payErr.message, 500);
    if (!paid) return bad(`Not enough credits. This swap costs ${credits}.`, 402, { code: "insufficient_credits" });

    const prompt =
      typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim().replace(/\s+/g, " ").slice(0, 500)
        : `${character.name} takes the place of the person in the video, with the same movements, expressions and lip movements.`;
    const id = randomUUID();
    try {
      const { data: signed } = await db.storage.from("characters").createSignedUrl(ref, 6 * 3600);
      const videoUrl = db.storage.from("videos").getPublicUrl(String(body.path)).data.publicUrl;
      const fal = await submitSwap({ videoUrl, imageUrl: signed!.signedUrl, prompt });
      const { error } = await db.from("swap_jobs").insert({
        id,
        user_id: user.id,
        billed_to: payer !== user.id ? payer : null,
        status: "running",
        phase: "swap",
        source_path: body.path,
        source_seconds: Math.round(source.info.seconds * 100) / 100,
        vertical: source.info.vertical,
        character_id: character.id,
        character_name: character.name,
        prompt,
        fal,
        credits,
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error("[swap] start failed:", err);
      await db.rpc("add_credits", { p_user_id: payer, p_amount: credits, p_type: "refund", p_reason: "Refund: character swap could not start" });
      const msg = err instanceof Error ? err.message : String(err);
      const why = /balance|locked|quota|402|403/i.test(msg) ? "the video provider is temporarily unavailable" : "something went wrong on our side";
      return bad(`The swap couldn't be started: ${why}. Your credits were refunded.`, 502, { detail: msg.slice(0, 300) });
    }
    return NextResponse.json({ success: true, id, credits });
  }

  return bad("Unknown action.");
}
