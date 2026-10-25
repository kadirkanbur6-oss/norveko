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
}

export async function generateScript(params: ScriptParams): Promise<ScriptResult> {
  const { idea, platform, style, duration, outputLanguage, model, orientation, brief } = params;
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
- Match the tone to the platform and style. Keep the script length appropriate for the target duration.
- The video is ${aspect}; compose every videoPrompt and the thumbnail for that framing (e.g. subjects centred and tall for vertical).${brief ? `\n- ${brief}` : ""}`;

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