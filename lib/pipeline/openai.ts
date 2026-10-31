// lib/pipeline/openai.ts
// OpenAI ile full content package üretimi (server-side only).

import { languageCode, languagePromptName } from "./options";
import { narrationWordCount, wordRange, wordsPerSecond } from "./narration";
import { chatJSON, llmUsageKey, type LlmUsage } from "./llm";
import { exampleBlock } from "./script-examples";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set.");
}

export interface ScriptResult {
  hook: string;
  script: string;
  scenes: Array<{
    sceneNumber: number;
    description: string;
    videoPrompt: string;
  }>;
  titles: string[];
  description: string;
  tags: string[];
  thumbnailIdea: string;
  thumbnailPrompt: string; // Backward-compatible alias used by thumbnail step
  /** Token usage summed over all script passes (for the provider cost log). */
  usage?: { inputTokens: number; outputTokens: number };
  /** Provider-qualified model id for the cost log, e.g. "openai:gpt-5-mini". */
  usageKey?: string;
  /** Stage-1 story plan the narration was written from. */
  plan?: StoryPlan | null;
  /** Result of the fact-check pass (only runs with a research brief). */
  factCheck?: { checked: boolean; issues: FactCheckIssue[] };
  promptVersion?: string;
}

interface ScriptParams {
  idea: string;
  platform: string;
  style?: string | null;
  duration?: string | null;
  outputLanguage: string;
  model: string; // from steps.ts, e.g. "gpt-5-mini"
  /** "vertical" (9:16) or "horizontal" (16:9). */
  orientation?: "vertical" | "horizontal";
  /** Extra genre guidance from a niche template. */
  brief?: string | null;
  /** Verified research brief (from researchTopic); the only source of truth for real-world claims. */
  research?: string | null;
  /** Optional creator notes: angle, focus, things to include or avoid. */
  notes?: string | null;
}

/** Bump when the script prompts change; stored on every job for comparisons. */
export const SCRIPT_PROMPT_VERSION = "2026-10-31.plan-factcheck";

export interface StoryPlan {
  /** The one question the viewer wants answered. */
  question: string;
  /** Verified facts the narration may use (each short, concrete). */
  facts: string[];
  /** Ordered story beats, events before explanations. */
  beats: string[];
  /** The payoff / answer / current understanding, delivered at the end. */
  reveal: string;
  /** Hook candidates: literally true, intriguing, no spoiler. */
  hooks: string[];
  /** Things that are legend, disputed or unknown — must be hedged if used. */
  uncertain: string[];
}

export interface FactCheckIssue {
  sentence: string;
  problem: string;
}

/** Plan the story before writing a word of narration (stage 1). */
async function planStory(args: {
  idea: string;
  style?: string | null;
  research?: string | null;
  notes?: string | null;
  outputLanguage: string;
  model: string;
  seconds: number;
}): Promise<{ plan: StoryPlan; usage?: LlmUsage } | null> {
  const { idea, style, research, notes, outputLanguage, model, seconds } = args;
  const { data, usage } = await chatJSON<Partial<StoryPlan>>({
    model,
    effort: "low",
    timeoutMs: 60_000,
    system: `You are the story editor of a documentary Shorts channel. Before anything is written, you plan a ${seconds}-second narrated video. Respond ONLY with JSON:
{"question": "...", "facts": ["..."], "beats": ["..."], "reveal": "...", "hooks": ["...", "...", "..."], "uncertain": ["..."]}
Rules:
- "facts": 6–12 short, concrete facts (names, dates, places, numbers, what happened). ${research ? "Take them ONLY from the research brief; never add facts from memory." : "Only facts that are widely documented; if the topic is a legend or obscure, keep facts minimal and say so in 'uncertain'."}
- "question": the single question that will keep a viewer watching.
- "beats": 4–6 beats in viewing order. Events and evidence come first; explanations, theories or debunking come LAST.
- "reveal": the honest payoff — the answer, the best current explanation, or the fact that it is still unsolved.
- "hooks": three different opening lines, 4–8 words each, that are LITERALLY TRUE per the facts, create curiosity and do NOT give away the reveal.
- "uncertain": claims that are legends, disputed, unverified or commonly misreported — they may only appear hedged.
- Write every field in ${languagePromptName(outputLanguage)}.${notes ? `\n- The creator asked for this angle; follow it unless it conflicts with the facts: ${notes}` : ""}`,
    user: `Video idea: ${idea}\nStyle: ${style ?? "creator's choice"}${research ? `\n\nRESEARCH BRIEF:\n${research}` : "\n\n(No research brief is available.)"}`,
  });
  const list = (v: unknown, max: number) =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max) : [];
  const plan: StoryPlan = {
    question: String(data.question ?? "").trim(),
    facts: list(data.facts, 14),
    beats: list(data.beats, 8),
    reveal: String(data.reveal ?? "").trim(),
    hooks: list(data.hooks, 4),
    uncertain: list(data.uncertain, 8),
  };
  if (!plan.beats.length || !plan.facts.length) return null;
  return { plan, usage };
}

