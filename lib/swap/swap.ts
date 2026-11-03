// lib/swap/swap.ts
// Character swap (3 Nov 2026, Kadir — "put other faces into scenes, played
// naturally", like the viral swap Reels): the creator uploads a short clip and
// picks one of their characters; Wan 2.2 Animate "replace" (fal) puts that
// character into the clip with the same moves, expressions and lighting. The
// clip's own sound is laid back on top with Shotstack, and the result becomes
// a project (so it can be edited, posted to YouTube/TikTok/Instagram).
//
// Rules: only the creator's characters (themselves, someone who agreed, a
// historical figure or an invented character — lib/characters); the creator
// confirms they may use the clip; the clip is checked for minors and explicit
// content before anything is charged. ≤ 15 s, MP4/MOV.
//
// Table swap_jobs (SQL in supabase/README.md). Advanced by GET /api/swap
// polling and by the minute heartbeat (/api/pipeline/reap).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RENDER_CREDITS_PER_30S, creditsForCost } from "@/lib/pipeline/steps";
import type { Mp4Info } from "./mp4";

export const SWAP_MAX_SECONDS = 15;
export const SWAP_MAX_BYTES = 50 * 1024 * 1024;
export const SWAP_MODEL = process.env.FAL_SWAP_MODEL || "fal-ai/wan/v2.2-14b/animate/replace";
/** fal bills Wan Animate per 16 frames: $0.08 per "second" at 720p. */
export const SWAP_COST_PER_16_FRAMES = 0.08;
const FAL_TIMEOUT_MS = 40 * 60 * 1000; // ~9 min per 5 s in the 3 Nov test
const RENDER_TIMEOUT_MS = 20 * 60 * 1000;

export function swapCredits(info: Pick<Mp4Info, "frames" | "seconds">): number {
  return creditsForCost((info.frames / 16) * SWAP_COST_PER_16_FRAMES) + RENDER_CREDITS_PER_30S * Math.max(1, Math.ceil(info.seconds / 30));
}

export interface SwapRow {
  id: string;
  user_id: string;
  billed_to: string | null;
  status: "running" | "completed" | "failed";
  phase: "swap" | "render" | "done";
  source_path: string;
  source_seconds: number;
  vertical: boolean;
  character_id: string;
  character_name: string;
  prompt: string | null;
  fal: { requestId: string; statusUrl: string; responseUrl: string } | null;
  swapped_url: string | null;
  render_id: string | null;
  output_url: string | null;
  project_id: string | null;
  credits: number;
  refunded: boolean;
  error: string | null;
  created_at: string;
  updated_at: string;
}

const falKey = () => {
  const k = process.env.FAL_KEY;
  if (!k) throw new Error("FAL_KEY is not set.");
  return k;
};

/** Gemini looks at the clip before anything is charged: no minors, nothing explicit. */
export async function checkSourceVideo(bytes: Buffer, mimeType: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "The video check isn't available right now. Please try again later." };
  // Files API (inline data is capped at 20 MB).
  const start = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${key}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: "swap-check" } }),
  });
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!start.ok || !uploadUrl) return { ok: false, reason: "We couldn't check this video. Please try again." };
  const up = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Length": String(bytes.length) },
    body: new Uint8Array(bytes),
  });
  const file = ((await up.json().catch(() => ({}))) as { file?: { name?: string; uri?: string; state?: string } }).file;
  if (!file?.uri || !file.name) return { ok: false, reason: "We couldn't check this video. Please try again." };
  for (let i = 0; i < 20 && file.state !== "ACTIVE"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const s = (await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${key}`).then((r) => r.json()).catch(() => ({}))) as { state?: string };
    file.state = s.state;
    if (s.state === "FAILED") break;
  }
  if (file.state !== "ACTIVE") return { ok: false, reason: "We couldn't check this video. Please try again." };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.CHARACTER_CHECK_MODEL || "gemini-3.8-flash")}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: 'Look at this video. Answer as JSON: {"people": number (people clearly visible), "minor": boolean (does any visible person look under 18?), "explicit": boolean (nudity or sexual content), "graphicViolence": boolean}',
              },
              { fileData: { mimeType, fileUri: file.uri } },
            ],
          },
        ],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );
  // Best effort cleanup of the uploaded copy.
  void fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${key}`, { method: "DELETE" }).catch(() => undefined);
  if (!res.ok) return { ok: false, reason: "We couldn't check this video. Please try again." };
  const data = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  let r: { people?: number; minor?: boolean; explicit?: boolean; graphicViolence?: boolean } = {};
  try {
    r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
  } catch {
    return { ok: false, reason: "We couldn't check this video. Please try again." };
  }
  if (r.minor) return { ok: false, reason: "Videos with children can't be used for swaps." };
  if (r.explicit || r.graphicViolence) return { ok: false, reason: "This video can't be used." };
  if (typeof r.people === "number" && r.people < 1) return { ok: false, reason: "We couldn't see a person in this video to replace." };
  return { ok: true };
}

export async function submitSwap(params: { videoUrl: string; imageUrl: string; prompt: string }) {
  const res = await fetch(`https://queue.fal.run/${SWAP_MODEL}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${falKey()}` },
    body: JSON.stringify({ video_url: params.videoUrl, image_url: params.imageUrl, prompt: params.prompt.slice(0, 800), resolution: "720p" }),
  });
  const raw = await res.text();
  const data = (() => {
    try {
      return JSON.parse(raw) as { request_id?: string; status_url?: string; response_url?: string };
    } catch {
      return {};
    }
  })();
  if (!res.ok || !data.request_id || !data.status_url || !data.response_url) {
    throw new Error(`Swap submit failed (HTTP ${res.status}): ${raw.slice(0, 200)}`);
  }
  return { requestId: data.request_id, statusUrl: data.status_url, responseUrl: data.response_url };
}

