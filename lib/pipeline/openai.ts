// lib/pipeline/openai.ts
// OpenAI ile full content package üretimi (server-side only).

import { languagePromptName } from "./options";

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
  /** Token usage reported by OpenAI (for the provider cost log). */
  usage?: { inputTokens: number; outputTokens: number };
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
}

/** Spoken-word budget for a duration label ("30 seconds" → 65 words). */
function wordBudget(duration: string | null | undefined): number {
  const d = (duration ?? "60 seconds").toLowerCase();
  const n = Number(d.match(/\d+/)?.[0] ?? 60);
  const seconds = d.includes("minute") ? n * 60 : n;
  return Math.max(40, Math.round(seconds * 2.2));
}

export async function generateScript(params: ScriptParams): Promise<ScriptResult> {
  const { idea, platform, style, duration, outputLanguage, model, orientation, brief, research } = params;
  const aspect = orientation === "vertical" ? "9:16 vertical" : "16:9 horizontal";

  const systemPrompt = `You are an expert short-form and YouTube video content strategist.
Respond ONLY with a valid JSON object, no markdown, no extra text. Schema:
{
  "hook": "attention-grabbing opening line (max 2 sentences)",
  "script": "full voice-over script",
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "what happens in this scene, in output language",
      "videoPrompt": "cinematic ENGLISH text-to-video prompt for this scene"
    }
  ],
  "titles": ["title option 1", "title option 2", "title option 3", "title option 4", "title option 5"],
  "description": "SEO-friendly video description",
  "tags": ["tag1", "tag2", "tag3"],
  "thumbnailIdea": "a vivid, cinematic ENGLISH image-generation prompt for a ${aspect} thumbnail including short bold overlay text direction"
}
Rules:
- "hook", "script", scene "description", title options, and "description" must be written in this language: ${languagePromptName(outputLanguage)}
- every "videoPrompt" must ALWAYS be in English regardless of output language.
- "thumbnailIdea" must ALWAYS be in English regardless of output language.
- return 5 titles exactly.
- return 5-8 scenes suitable for the target duration.
- "tags" should be concise SEO tags without # symbols.
- Match the tone to the platform and style.
- HARD LENGTH LIMIT: the hook + script together are read aloud at ~2.3 words per second, so they must total AT MOST ${wordBudget(duration)} words (target ${Math.round(wordBudget(duration) * 0.9)}). Count before answering; never exceed it.
- The video is ${aspect}; compose every videoPrompt and the thumbnail for that framing (e.g. subjects centred and tall for vertical).
- If the topic involves real people, teams, companies or brands: videoPrompts must NOT depict identifiable real people, faces, logos, crests or jersey names. Show atmosphere, places, objects, crowds and colours instead (e.g. "fans in red-and-yellow striped shirts"), and never ask for readable text, scoreboards or signs — generated text is always wrong.${brief ? `\n- ${brief}` : ""}${research ? `\n\nVERIFIED RESEARCH BRIEF — the ONLY source of truth for any claim about real events, people, numbers, dates or outcomes. Build the script on these facts, do not invent or "remember" others, and do not contradict them:\n${research}` : ""}`;

  const userPrompt = `Video idea: ${idea}
Platform: ${platform}
Style: ${style ?? "creator's choice"}
Target duration: ${duration ?? "60 seconds"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  const usage =
    data?.usage && typeof data.usage === "object"
      ? {
          inputTokens: Number(data.usage.prompt_tokens ?? 0),
          outputTokens: Number(data.usage.completion_tokens ?? 0),
        }
      : undefined;
  if (!content) {
    throw new Error("OpenAI returned an empty response.");
  }

  let parsed: ScriptResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI response was not valid JSON.");
  }

  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const titles = Array.isArray(parsed.titles) ? parsed.titles : [];
  const tags = Array.isArray(parsed.tags) ? parsed.tags : [];

  if (!parsed.hook || !parsed.script || !parsed.thumbnailIdea) {
    throw new Error("OpenAI response is missing required fields (hook/script/thumbnailIdea).");
  }

  if (scenes.length === 0 || titles.length === 0) {
    throw new Error("OpenAI response is missing scenes or titles.");
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
    throw new Error("OpenAI did not return usable scenes.");
  }

  const normalizedTitles = titles
    .map((title) => String(title ?? "").trim())
    .filter((title) => title.length > 0)
    .slice(0, 5);

  if (normalizedTitles.length === 0) {
    throw new Error("OpenAI did not return usable titles.");
  }

  const normalizedTags = tags
    .map((tag) => String(tag ?? "").trim())
    .filter((tag) => tag.length > 0)
    .slice(0, 12);

  return {
    hook: parsed.hook,
    script: parsed.script,
    scenes: normalizedScenes,
    titles: normalizedTitles,
    description: parsed.description ?? "",
    tags: normalizedTags,
    thumbnailIdea: parsed.thumbnailIdea,
    thumbnailPrompt: parsed.thumbnailIdea,
    usage,
  };
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
}

/**
 * Fact-finding pass using OpenAI's built-in web search (Responses API).
 * Returns a brief the script step must treat as the only source of truth for
 * claims about real events, people, numbers and dates.
 */
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
- 120–220 words, plain paragraphs or short bullets, no headings, no markdown links in the text.`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input: `Topic: ${idea}`,
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
    }),
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
  if (!brief.trim()) throw new Error("Research returned no text.");

  const usage =
    data?.usage && typeof data.usage === "object"
      ? { inputTokens: Number(data.usage.input_tokens ?? 0), outputTokens: Number(data.usage.output_tokens ?? 0) }
      : undefined;
  return { brief: brief.trim().slice(0, 4000), sources: sources.slice(0, 10), usage };
}
