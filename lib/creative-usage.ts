// lib/creative-usage.ts
// Provider cost log for skits, talking characters and character swaps
// (5 Nov 2026). The narrated-video pipeline logs every provider call as it
// happens (lib/pipeline/usage.ts); these three makers are logged once per run,
// when the job finishes or fails, from what was actually produced: pictures
// made, seconds lip-synced, clips animated, characters spoken, seconds rendered.
// Rows go to the same provider_usage table (step = skit | talk | swap), so the
// admin panel's cost figures cover them too.
//
// Needs the SQL in supabase/README.md ("Provider cost log for skits…"): the
// table's job_id used to reference pipeline_jobs only. Until that is run the
// inserts fail quietly (recordProviderUsage never throws).

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estimateCostUsd, recordProviderUsage, type UsageProvider, type UsageRecord } from "@/lib/pipeline/usage";
import { RENDER_CREDITS_PER_30S, REVENUE_PER_CREDIT_USD, TARGET_MARGIN } from "@/lib/pipeline/steps";
import { SKIT_PLAN_COST, SKIT_SFX_COST } from "@/lib/skit/pricing";
import type { SkitRow, SkitShot } from "@/lib/skit/skit";
import type { SwapRow } from "@/lib/swap/swap";

interface Item {
  provider: UsageProvider;
  model: string;
  unit: UsageRecord["unit"];
  quantity: number;
  /** Set when the price is not a per-unit list price. */
  costUsd?: number;
}

const IMAGE_MODEL = () => process.env.GEMINI_SCENE_IMAGE_MODEL || "gemini-nano-banana-2.1";
const TTS_MODEL = () => process.env.GEMINI_TTS_MODEL || "gemini-2.5-pro-preview-tts";
const CLIP_MODEL = () => process.env.FAL_VIDEO_MODEL || "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";
const AVATAR_MODEL = () => process.env.FAL_AVATAR_MODEL || "fal-ai/kling-video/ai-avatar/v2/standard";
const SWAP_MODEL = () => process.env.FAL_SWAP_MODEL || "fal-ai/wan/v2.2-14b/animate/replace";
const SILENT_CLIP_SECONDS = 5;

const avatarModel = (fal: { statusUrl?: string } | null | undefined) => (fal?.statusUrl?.includes("/veed/") ? "veed/fabric-1.0" : AVATAR_MODEL());

async function write(db: SupabaseClient, jobId: string, userId: string, step: string, items: Item[], status: "ok" | "failed") {
  for (const it of items) {
    if (!(it.quantity > 0)) continue;
    await recordProviderUsage(db, {
      jobId,
      userId,
      step: step as UsageRecord["step"],
      provider: it.provider,
      model: it.model,
      unit: it.unit,
      quantity: it.quantity,
      estimatedCostUsd: it.costUsd ?? estimateCostUsd(it.provider, it.model, { quantity: it.quantity }),
      durationMs: 0,
      status,
    });
  }
}

/* ---------------- Skits ---------------- */

export type SkitEditMark = { kind: "redo"; shot: number } | { kind: "reanimate"; shots: string[] } | { kind: "recut" };
type MarkedPlan = SkitRow["plan"] & { pendingEdit?: SkitEditMark | null };

function animation(shots: SkitShot[]): Item[] {
  const made = shots.filter((s) => s.clipUrl || s.editedClipUrl);
  const items: Item[] = [];
  const speaking = new Map<string, number>();
  for (const s of made.filter((x) => x.line)) {
    // Talking clips with their own voice bill per clip second (4 / 6 / 8 s).
    if (s.talkClip) {
      const model = process.env.SKIT_TALK_MODEL || "fal-ai/veo3.1/fast/image-to-video";
      speaking.set(model, (speaking.get(model) ?? 0) + s.talkClip);
      continue;
    }
    const model = avatarModel(s.fal);
    speaking.set(model, (speaking.get(model) ?? 0) + Math.ceil(s.audioSeconds ?? s.seconds ?? 3));
  }
  for (const [model, seconds] of speaking) items.push({ provider: "fal", model, unit: "seconds", quantity: seconds });
  const silent = made.filter((x) => !x.line).length;
  if (silent) items.push({ provider: "fal", model: CLIP_MODEL(), unit: "seconds", quantity: silent * SILENT_CLIP_SECONDS });
  return items;
}

