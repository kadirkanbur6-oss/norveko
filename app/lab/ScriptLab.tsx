"use client";

// app/lab/ScriptLab.tsx
// Script-writer lab: (1) the same idea + research written by several models
// side by side, (2) a fixed 10-topic test set scored by a judge model, so
// prompt and model changes are measured instead of guessed.

import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Play, RefreshCw, Save } from "lucide-react";
import { LANGUAGE_OPTIONS, STYLES } from "@/lib/pipeline/options";

interface Judge {
  accuracy: number;
  hook: number;
  coherence: number;
  fluency: number;
  noFiller: number;
  retention: number;
  overall: number;
  notes: string;
  problems: string[];
}

interface ScriptRun {
  success: boolean;
  error?: string;
  ms?: number;
  model?: string;
  promptVersion?: string;
  hook?: string;
  script?: string;
  words?: number;
  range?: { min: number; max: number; target: number };
  plan?: { question: string; facts: string[]; beats: string[]; reveal: string; hooks: string[]; uncertain: string[] } | null;
  factCheck?: { checked: boolean; issues: Array<{ sentence: string; problem: string }> };
  costUsd?: number;
  usage?: { inputTokens: number; outputTokens: number };
  judge?: Judge | null;
}

interface Topic {
  id: string;
  idea: string;
  language: string;
  style: string;
}

interface PastRun {
  id: string;
  model?: string;
  promptVersion?: string;
  average?: number;
  count?: number;
  savedAt?: string;
  costUsd?: number;
}

const WRITERS = [
  { key: "w1", label: "GPT-5 mini", model: "gpt-5-mini", current: true },
  { key: "w2", label: "GPT-5", model: "gpt-5" },
  { key: "w3", label: "Gemini 2.5 Pro", model: "gemini:gemini-2.5-pro" },
  { key: "w4", label: "Gemini 3 Pro (preview)", model: "gemini:gemini-3-pro-preview" },
];

async function lab<T = ScriptRun>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.json()) as T;
}

function ScoreChip({ label, value }: { label: string; value: number }) {
  const tone = value >= 4 ? "text-emerald-300" : value >= 3 ? "text-yellow-200" : "text-red-300";
  return (
    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
      {label} <b className={tone}>{value}</b>
    </span>
  );
}

