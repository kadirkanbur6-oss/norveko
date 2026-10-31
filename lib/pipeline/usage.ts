// lib/pipeline/usage.ts
// Provider usage / cost log. Every external AI call made by the pipeline is
// written to `provider_usage` (see supabase/README.md) with the raw units it
// consumed (tokens, characters, images, seconds) and an *estimated* USD cost,
// so we can compare what a job costs us with the credits we charged for it.
//
// The USD figures are estimates from the providers' public list prices and
// are only as current as PRICE_LIST below. Override any entry without a
// deploy via the PROVIDER_PRICE_OVERRIDES env var, e.g.
//   PROVIDER_PRICE_OVERRIDES={"openai:gpt-5-mini":{"inputPer1M":0.25,"outputPer1M":2}}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineStepId } from "@/lib/pipeline/steps";

export type UsageProvider = "openai" | "elevenlabs" | "gemini" | "kling" | "shotstack" | "fal";

export interface UsageRecord {
  jobId: string;
  userId: string;
  step: PipelineStepId;
  provider: UsageProvider;
  /** Provider model id, e.g. "gpt-5-mini", "eleven_multilingual_v2". */
  model: string;
  /** Unit the `quantity` is measured in. */
  unit: "tokens" | "characters" | "images" | "seconds";
  /** Total units consumed (for tokens: input + output). */
  quantity: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Estimated cost in USD (see PRICE_LIST). */
  estimatedCostUsd: number;
  durationMs: number;
  status: "ok" | "failed";
  error?: string;
}

/* ---------------- Price list (USD) ---------------- */

interface TokenPrice { inputPer1M: number; outputPer1M: number }
interface UnitPrice { perUnit: number }
type Price = TokenPrice | UnitPrice;

/**
 * Public list prices. Update when a provider changes pricing (or override
 * via PROVIDER_PRICE_OVERRIDES). Keys are "<provider>:<model>".
 */
export const PRICE_LIST: Record<string, Price> = {
  // OpenAI — per 1M tokens. (Web search calls, $10/1K, are not token-billed
  // and not included here.)
  "openai:gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.0 },
  // ElevenLabs — per character. API rate $0.08/1K on every plan (31 Oct 2026);
  // plan credits are prepaid, so use the Creator effective rate ≈ $0.18/1K.
  "elevenlabs:eleven_multilingual_v2": { perUnit: 0.00018 },
  // Gemini TTS — billed per audio token ($20 / 1M for Pro, $10 for Flash at
  // 25 tokens/s); ≈ 15 spoken characters per second ⇒ per character:
  "gemini:gemini-2.5-pro-preview-tts": { perUnit: 0.0000334 },
  "gemini:gemini-2.5-flash-preview-tts": { perUnit: 0.0000167 },
  // Gemini image — per generated 1K image (price list 31 Oct 2026).
  "gemini:gemini-3.1-flash-image": { perUnit: 0.067 },
  "gemini:gemini-nano-banana-2.1": { perUnit: 0.0336 },
  // Kling 3.0 — per second, 720p, no audio: 0.6 units × $0.14 list.
  "kling:kling-3.0": { perUnit: 0.084 },
  // Legacy model id (kept for old provider_usage rows).
  "kling:kling-v2-1": { perUnit: 0.056 },
  // fal Seedance 1.5 Pro image→video, silent 720p — per second (~$0.13 / 5 s).
  "fal:fal-ai/bytedance/seedance/v1.5/pro/image-to-video": { perUnit: 0.026 },
  // Shotstack — per second of rendered output (pay-as-you-go $0.20/min).
  "shotstack:render": { perUnit: 0.0034 },
};

function priceFor(provider: UsageProvider, model: string): Price | null {
  const key = `${provider}:${model}`;
  const overrides = parseOverrides();
  return overrides[key] ?? PRICE_LIST[key] ?? null;
}

let cachedOverrides: Record<string, Price> | null = null;
function parseOverrides(): Record<string, Price> {
  if (cachedOverrides) return cachedOverrides;
  try {
    const raw = process.env.PROVIDER_PRICE_OVERRIDES;
    cachedOverrides = raw ? (JSON.parse(raw) as Record<string, Price>) : {};
  } catch {
    cachedOverrides = {};
  }
  return cachedOverrides;
}

/** Estimate the USD cost of a call. Returns 0 when the model is unpriced. */
export function estimateCostUsd(
  provider: UsageProvider,
  model: string,
  usage: { inputTokens?: number; outputTokens?: number; quantity?: number }
): number {
  const price = priceFor(provider, model);
  if (!price) return 0;
  if ("inputPer1M" in price) {
    const input = (usage.inputTokens ?? 0) / 1_000_000;
    const output = (usage.outputTokens ?? 0) / 1_000_000;
    return round(input * price.inputPer1M + output * price.outputPer1M);
  }
  return round((usage.quantity ?? 0) * price.perUnit);
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/* ---------------- Persistence ---------------- */

/**
 * Insert one usage row with the service-role client. Never throws: a logging
 * failure must not fail the job. Returns true when the row was written.
 */
export async function recordProviderUsage(db: SupabaseClient, record: UsageRecord): Promise<boolean> {
  const { error } = await db.from("provider_usage").insert({
    job_id: record.jobId,
    user_id: record.userId,
    step: record.step,
    provider: record.provider,
    model: record.model,
    unit: record.unit,
    quantity: Math.round(record.quantity),
    input_tokens: record.inputTokens ?? null,
    output_tokens: record.outputTokens ?? null,
    estimated_cost_usd: record.estimatedCostUsd,
    duration_ms: Math.round(record.durationMs),
    status: record.status,
    error: record.error?.slice(0, 300) ?? null,
  });
  if (error) {
    console.error(`[usage] insert failed for job ${record.jobId}/${record.step}:`, error.message);
    return false;
  }
  return true;
}

/** Split "provider:model" from steps.ts into its parts. */
export function splitProvider(spec: string): { provider: UsageProvider; model: string } {
  const [p, m] = spec.split(":");
  if (p === "openai" || p === "elevenlabs" || p === "kling") {
    return { provider: p, model: m ?? "" };
  }
  if (p === "shotstack") return { provider: "shotstack", model: m ?? "render" };
  if (p === "fal") return { provider: "fal", model: spec.slice(4) };
  // Thumbnail step is stored as a bare model id ("gemini-3.1-flash-image").
  return { provider: "gemini", model: m ?? p };
}