async function patch(db: SupabaseClient, row: SwapRow, values: Partial<SwapRow>) {
  Object.assign(row, values);
  await db.from("swap_jobs").update({ ...values, updated_at: new Date().toISOString() }).eq("id", row.id);
}

async function fail(db: SupabaseClient, row: SwapRow, message: string) {
  // Claim the refund once.
  const { data } = await db
    .from("swap_jobs")
    .update({ status: "failed", error: message, refunded: true, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "running")
    .eq("refunded", false)
    .select("id")
    .maybeSingle();
  Object.assign(row, { status: "failed", error: message });
  if (data && row.credits > 0) {
    await db.rpc("add_credits", {
      p_user_id: row.billed_to ?? row.user_id,
      p_amount: row.credits,
      p_type: "refund",
      p_reason: "Refund: character swap failed",
    });
  }
}

/** Move one swap along: fal → Shotstack (keep the clip's sound) → stored MP4 → project. */
export async function advanceSwapJob(db: SupabaseClient, row: SwapRow): Promise<SwapRow> {
  if (row.status !== "running") return row;
  const age = Date.now() - Date.parse(row.updated_at || row.created_at);
  try {
    if (row.phase === "swap" && row.fal) {
      const st = await fetch(row.fal.statusUrl, { headers: { Authorization: `Key ${falKey()}` }, cache: "no-store" });
      const s = (await st.json().catch(() => ({}))) as { status?: string; error?: string };
      if (s.status === "FAILED" || s.status === "ERROR") return (await fail(db, row, "The swap model couldn't process this clip."), row);
      if (s.status !== "COMPLETED") {
        if (age > FAL_TIMEOUT_MS) await fail(db, row, "The swap took too long. Your credits were refunded.");
        return row;
      }
      const rr = await fetch(row.fal.responseUrl, { headers: { Authorization: `Key ${falKey()}` }, cache: "no-store" });
      const out = (await rr.json().catch(() => ({}))) as { video?: { url?: string } };
      if (!rr.ok || !out.video?.url) return (await fail(db, row, "The swap model couldn't process this clip."), row);

      // Lay the original clip's sound under the swapped picture.
      const sourceUrl = db.storage.from("videos").getPublicUrl(row.source_path).data.publicUrl;
      const length = Math.round(row.source_seconds * 100) / 100;
      const size = row.vertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
      const { submitRender } = await import("@/lib/pipeline/shotstack");
      const renderId = await submitRender({
        timeline: {
          background: "#000000",
          tracks: [
            { clips: [{ asset: { type: "video", src: out.video.url, volume: 0 }, start: 0, length, fit: "cover" }] },
            { clips: [{ asset: { type: "video", src: sourceUrl, volume: 1 }, start: 0, length, fit: "cover", opacity: 0 }] },
          ],
        },
        output: { format: "mp4", fps: 30, size, quality: "medium", range: { start: 0, length } },
      });
      await patch(db, row, { phase: "render", swapped_url: out.video.url, render_id: renderId });
      return row;
    }

    if (row.phase === "render" && row.render_id) {
      const { getRender } = await import("@/lib/pipeline/shotstack");
      const r = await getRender(row.render_id);
      if (r.status === "failed") return (await fail(db, row, r.error ?? "The final video couldn't be made."), row);
      if (r.status !== "done" || !r.url) {
        if (age > RENDER_TIMEOUT_MS) await fail(db, row, "The final video took too long. Your credits were refunded.");
        return row;
      }
      // Keep it: R2 when configured, else our Supabase bucket.
      const key = `${row.user_id}/swap/${row.id}/final.mp4`;
      let url: string;
      const r2 = await import("@/lib/storage/r2");
      if (r2.r2Configured()) {
        await r2.copyUrlToR2(r.url, key, "video/mp4");
        url = r2.r2PublicUrl(key);
      } else {
        const bytes = Buffer.from(await (await fetch(r.url)).arrayBuffer());
        const { error } = await db.storage.from("videos").upload(key, bytes, { contentType: "video/mp4", upsert: true });
        if (error) throw new Error(error.message);
        url = db.storage.from("videos").getPublicUrl(key).data.publicUrl;
      }
      const title = `${row.character_name} — character swap`;
      const { data: project } = await db
        .from("projects")
        .insert({
          user_id: row.user_id,
          title,
          platform: row.vertical ? "YouTube Shorts" : "YouTube Long-form",
          style: "Cinematic",
          duration: `${Math.round(row.source_seconds)} seconds`,
          idea: row.prompt || title,
          status: "draft",
          content: { titles: [title], description: "", tags: [], finalVideoUrl: url, swap: { characterName: row.character_name } },
        })
        .select("id")
        .single();
      await patch(db, row, { phase: "done", status: "completed", output_url: url, project_id: project?.id ?? null });
      return row;
    }
  } catch (err) {
    console.error(`[swap] ${row.id} advance failed:`, err);
    if (age > RENDER_TIMEOUT_MS) await fail(db, row, "Something went wrong. Your credits were refunded.");
  }
  return row;
}

/** Heartbeat: every running swap. */
export async function advanceSwapJobs(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from("swap_jobs").select("*").eq("status", "running").limit(50);
  if (error) return 0;
  for (const row of (data ?? []) as SwapRow[]) await advanceSwapJob(db, row);
  return data?.length ?? 0;
}
