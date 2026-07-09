// lib/pipeline/openai.ts
// OpenAI ile full content package üretimi (server-side only).

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment değişkeni tanımlı değil.");
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
}

interface ScriptParams {
  idea: string;
  platform: string;
  style?: string | null;
  duration?: string | null;
  outputLanguage: string;
  model: string; // steps.ts'ten gelir, ör. "gpt-5-mini"
}

export async function generateScript(params: ScriptParams): Promise<ScriptResult> {
  const { idea, platform, style, duration, outputLanguage, model } = params;

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
  "thumbnailIdea": "a vivid, cinematic ENGLISH image-generation prompt for a 16:9 thumbnail including short bold overlay text direction"
}
Rules:
- "hook", "script", scene "description", title options, and "description" must be written in this language: ${outputLanguage}
- every "videoPrompt" must ALWAYS be in English regardless of output language.
- "thumbnailIdea" must ALWAYS be in English regardless of output language.
- return 5 titles exactly.
- return 5-8 scenes suitable for the target duration.
- "tags" should be concise SEO tags without # symbols.
- Match the tone to the platform and style. Keep the script length appropriate for the target duration.`;

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
    throw new Error(`OpenAI API hatası (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const content: string | undefined = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI boş yanıt döndürdü.");
  }

  let parsed: ScriptResult;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI yanıtı geçerli JSON değil.");
  }

  const scenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const titles = Array.isArray(parsed.titles) ? parsed.titles : [];
  const tags = Array.isArray(parsed.tags) ? parsed.tags : [];

  if (!parsed.hook || !parsed.script || !parsed.thumbnailIdea) {
    throw new Error("OpenAI yanıtında beklenen alanlar eksik (hook/script/thumbnailIdea).");
  }

  if (scenes.length === 0 || titles.length === 0) {
    throw new Error("OpenAI yanıtında scenes veya titles alanı eksik/boş.");
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
    throw new Error("OpenAI scenes alanı geçerli içerik üretmedi.");
  }

  const normalizedTitles = titles
    .map((title) => String(title ?? "").trim())
    .filter((title) => title.length > 0)
    .slice(0, 5);

  if (normalizedTitles.length === 0) {
    throw new Error("OpenAI titles alanı geçerli içerik üretmedi.");
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
  };
}