function skitItems(row: SkitRow, renderSeconds: number): Item[] {
  const plan = row.plan as MarkedPlan;
  const render: Item[] = renderSeconds > 0 ? [{ provider: "shotstack", model: "render", unit: "seconds", quantity: Math.round(renderSeconds) }] : [];
  const edit = plan.pendingEdit;
  if (edit?.kind === "recut") return render;
  if (edit?.kind === "redo") {
    const s = plan.shots[edit.shot];
    return [...(s?.imageUrl ? [{ provider: "gemini" as const, model: IMAGE_MODEL(), unit: "images" as const, quantity: 1 }] : []), ...(s ? animation([s]) : []), ...render];
  }
  if (edit?.kind === "reanimate") return [...animation(plan.shots.filter((s) => edit.shots.includes(s.id))), ...render];

  // First run: everything that was made.
  const spoken = plan.shots.filter((s) => s.audioUrl).reduce((n, s) => n + s.line.length, 0);
  const crowd = plan.shots.filter((s) => s.crowdUrls?.length).reduce((n, s) => n + s.crowd.length * (s.crowdUrls?.length ?? 0), 0);
  const sfx = plan.shots.filter((s) => s.sfxUrl).length;
  return [
    { provider: "openai", model: process.env.SCRIPT_MODEL || "gpt-6.1-terra", unit: "calls", quantity: 1, costUsd: SKIT_PLAN_COST },
    {
      provider: "gemini",
      model: IMAGE_MODEL(),
      unit: "images",
      quantity: plan.characters.filter((c) => c.refUrl || c.refPath).length + plan.shots.filter((s) => s.imageUrl).length,
    },
    { provider: "gemini", model: TTS_MODEL(), unit: "characters", quantity: spoken + crowd },
    { provider: "elevenlabs", model: "sound-effects", unit: "calls", quantity: sfx, costUsd: sfx * SKIT_SFX_COST },
    ...animation(plan.shots),
    ...render,
  ];
}

/** Call when a skit run ends (finished: with the rendered seconds; failed: 0). Clears the edit mark. */
export async function logSkitUsage(db: SupabaseClient, row: SkitRow, renderSeconds: number, status: "ok" | "failed"): Promise<void> {
  try {
    await write(db, row.id, row.user_id, "skit", skitItems(row, renderSeconds), status);
  } catch (err) {
    console.error(`[usage] skit ${row.id}:`, err);
  }
  delete (row.plan as MarkedPlan).pendingEdit;
}

/* ---------------- Talking character + character swap ---------------- */

export async function logSwapUsage(db: SupabaseClient, row: SwapRow, status: "ok" | "failed"): Promise<void> {
  try {
    const seconds = Math.ceil(Number(row.source_seconds) || 0);
    const items: Item[] = [];
    if (row.kind === "ambient") {
      const st = (row.fal ?? {}) as { tracks?: unknown[]; scenes?: Array<string | null> };
      const songs = st.tracks?.length ?? 0;
      const pictures = (st.scenes ?? []).filter(Boolean).length;
      if (songs) items.push({ provider: "gemini", model: "lyria-3-pro-preview", unit: "calls", quantity: songs });
      if (pictures) items.push({ provider: "gemini", model: IMAGE_MODEL(), unit: "images", quantity: pictures });
    } else if (row.kind === "animate") {
      // One clip: billed on submit, so a failed run still cost the same.
      items.push({ provider: "fal", model: CLIP_MODEL(), unit: "seconds", quantity: seconds });
    } else if (row.kind === "talk") {
      if (row.image_url) items.push({ provider: "gemini", model: IMAGE_MODEL(), unit: "images", quantity: 1 });
      if (row.script) items.push({ provider: "gemini", model: TTS_MODEL(), unit: "characters", quantity: row.script.length });
      // Typed lines spoken by a Veo clip bill per clip second (4 / 6 / 8), recordings per lip-sync second.
      const veo = row.fal?.statusUrl?.includes("/veo3");
      if (status === "ok")
        items.push(
          veo
            ? { provider: "fal", model: process.env.SKIT_TALK_MODEL || "fal-ai/veo3.1/fast/image-to-video", unit: "seconds", quantity: [4, 6, 8].find((c) => c >= seconds + 0.8) ?? 8 }
            : { provider: "fal", model: avatarModel(row.fal), unit: "seconds", quantity: seconds }
        );
    } else if (status === "ok" || row.swapped_url) {
      // fal bills the swap per 16 frames; the price charged was built from the clip's real
      // frame count, so take the provider cost back out of it (credits minus the render).
      const render = RENDER_CREDITS_PER_30S * Math.max(1, Math.ceil(seconds / 30));
      const swapUsd = Math.max(0, row.credits - render) * (1 - TARGET_MARGIN) * REVENUE_PER_CREDIT_USD;
      items.push({ provider: "fal", model: SWAP_MODEL(), unit: "seconds", quantity: seconds, costUsd: Math.round(swapUsd * 1e6) / 1e6 });
      if (status === "ok") items.push({ provider: "shotstack", model: "render", unit: "seconds", quantity: seconds });
    }
    await write(db, row.id, row.user_id, row.kind === "talk" ? "talk" : row.kind === "animate" ? "animate" : row.kind === "ambient" ? "ambient" : "swap", items, status);
  } catch (err) {
    console.error(`[usage] ${row.kind ?? "swap"} ${row.id}:`, err);
  }
}