function JudgeView({ j }: { j: Judge }) {
  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-2">
      <p className="text-xs font-semibold text-white">Judge: {j.overall}/100</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <ScoreChip label="accuracy" value={j.accuracy} />
        <ScoreChip label="hook" value={j.hook} />
        <ScoreChip label="coherence" value={j.coherence} />
        <ScoreChip label="fluency" value={j.fluency} />
        <ScoreChip label="no filler" value={j.noFiller} />
        <ScoreChip label="retention" value={j.retention} />
      </div>
      {j.notes && <p className="mt-1 text-[11px] text-gray-400">{j.notes}</p>}
      {j.problems.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[11px] text-red-200/80">
          {j.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunView({ r }: { r: ScriptRun }) {
  if (!r.success) return <p className="break-words text-xs text-red-300">{r.error}</p>;
  const inRange = r.range && r.words !== undefined && r.words >= r.range.min && r.words <= r.range.max;
  return (
    <div>
      <p className="text-sm font-semibold text-white">{r.hook}</p>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-gray-300">{r.script}</p>
      <p className="mt-2 text-[11px] text-gray-500">
        <span className={inRange ? "text-emerald-300" : "text-yellow-200"}>
          {r.words} words ({r.range?.min}–{r.range?.max})
        </span>{" "}
        · {r.ms ? `${(r.ms / 1000).toFixed(0)} s` : ""} · {r.costUsd ? `$${r.costUsd.toFixed(4)}` : "unpriced"} ·{" "}
        {r.usage ? `${r.usage.inputTokens + r.usage.outputTokens} tok` : ""}
      </p>
      {r.factCheck?.checked && (
        <p className="mt-1 text-[11px] text-gray-400">
          Fact check: {r.factCheck.issues.length === 0 ? "no issues" : `${r.factCheck.issues.length} fixed`}
        </p>
      )}
      {r.factCheck && r.factCheck.issues.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[11px] text-orange-200/80">
          {r.factCheck.issues.map((i, k) => (
            <li key={k}>
              “{i.sentence}” — {i.problem}
            </li>
          ))}
        </ul>
      )}
      {r.plan && (
        <details className="mt-2 text-[11px] text-gray-400">
          <summary className="cursor-pointer text-gray-300">Story plan</summary>
          <p className="mt-1">
            <b>Question:</b> {r.plan.question}
          </p>
          <p className="mt-1">
            <b>Beats:</b> {r.plan.beats.join(" → ")}
          </p>
          <p className="mt-1">
            <b>Reveal:</b> {r.plan.reveal}
          </p>
          <p className="mt-1">
            <b>Hook options:</b> {r.plan.hooks.join(" | ")}
          </p>
          {r.plan.uncertain.length > 0 && (
            <p className="mt-1">
              <b>Hedged:</b> {r.plan.uncertain.join("; ")}
            </p>
          )}
        </details>
      )}
      {r.judge && <JudgeView j={r.judge} />}
    </div>
  );
}

export default function ScriptLab() {
  const [idea, setIdea] = useState("Paranormal events reported in the Bermuda Triangle");
  const [language, setLanguage] = useState("English");
  const [style, setStyle] = useState("Mystery");
  const [notes, setNotes] = useState("");
  const [useResearch, setUseResearch] = useState(true);
  const [judge, setJudge] = useState(true);
  const [research, setResearch] = useState("");
  const [researchBusy, setResearchBusy] = useState(false);
  const [models, setModels] = useState<Record<string, string>>(() => Object.fromEntries(WRITERS.map((w) => [w.key, w.model])));
  const [runs, setRuns] = useState<Record<string, ScriptRun | "running">>({});
  const [textModels, setTextModels] = useState("");

  // Eval
  const [topics, setTopics] = useState<Topic[]>([]);
  const [meta, setMeta] = useState<{ judge?: string; current?: string; promptVersion?: string }>({});
  const [evalModel, setEvalModel] = useState("gpt-5-mini");
  const [evalRows, setEvalRows] = useState<Record<string, ScriptRun | "running">>({});
  const [evalBusy, setEvalBusy] = useState(false);
  const [past, setPast] = useState<PastRun[]>([]);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    void lab<{ success: boolean; topics: Topic[]; judge: string; current: string; promptVersion: string }>({ action: "eval-topics" }).then((r) => {
      if (!r.success) return;
      setTopics(r.topics);
      setMeta({ judge: r.judge, current: r.current, promptVersion: r.promptVersion });
      setEvalModel(r.current);
    });
    void lab<{ success: boolean; runs: PastRun[] }>({ action: "list-evals" }).then((r) => r.success && setPast(r.runs));
  }, []);

  async function fetchResearch(): Promise<string> {
    setResearchBusy(true);
    try {
      const r = await lab<{ success: boolean; brief?: string; error?: string }>({ action: "research", idea, language });
      const brief = r.success ? r.brief ?? "" : "";
      setResearch(r.success ? brief : `Research failed: ${r.error}`);
      return brief;
    } finally {
      setResearchBusy(false);
    }
  }

  async function runWriter(key: string, brief: string) {
    setRuns((p) => ({ ...p, [key]: "running" }));
    try {
      const r = await lab({ action: "script", idea, language, style, notes, model: models[key], research: useResearch ? brief : "", judge });
      setRuns((p) => ({ ...p, [key]: r }));
    } catch (err) {
      setRuns((p) => ({ ...p, [key]: { success: false, error: err instanceof Error ? err.message : String(err) } }));
    }
  }

  async function runAllWriters() {
    // Every writer gets the SAME brief, fetched once.
    const brief = useResearch ? research || (await fetchResearch()) : "";
    WRITERS.forEach((w) => void runWriter(w.key, brief));
  }

  async function runEval() {
    setEvalBusy(true);
    setEvalRows({});
    setSaveMsg("");
    const queue = [...topics];
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift()!;
        setEvalRows((p) => ({ ...p, [t.id]: "running" }));
        const r = await lab({
          action: "script",
          idea: t.idea,
          language: t.language,
          style: t.style,
          model: evalModel,
          withResearch: true,
          cacheId: t.id,
          judge: true,
        }).catch((err) => ({ success: false, error: err instanceof Error ? err.message : String(err) }) as ScriptRun);
        setEvalRows((p) => ({ ...p, [t.id]: r }));
      }
    };
    await Promise.all([worker(), worker()]);
    setEvalBusy(false);
  }

  const evalDone = topics.map((t) => evalRows[t.id]).filter((r): r is ScriptRun => typeof r === "object" && r.success && !!r.judge);
  const evalAvg = evalDone.length ? Math.round(evalDone.reduce((s, r) => s + (r.judge?.overall ?? 0), 0) / evalDone.length) : null;
  const evalCost = evalDone.reduce((s, r) => s + (r.costUsd ?? 0), 0);

  async function saveEval() {
    const r = await lab<{ success: boolean; url?: string; error?: string }>({
      action: "save-eval",
      model: evalModel,
      result: {
        model: evalModel,
        promptVersion: evalDone[0]?.promptVersion ?? meta.promptVersion,
        judge: meta.judge,
        average: evalAvg,
        count: evalDone.length,
        costUsd: evalCost,
        rows: topics.map((t) => ({ topic: t, result: evalRows[t.id] })),
      },
    });
    setSaveMsg(r.success ? "Saved ✓" : r.error ?? "Save failed");
    const list = await lab<{ success: boolean; runs: PastRun[] }>({ action: "list-evals" });
    if (list.success) setPast(list.runs);
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-white">0 · Script writer</h2>
      <p className="text-xs text-gray-400">
        Same idea and the same research brief, written by each model with the production prompts (plan → draft → editor → fact check). Prompt
        version: <span className="font-mono">{meta.promptVersion ?? "…"}</span> · production model:{" "}
        <span className="font-mono">{meta.current ?? "…"}</span> · judge: <span className="font-mono">{meta.judge ?? "…"}</span>
      </p>

      <div className="mt-3 grid gap-3 lg:grid-cols-[2fr_1fr_1fr]">
        <input value={idea} onChange={(e) => setIdea(e.target.value)} aria-label="Idea" className="rounded-xl border border-white/10 bg-black/30 p-3 text-sm" />
        <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language" className="rounded-xl border border-white/10 bg-black/40 p-3 text-sm">
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.label} value={l.label}>
              {l.flag} {l.label}
            </option>
          ))}
        </select>
        <select value={style} onChange={(e) => setStyle(e.target.value)} aria-label="Style" className="rounded-xl border border-white/10 bg-black/40 p-3 text-sm">
          {STYLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Angle & notes (optional)"
        aria-label="Angle and notes"
        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm"
      />
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-gray-300">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={useResearch} onChange={(e) => setUseResearch(e.target.checked)} /> Web research (shared brief)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={judge} onChange={(e) => setJudge(e.target.checked)} /> Score with judge
        </label>
        <button type="button" onClick={() => void fetchResearch()} disabled={researchBusy} className="rounded-lg border border-white/10 px-3 py-1 hover:text-white disabled:opacity-50">
          {researchBusy ? "Researching…" : research ? "Refresh research" : "Fetch research"}
        </button>
        <button
          type="button"
          onClick={async () => {
            setTextModels("Loading…");
            const r = await lab<{ success: boolean; openai?: string[]; google?: string[]; error?: string }>({ action: "text-models" });
            setTextModels(r.success ? `OpenAI: ${(r.openai ?? []).join(", ")}\n\nGoogle: ${(r.google ?? []).join(", ")}` : r.error ?? "failed");
          }}
          className="rounded-lg border border-white/10 px-3 py-1 hover:text-white"
        >
          List available text models
        </button>
        <button
          type="button"
          onClick={() => void runAllWriters()}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white"
        >
          <Play size={14} /> Run all writers
        </button>
      </div>
      {textModels && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-2 font-mono text-[11px] text-gray-300">{textModels}</pre>}
      {research && (
        <details className="mt-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-gray-300">
          <summary className="cursor-pointer">Research brief (shared by every writer)</summary>
          <p className="mt-2 whitespace-pre-wrap">{research}</p>
        </details>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {WRITERS.map((w) => {
          const r = runs[w.key];
          return (
            <div key={w.key} className={`rounded-2xl border p-3 ${w.current ? "border-yellow-400/40 bg-yellow-500/[0.04]" : "border-white/10 bg-white/[0.03]"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-white">
                  {w.label} {w.current && <span className="ml-1 rounded-full bg-yellow-400/20 px-2 py-0.5 text-[10px] text-yellow-200">current</span>}
                </p>
                <button
                  type="button"
                  onClick={async () => void runWriter(w.key, useResearch ? research || (await fetchResearch()) : "")}
                  disabled={r === "running"}
                  aria-label={`Run ${w.label}`}
                  className="rounded-lg border border-white/10 p-1.5 text-gray-300 hover:text-white disabled:opacity-50"
                >
                  {r === "running" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                </button>
              </div>
              <input
                value={models[w.key]}
                onChange={(e) => setModels((m) => ({ ...m, [w.key]: e.target.value }))}
                aria-label={`${w.label} model id`}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 font-mono text-[11px] text-gray-300"
              />
              <div className="mt-3">
                {r === "running" && <p className="text-xs text-blue-200">Writing… (plan → draft → editor → fact check, ~1–3 min)</p>}
                {r && r !== "running" && <RunView r={r} />}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------- Test set ---------------- */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white">Test set · {topics.length} fixed topics</h3>
            <p className="text-xs text-gray-400">
              Turkish + English, every style. Research briefs are cached, so every model and prompt version is scored on the same facts. Accuracy counts double; length fit is 10%.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={evalModel}
              onChange={(e) => setEvalModel(e.target.value)}
              aria-label="Model to evaluate"
              className="w-56 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-xs text-gray-200"
            />
            <button
              type="button"
              onClick={() => void runEval()}
              disabled={evalBusy || topics.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {evalBusy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Run test set
            </button>
            <button
              type="button"
              onClick={() => void saveEval()}
              disabled={evalBusy || evalDone.length === 0}
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 px-3 py-2 text-sm text-gray-200 disabled:opacity-50"
            >
              <Save size={14} /> Save
            </button>
          </div>
        </div>
        {evalAvg !== null && (
          <p className="mt-3 text-sm text-white">
            Average: <b>{evalAvg}/100</b> over {evalDone.length} topics · writer cost ≈ ${evalCost.toFixed(3)} {saveMsg && <span className="ml-2 text-xs text-emerald-300">{saveMsg}</span>}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {topics.map((t) => {
            const r = evalRows[t.id];
            return (
              <details key={t.id} className="rounded-xl border border-white/10 bg-black/20 p-2">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs">
                  <span className="text-gray-200">
                    {t.idea} <span className="text-gray-500">· {t.language} · {t.style}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {r === "running" && <Loader2 size={12} className="animate-spin text-blue-200" />}
                    {r && r !== "running" && !r.success && <span className="text-red-300">error</span>}
                    {r && r !== "running" && r.judge && <b className={r.judge.overall >= 80 ? "text-emerald-300" : r.judge.overall >= 65 ? "text-yellow-200" : "text-red-300"}>{r.judge.overall}</b>}
                    <ChevronDown size={12} className="text-gray-500" />
                  </span>
                </summary>
                <div className="mt-2">{r && r !== "running" && <RunView r={r} />}</div>
              </details>
            );
          })}
        </div>
        {past.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Saved runs</p>
            <table className="mt-2 w-full text-left text-xs text-gray-300">
              <thead className="text-gray-500">
                <tr>
                  <th className="py-1">When</th>
                  <th>Model</th>
                  <th>Prompt</th>
                  <th>Avg</th>
                  <th>Topics</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {past.map((p) => (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className="py-1">{p.savedAt ? new Date(p.savedAt).toLocaleString() : p.id}</td>
                    <td className="font-mono">{p.model}</td>
                    <td className="font-mono">{p.promptVersion}</td>
                    <td className="font-semibold text-white">{p.average ?? "–"}</td>
                    <td>{p.count}</td>
                    <td>{typeof p.costUsd === "number" ? `$${p.costUsd.toFixed(3)}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