function planBlock(plan: StoryPlan): string {
  return `\n\nSTORY PLAN (approved by the editor — follow it):
Viewer question: ${plan.question}
Facts you may use (do not add others):\n${plan.facts.map((f) => `- ${f}`).join("\n")}
Beats in order:\n${plan.beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}
Payoff (deliver at the END, never in the hook): ${plan.reveal}
Hook options (pick or sharpen one; it must stay literally true): ${plan.hooks.join(" | ")}${
    plan.uncertain.length ? `\nOnly mention these hedged (legend/disputed): ${plan.uncertain.join("; ")}` : ""
  }`;
}

export async function generateScript(params: ScriptParams): Promise<ScriptResult> {
  const { idea, platform, style, duration, outputLanguage, orientation, brief, research, notes } = params;
  const model = params.model;
  const aspect = orientation === "vertical" ? "9:16 vertical" : "16:9 horizontal";
  const range = wordRange(duration, languageCode(outputLanguage));
  // The worker has 300 s; optional passes are skipped when time runs short.
  const startedAt = Date.now();
  const timeLeft = () => 250_000 - (Date.now() - startedAt);

  let usageTotal: LlmUsage | undefined;
  const addUsage = (u?: LlmUsage) => {
    if (!u) return;
    usageTotal = usageTotal
      ? { inputTokens: usageTotal.inputTokens + u.inputTokens, outputTokens: usageTotal.outputTokens + u.outputTokens }
      : u;
  };

  // Stage 1 — plan the story from the facts (skipped silently on failure).
  const planned = await planStory({ idea, style, research, notes, outputLanguage, model, seconds: range.seconds }).catch(
    (err) => {
      console.warn("[script] story plan failed:", err instanceof Error ? err.message : err);
      return null;
    }
  );
  addUsage(planned?.usage);
  const plan = planned?.plan ?? null;

  const systemPrompt = `You are a senior writer-director for faceless YouTube and Shorts channels (documentary, mystery, history, educational). Your scripts are the kind that keep 70%+ of viewers to the end: specific, visual, surprising, never generic.
Respond ONLY with a valid JSON object, no markdown, no extra text. Schema:
{
  "hook": "the opening line spoken AND shown on screen for the first 3 seconds: ONE sentence, 4–8 words MAX — a concrete, literally true and surprising claim, number or contradiction about THIS topic that raises a question without answering it. Never 'Did you know', never a question longer than 7 words, never 'In this video'",
  "script": "full voice-over script, starting with the hook sentence verbatim",
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "what happens in this scene, in output language",
      "videoPrompt": "cinematic ENGLISH text-to-video prompt for this scene (see the VISUAL PROMPT rules)"
    }
  ],
  "titles": ["title option 1", "title option 2", "title option 3", "title option 4", "title option 5"],
  "description": "SEO-friendly video description",
  "tags": ["tag1", "tag2", "tag3"],
  "thumbnailIdea": "a vivid, cinematic ENGLISH image-generation prompt for a ${aspect} thumbnail including short bold overlay text direction"
}
Rules:
- "hook", "script", scene "description", title options, and "description" must be written in this language: ${languagePromptName(outputLanguage)}. Write like a native professional narrator of that language, not like a translation.
- every "videoPrompt" must ALWAYS be in English regardless of output language.
- "thumbnailIdea" must ALWAYS be in English regardless of output language.
- return 5 titles exactly.
- return 5-8 scenes in the same order as the narration; scene 1 is the hook moment; each scene illustrates what the narrator is saying at that point.
- "tags" should be concise SEO tags without # symbols.
- Match the tone to the platform and style.
- STORY FIRST: the script tells ONE story as a single connected thread — chronological or cause → effect. Each sentence must follow logically from the one before it; a listener who hears only the audio must always know who and what is being talked about. Never a list of disconnected claims.
- SCRIPT CRAFT (retention structure for Shorts, written in your own words — do not copy stock phrases): (1) HOOK 0–3 s: the hook sentence. (2) PROMISE: one sentence that opens a curiosity loop about THIS story. (3) CONTEXT: at most 2 sentences — who, where, when. (4) PAYOFF: 2–3 concrete beats (names, dates, places, what actually happened), each a new image; optionally one mid-point re-hook if the story genuinely has a second twist. (5) CLOSE every loop you opened, then one final line that lands an emotion or a question for the comments. Rhythm: vary sentence length (short punch, then 12–16 words, then short again); no sentence over 18 words; no nested clauses; no filler transitions, no greetings, no "in this video", no restating.
- NO SPOILERS, NO FALSE CLAIMS: the hook must create mystery WITHOUT revealing the answer or verdict — tease, don't tell (never open with "it's just a legend" or "it was all a lie"). But it must not assert as proven fact something the story later shows to be doubtful; phrase it as an intriguing true claim, contradiction or open question that the ending pays off. The hook is a factual claim like any other: it must be literally true and supported by the research (no dramatic exaggeration). Explanations, theories and debunking come after the events, near the end.
- NO FILLER, NO META: never write sentences about the video, the footage, archive photos, "documents", "sources" or "the clipping" themselves (e.g. "archive photos show the streets", "the documents are partly contradictory") unless a specific document IS the story. Never repeat a fact in new words to gain length. If facts are thin, reach the length with true, vivid context (the place, the era, the people's situation) — never with invented details or empty sentences.
- WRITE FOR THE VOICE: this text is read by a TTS narrator. Use commas and full stops to create natural breaths, an ellipsis "…" for a dramatic pause before a reveal, and spell numbers the way they are spoken in the output language when ambiguous. No abbreviations (write "December", "Naval Air Station"), no semicolons, no parentheses. Proofread spelling and diacritics carefully (for Turkish: ç ğ ı İ ö ş ü, apostrophes in proper-noun suffixes like "Keops'un"); a single typo is burned into the subtitles.
- VISUAL PROMPT rules — each videoPrompt is a complete shot description for a photoreal AI video/image model, 35–60 words, in this order: (1) shot type and lens (e.g. "extreme close-up, 85mm" / "wide aerial establishing shot"), (2) the single clear subject and what it is doing, (3) environment and era-accurate details, (4) lighting and time of day, (5) colour palette/mood, (6) one slow steady camera move. Every scene must show a DIFFERENT subject or location — never two scenes of the same thing; alternate wide and close shots; keep one consistent palette across the video. Prefer physical, filmable things (objects, places, hands, textures, weather, crowds from behind) over abstract concepts. No text, signs, maps with labels, diagrams, or UI in any shot.
- STRICT LENGTH: the hook + script together are read aloud at ~${wordsPerSecond(languageCode(outputLanguage))} words per second in ${languagePromptName(outputLanguage)}. For the target duration they MUST total between ${range.min} and ${range.max} words (aim for ${range.target}). Count the words before answering; do not go under or over.
- The video is ${aspect}; compose every videoPrompt and the thumbnail for that framing (subjects centred, room above and below the subject for vertical). Do NOT write the words "vertical", "portrait", "tall framing", "9:16", "horizontal" or "16:9" inside a videoPrompt — the aspect ratio is set separately, and those words make the video model rotate the picture. Describe a steady, level camera (slow push-in, gentle pan, static); never ask for camera roll, spinning, flipping or orbiting.
- If the topic involves real people, teams, companies or brands: videoPrompts must NOT depict identifiable real people, faces, logos, crests or jersey names. Show atmosphere, places, objects, crowds and colours instead (e.g. "fans in red-and-yellow striped shirts"), and never ask for readable text, scoreboards or signs — generated text is always wrong.${brief ? `\n- ${brief}` : ""}${notes ? `\n- CREATOR'S NOTES (follow them unless they conflict with the facts or these rules): ${notes}` : ""}${research ? "" : "\n- NO VERIFIED RESEARCH IS AVAILABLE for this video. If it is about real people or historical events, only state facts you are highly confident are widely documented (well-known names, dates, places). Do NOT invent occupations, causes of death, locations, quotes, numbers or document details. When a story is a legend, a newspaper claim or disputed, say so explicitly (e.g. 'anlatılana göre', 'dönemin gazetelerine göre', 'according to the newspapers of the time'). Accuracy beats drama."}${research ? `\n\nVERIFIED RESEARCH BRIEF — the ONLY source of truth for any claim about real events, people, numbers, dates or outcomes. Build the script on these facts, do not invent or "remember" others, and do not contradict them:\n${research}` : ""}${plan ? planBlock(plan) : ""}${exampleBlock(style)}`;

  const userPrompt = `Video idea: ${idea}
Platform: ${platform}
Style: ${style ?? "creator's choice"}
Target duration: ${duration ?? "60 seconds"}`;

  // Stage 2 — write the narration + scene plan.
  const draft = await chatJSON<ScriptResult>({
    model,
    system: systemPrompt,
    user: userPrompt,
    timeoutMs: Math.max(60_000, Math.min(170_000, timeLeft() - 30_000)),
  });
  addUsage(draft.usage);
  const parsed = draft.data;

  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const titles = Array.isArray(parsed.titles) ? parsed.titles : [];
  const tags = Array.isArray(parsed.tags) ? parsed.tags : [];

  if (!parsed.hook || !parsed.script || !parsed.thumbnailIdea) {
    throw new Error("Script model response is missing required fields (hook/script/thumbnailIdea).");
  }

  if (scenes.length === 0 || titles.length === 0) {
    throw new Error("Script model response is missing scenes or titles.");
  }

  const normalizedScenes = scenes
    .filter((scene) => scene && typeof scene === "object")
    .map((scene, index) => {
      const typedScene = scene as {
        sceneNumber?: number;
        description?: string;
        videoPrompt?: string;
      };

      return {
        sceneNumber:
          typeof typedScene.sceneNumber === "number"
            ? typedScene.sceneNumber
            : index + 1,
        description: typedScene.description ?? "",
        videoPrompt: typedScene.videoPrompt ?? "",
      };
    })
    .filter(
      (scene) =>
        scene.description.trim().length > 0 && scene.videoPrompt.trim().length > 0
    );

  if (normalizedScenes.length === 0) {
    throw new Error("Script model did not return usable scenes.");
  }

  const normalizedTitles = titles
    .map((title) => String(title ?? "").trim())
    .filter((title) => title.length > 0)
    .slice(0, 5);

  if (normalizedTitles.length === 0) {
    throw new Error("Script model did not return usable titles.");
  }

  const normalizedTags = tags
    .map((tag) => String(tag ?? "").trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 12);

  let hook = String(parsed.hook);
  let script = String(parsed.script);

  // Stage 3 — editor pass: coherence, contradictions, filler, fluency.
  if (timeLeft() > 90_000) {
    const edited = await editNarration({ hook, script, idea, research, range, outputLanguage, model }).catch(() => null);
    if (edited) {
      hook = edited.hook;
      script = edited.script;
      addUsage(edited.usage);
    }
  }

  // Stage 4 — fact check against the research brief (only when there is one).
  let factCheck: { checked: boolean; issues: FactCheckIssue[] } = { checked: false, issues: [] };
  if (research && timeLeft() > 60_000) {
    const fc = await factCheckNarration({ hook, script, research, range, outputLanguage, model }).catch((err) => {
      console.warn("[script] fact check failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (fc) {
      factCheck = { checked: true, issues: fc.issues };
      hook = fc.hook;
      script = fc.script;
      addUsage(fc.usage);
    }
  }

  // Length guard: if the narration misses the range, ask for one rewrite of
  // hook + script only (scenes etc. stay), then accept whatever comes back.
  const count = narrationWordCount(hook, script);
  if ((count < range.min || count > range.max) && timeLeft() > 45_000) {
    const fixed = await reviseNarrationLength({ hook, script, range, outputLanguage, model, count }).catch(() => null);
    if (fixed) {
      hook = fixed.hook;
      script = fixed.script;
      addUsage(fixed.usage);
    }
  }

  return {
    hook,
    script,
    scenes: normalizedScenes,
    titles: normalizedTitles,
    description: parsed.description ?? "",
    tags: normalizedTags,
    thumbnailIdea: parsed.thumbnailIdea,
    thumbnailPrompt: parsed.thumbnailIdea,
    usage: usageTotal,
    usageKey: llmUsageKey(model),
    plan,
    factCheck,
    promptVersion: SCRIPT_PROMPT_VERSION,
  };
}

/** Narration-only result shared by the editor, fact-check and length passes. */
type NarrationFix = { hook: string; script: string; usage?: LlmUsage };

function readNarration(data: Record<string, unknown>, usage?: LlmUsage): NarrationFix | null {
  if (typeof data?.hook !== "string" || typeof data?.script !== "string") return null;
  const hook = data.hook.trim();
  const script = data.script.trim();
  if (!hook || !script) return null;
  return { hook, script, usage };
}

/**
 * Editor pass: re-reads hook + script like a story editor and fixes
 * incoherent, contradictory, padded, meta or invented sentences, keeping the
 * same length range. Returns null if the call fails (caller keeps the draft).
 */
async function editNarration(args: {
  hook: string;
  script: string;
  idea: string;
  research?: string | null;
  range: { min: number; target: number; max: number; seconds: number };
  outputLanguage: string;
  model: string;
}): Promise<NarrationFix | null> {
  const { hook, script, idea, research, range, outputLanguage, model } = args;
  const language = languagePromptName(outputLanguage);
  const facts = research
    ? `VERIFIED RESEARCH (the only allowed source for real-world facts):\n${research}`
    : "NO VERIFIED RESEARCH: remove or hedge ('anlatılana göre' / 'according to reports') any specific claim about real people or events that is not widely documented; never add new specifics.";
  const { data, usage } = await chatJSON({
    model,
    effort: "low",
    timeoutMs: 75_000,
    system: `You are the story editor of a documentary Shorts channel and a native ${language} speaker. You receive a voice-over draft. Read it sentence by sentence as a listener who only hears the audio, and rewrite it so that:
1. It is ONE connected story: every sentence follows logically from the previous one; it is always clear who/what is meant; no jumps, no disconnected statements.
2. Nothing contradicts anything else: a claim stated as fact is not doubted later. The hook must keep the mystery (never reveal the answer or verdict up front) but must not assert as proven something the ending debunks.
3. Background and verdicts come late: do not explain the legend away in the first half; let the events play out first, then the explanation. There are no filler or meta sentences (about the video, footage, archive photos, documents, sources, "the clipping") and no repetitions of the same point.
4. No fact is invented — check the hook too: it must be literally true, not a dramatic exaggeration. ${research ? "Every real-world claim must be supported by the research below; remove or correct anything that is not." : "Unverifiable specifics are removed or clearly hedged."}
5. It is written for the ear: no abbreviations a narrator would stumble on (write 'Naval Air Station', not 'NAS'), no semicolons or stacked clauses, and every sentence grammatically complete. It sounds natural and fluent in ${language}, with correct grammar, spelling and diacritics — like a professional narrator wrote it, not a translation.
Keep the strongest hook possible (one sentence, 4–8 words, consistent with the rest), keep the script starting with the hook sentence verbatim, and keep hook + script together between ${range.min} and ${range.max} words (aim for ${range.target}). Respond ONLY with JSON {"hook": "...", "script": "..."} in ${language}.`,
    user: `Video idea: ${idea}\n\n${facts}\n\nHOOK:\n${hook}\n\nSCRIPT:\n${script}`,
  });
  return readNarration(data, usage);
}

/**
 * Fact-check pass: every sentence (hook included) is checked against the
 * research brief; unsupported or overstated claims are corrected or removed.
 */
async function factCheckNarration(args: {
  hook: string;
  script: string;
  research: string;
  range: { min: number; target: number; max: number; seconds: number };
  outputLanguage: string;
  model: string;
}): Promise<(NarrationFix & { issues: FactCheckIssue[] }) | null> {
  const { hook, script, research, range, outputLanguage, model } = args;
  const language = languagePromptName(outputLanguage);
  const { data, usage } = await chatJSON<Record<string, unknown>>({
    model,
    effort: "low",
    timeoutMs: 60_000,
    system: `You are a strict fact-checker for a documentary channel. Compare EVERY sentence of the narration (including the hook) with the research brief.
A sentence is a problem if it states something the research does not support, exaggerates it (e.g. "without a trace" when there were radio calls), gets a name/number/date wrong, or states a legend or disputed claim as fact.
Fix each problem with the smallest possible change: correct it, hedge it ("according to…", "reportedly", or the natural equivalent in ${language}), or remove it. Do not touch sentences that are fine, do not add new facts, keep the style, keep the script starting with the hook verbatim, and keep hook + script between ${range.min} and ${range.max} words.
Respond ONLY with JSON: {"issues": [{"sentence": "original sentence", "problem": "short reason"}], "hook": "...", "script": "..."} — "issues" is [] when everything is supported. Write hook and script in ${language}.`,
    user: `RESEARCH BRIEF:\n${research}\n\nHOOK:\n${hook}\n\nSCRIPT:\n${script}`,
  });
  const fixed = readNarration(data, usage);
  if (!fixed) return null;
  const issues: FactCheckIssue[] = Array.isArray(data.issues)
    ? (data.issues as Array<Record<string, unknown>>)
        .map((i) => ({ sentence: String(i?.sentence ?? "").slice(0, 400), problem: String(i?.problem ?? "").slice(0, 300) }))
        .filter((i) => i.sentence || i.problem)
        .slice(0, 12)
    : [];
  // A fact check that rewrote the hook keeps the script consistent with it.
  if (!fixed.script.startsWith(fixed.hook)) fixed.script = `${fixed.hook} ${fixed.script}`;
  return { ...fixed, issues };
}

export async function reviseNarrationLength(args: {
  hook: string;
  script: string;
  range: { min: number; target: number; max: number; seconds: number };
  outputLanguage: string;
  model: string;
  count: number;
}): Promise<NarrationFix | null> {
  const { hook, script, range, outputLanguage, model, count } = args;
  const direction =
    count < range.min
      ? "too short — expand it by developing the existing story (more vivid context about the same people, place and moment); never invent new facts, names, numbers or quotes, and never add filler or sentences about the video/sources"
      : "too long — tighten it, cutting the weakest sentences first";
  const { data, usage } = await chatJSON({
    model,
    effort: "low",
    timeoutMs: 60_000,
    system: `You edit voice-over narration for length. Respond ONLY with JSON {"hook": "...", "script": "..."} in ${languagePromptName(outputLanguage)}. Rules:
- The hook stays EXACTLY as given, and the script must START with the hook sentence verbatim (it is the first thing the narrator says).
- Keep every fact and the meaning; keep it one connected story; change wording only as needed.
- Write for the ear: no abbreviations (write "December", "Naval Air Station", not "Dec", "NAS"), no semicolons, every sentence grammatically complete, natural and fluent ${languagePromptName(outputLanguage)}.`,
    user: `This narration is ${count} words, which is ${direction}. Rewrite so that hook + script together are between ${range.min} and ${range.max} words (aim for ${range.target}) — it must be spoken in about ${range.seconds} seconds. Count carefully.\n\nHOOK:\n${hook}\n\nSCRIPT:\n${script}`,
  });
  const out = readNarration(data, usage);
  if (!out) return null;
  // The hook card on screen shows the original hook, so the narration must
  // open with it too (31 Oct: a length rewrite dropped it from the audio).
  const keptHook = hook.trim();
  let revised = out.script;
  if (keptHook && !revised.startsWith(keptHook)) revised = `${keptHook} ${revised}`;
  return { hook: keptHook || out.hook, script: revised, usage: out.usage };
}
/* ---------------- Research (web search before the script) ---------------- */

export interface ResearchSource {
  title: string;
  url: string;
}

export interface ResearchResult {
  /** Dated, factual brief in the output language (≈120–220 words). */
  brief: string;
  sources: ResearchSource[];
  usage?: { inputTokens: number; outputTokens: number };
}

interface ResearchParams {
  idea: string;
  outputLanguage: string;
  model: string;
  /** ISO date of "today" so the model knows what "yesterday" means. */
  today?: string;
  /** Creator's angle/notes — what the video should focus on. */
  notes?: string | null;
}

/**
 * Fact-finding pass using OpenAI's built-in web search (Responses API).
 * Returns a brief the script step must treat as the only source of truth for
 * claims about real events, people, numbers and dates.
 */
/** Hard cap for one research call (the worker function itself is capped). */
export const RESEARCH_TIMEOUT_MS = 80_000;

export async function researchTopic(params: ResearchParams): Promise<ResearchResult> {
  const { idea, outputLanguage, model } = params;
  const today = params.today ?? new Date().toISOString().slice(0, 10);
  const language = languagePromptName(outputLanguage);

  const instructions = `You are a fact-checker preparing a research brief for a short video script.
Today's date is ${today}. Search the web for the most recent, reliable information about the topic.
Write the brief in ${language}. Rules:
- Only include facts you found in sources; never guess. If something is disputed or unknown, say so.
- Prefer primary and reputable sources (official sites, major news outlets, encyclopedias). For "yesterday"/"last night" style topics, find the exact date and the concrete events.
- Include the concrete details a script needs: who, what, when (exact dates), where, numbers, outcomes, quotes if notable.
- Write it as story material: the sequence of events, the single most surprising VERIFIED detail, and the current best explanation or verdict.
- ALWAYS include the details the story is best known for — the facts every documentary about it mentions (e.g. for a famous case: what was found, where exactly, in what state) — with precise places, distances and numbers. A brief that omits the iconic facts is a failed brief.
- Search in English and, where relevant, in the language of the country where it happened; prefer encyclopedias, official reports and major outlets.
- Clearly separate what is documented from what is legend, rumour, disputed or commonly misreported (a short "Disputed/legend:" line), so the script never states myths as facts.
- 150–280 words, plain paragraphs or short bullets, no headings, no markdown links in the text.`;

  // The worker function has a hard time limit, so a slow search must give up
  // early: the runner then skips research (refunding it) instead of letting
  // the whole job die with the function.
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input: `Topic: ${idea}${params.notes ? `\nCreator's angle: ${params.notes}` : ""}`,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "auto",
      reasoning: { effort: "low" },
      // Reasoning tokens count toward this cap. At 900 the model sometimes
      // spent it all thinking after the search and returned no text
      // (31 Oct: "Research returned no text" on a history topic).
      max_output_tokens: 6000,
    }),
    signal: AbortSignal.timeout(RESEARCH_TIMEOUT_MS),
  }).catch((err: unknown) => {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`Web research timed out after ${Math.round(RESEARCH_TIMEOUT_MS / 1000)} s.`);
    }
    throw err;
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI research error (${res.status}): ${errBody.slice(0, 300)}`);
  }
  const data = await res.json();

  // Responses API: output[] holds tool calls and a final "message" with
  // content parts; url_citation annotations carry the sources.
  let brief = "";
  const sources: ResearchSource[] = [];
  const seen = new Set<string>();
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        brief += (brief ? "\n" : "") + part.text;
        for (const a of Array.isArray(part.annotations) ? part.annotations : []) {
          if (a?.type === "url_citation" && typeof a.url === "string" && !seen.has(a.url)) {
            seen.add(a.url);
            sources.push({ title: String(a.title ?? a.url).slice(0, 160), url: a.url.slice(0, 500) });
          }
        }
      }
    }
  }
  if (!brief.trim() && typeof data?.output_text === "string") brief = data.output_text;
  if (!brief.trim()) {
    const why = data?.status === "incomplete" ? ` (incomplete: ${data?.incomplete_details?.reason ?? "unknown"})` : "";
    throw new Error(`Research returned no text${why}.`);
  }

  const usage =
    data?.usage && typeof data.usage === "object"
      ? { inputTokens: Number(data.usage.input_tokens ?? 0), outputTokens: Number(data.usage.output_tokens ?? 0) }
      : undefined;
  return { brief: brief.trim().slice(0, 4000), sources: sources.slice(0, 10), usage };
}
