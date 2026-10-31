// lib/pipeline/llm.ts
// One JSON-chat helper for every text model the pipeline uses, so the script
// writer can be swapped (and compared in /lab) without touching the prompts.
//
//   "gpt-5-mini" / "openai:gpt-5"        → OpenAI Chat Completions
//   "gemini:gemini-3-pro" / "gemini-…"  → Google Gemini generateContent
//
// Server-only. Keys are read lazily so importing this file never throws.

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatJsonArgs {
  model: string;
  system: string;
  user: string;
  /** Reasoning effort for models that support it (OpenAI gpt-5 family, o-series). */
  effort?: "minimal" | "low" | "medium" | "high";
  timeoutMs?: number;
}

export interface ChatJsonResult<T> {
  data: T;
  usage?: LlmUsage;
  /** Provider-qualified id for the cost log, e.g. "openai:gpt-5-mini". */
  usageKey: string;
}

/**
 * Script writer model; env SCRIPT_MODEL overrides (e.g. "gemini:gemini-3.8-flash").
 * 31 Oct 2026, 10-topic judged test set (prompt 2026-10-31.plan-factcheck):
 * gpt-6.1-terra 78/100 ($0.028/script, ~70 s) vs gpt-5-mini 63/100 ($0.020, ~120 s).
 * gpt-5-mini also retires on 11 Dec 2026.
 */
export const SCRIPT_MODEL = process.env.SCRIPT_MODEL || "gpt-6.1-terra";

export function llmProvider(model: string): { provider: "openai" | "gemini"; id: string } {
  const m = model.trim();
  if (m.startsWith("gemini:")) return { provider: "gemini", id: m.slice(7) };
  if (m.startsWith("openai:")) return { provider: "openai", id: m.slice(7) };
  if (m.startsWith("gemini-")) return { provider: "gemini", id: m };
  return { provider: "openai", id: m };
}

export function llmUsageKey(model: string): string {
  const { provider, id } = llmProvider(model);
  return `${provider}:${id}`;
}

function parseJson<T>(text: string): T {
  const t = text.trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    // Some models wrap JSON in ``` fences or add a sentence; take the outer object.
    const start = t.indexOf("{");
    const end = t.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1)) as T;
    throw new Error("Model response was not valid JSON.");
  }
}

function timeoutError(err: unknown, ms: number): never {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    throw new Error(`Model call timed out after ${Math.round(ms / 1000)} s.`);
  }
  throw err;
}

export async function chatJSON<T = Record<string, unknown>>(args: ChatJsonArgs): Promise<ChatJsonResult<T>> {
  const { provider, id } = llmProvider(args.model);
  const timeoutMs = args.timeoutMs ?? 150_000;
  const usageKey = `${provider}:${id}`;

  if (provider === "gemini") {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set.");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.system }] },
          contents: [{ role: "user", parts: [{ text: args.user }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    ).catch((err) => timeoutError(err, timeoutMs));
    if (!res.ok) {
      throw new Error(`Gemini API error (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json();
    const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string; thought?: boolean }) => (p.thought ? "" : p.text ?? ""))
      .join("");
    if (!text.trim()) throw new Error("Gemini returned an empty response.");
    const um = data?.usageMetadata;
    const usage = um
      ? {
          inputTokens: Number(um.promptTokenCount ?? 0),
          outputTokens: Number(um.candidatesTokenCount ?? 0) + Number(um.thoughtsTokenCount ?? 0),
        }
      : undefined;
    return { data: parseJson<T>(text), usage, usageKey };
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");
  const supportsEffort = /^(gpt-5|o\d)/.test(id);
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: id,
      response_format: { type: "json_object" },
      ...(args.effort && supportsEffort ? { reasoning_effort: args.effort } : {}),
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((err) => timeoutError(err, timeoutMs));
  if (!res.ok) {
    throw new Error(`OpenAI API error (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response.");
  const usage = data?.usage
    ? { inputTokens: Number(data.usage.prompt_tokens ?? 0), outputTokens: Number(data.usage.completion_tokens ?? 0) }
    : undefined;
  return { data: parseJson<T>(content), usage, usageKey };
}
