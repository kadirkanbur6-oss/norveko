// lib/lab/script-eval.ts
// Fixed test set + judge for comparing script writers and prompt versions in
// /lab. The same topics (and, once cached, the same research briefs) are used
// for every run, so scores are comparable across models and prompt changes.

import "server-only";
import { chatJSON, type LlmUsage } from "@/lib/pipeline/llm";
import { languagePromptName } from "@/lib/pipeline/options";

export interface EvalTopic {
  id: string;
  idea: string;
  language: string; // LANGUAGE_OPTIONS label
  style: string;
}

/** Mixed Turkish/English, every style, legends + science + history. */
export const EVAL_TOPICS: EvalTopic[] = [
  { id: "roanoke", idea: "The disappearance of the Roanoke colony", language: "English", style: "Mystery" },
  { id: "dyatlov", idea: "Dyatlov Geçidi olayı: dokuz dağcıya ne oldu?", language: "Türkçe", style: "Mystery" },
  { id: "cats-purr", idea: "Why do cats purr?", language: "English", style: "Educational" },
  { id: "penguins", idea: "Penguenler neden uçamaz?", language: "Türkçe", style: "Educational" },
  { id: "vasa", idea: "The sinking of the Swedish warship Vasa in 1628", language: "English", style: "Documentary" },
  { id: "fetih-gemiler", idea: "İstanbul'un fethinde gemilerin karadan yürütülmesi", language: "Türkçe", style: "Documentary" },
  { id: "bell-witch", idea: "The Bell Witch legend of Tennessee", language: "English", style: "Horror" },
  { id: "gobeklitepe", idea: "Göbeklitepe'yi kim, neden inşa etti?", language: "Türkçe", style: "Mystery" },
  { id: "anc", idea: "How do noise-cancelling headphones work?", language: "English", style: "Educational" },
  { id: "kovaceva", idea: "Atatürk'ün sevdiği kadın Dimitrina Kovaçeva", language: "Türkçe", style: "Documentary" },
];

export interface JudgeScores {
  accuracy: number;
  hook: number;
  coherence: number;
  fluency: number;
  noFiller: number;
  retention: number;
  /** 0–100 composite (length fit included). */
  overall: number;
  notes: string;
  problems: string[];
}

/** Judge model; env SCRIPT_JUDGE_MODEL (defaults to a strong general model). */
export const JUDGE_MODEL = process.env.SCRIPT_JUDGE_MODEL || "gpt-5";

export async function judgeScript(args: {
  idea: string;
  language: string;
  hook: string;
  script: string;
  research?: string | null;
  wordCount: number;
  range: { min: number; max: number };
}): Promise<{ scores: JudgeScores; usage?: LlmUsage }> {
  const { idea, language, hook, script, research, wordCount, range } = args;
  const { data, usage } = await chatJSON<Record<string, unknown>>({
    model: JUDGE_MODEL,
    effort: "medium",
    timeoutMs: 90_000,
    system: `You are a demanding head writer reviewing a 60-second narrated Short in ${languagePromptName(language)}. Score 1–5 (5 = broadcast quality) on:
- accuracy: every claim (hook included) is supported by the research brief; legends/disputes are hedged; nothing invented or exaggerated. ${research ? "" : "No research brief was available: judge against widely documented facts and penalise unverifiable specifics."}
- hook: literally true, under 9 words, creates a question, does NOT spoil the answer.
- coherence: one connected story, each sentence follows from the previous, no contradictions, explanations after events.
- fluency: natural native-level ${languagePromptName(language)} for the ear (no translationese, abbreviations, semicolons, broken sentences, typos).
- noFiller: no padding, no meta sentences about videos/photos/sources, no repetition.
- retention: would a viewer keep watching — concrete details, rising tension, satisfying payoff.
Be strict: 3 is "acceptable", 5 is rare. List concrete problems (quote the words).
Respond ONLY with JSON {"accuracy":n,"hook":n,"coherence":n,"fluency":n,"noFiller":n,"retention":n,"notes":"one or two sentences","problems":["..."]}.`,
    user: `Video idea: ${idea}\n\n${research ? `RESEARCH BRIEF:\n${research}\n\n` : ""}HOOK:\n${hook}\n\nSCRIPT:\n${script}`,
  });
  const n = (v: unknown) => Math.max(1, Math.min(5, Math.round(Number(v) || 1)));
  const parts = {
    accuracy: n(data.accuracy),
    hook: n(data.hook),
    coherence: n(data.coherence),
    fluency: n(data.fluency),
    noFiller: n(data.noFiller),
    retention: n(data.retention),
  };
  // Accuracy counts double; length fit is measured, not judged.
  const lengthFit = wordCount >= range.min && wordCount <= range.max ? 1 : wordCount >= range.min * 0.85 && wordCount <= range.max * 1.15 ? 0.6 : 0.2;
  const weighted =
    (parts.accuracy * 2 + parts.hook + parts.coherence + parts.fluency + parts.noFiller + parts.retention) / (7 * 5);
  const overall = Math.round((weighted * 0.9 + lengthFit * 0.1) * 100);
  return {
    scores: {
      ...parts,
      overall,
      notes: String(data.notes ?? "").slice(0, 600),
      problems: Array.isArray(data.problems) ? data.problems.map((p) => String(p).slice(0, 300)).slice(0, 8) : [],
    },
    usage,
  };
}

export async function listOpenAIModels(): Promise<string[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return [];
  const res = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (!res.ok) return [];
  const data = await res.json();
  return (Array.isArray(data?.data) ? data.data : [])
    .map((m: { id?: string }) => String(m.id ?? ""))
    .filter((id: string) => /^(gpt-[4-9]|o\d)/.test(id) && !/audio|realtime|tts|transcribe|image|search/.test(id))
    .sort();
}
