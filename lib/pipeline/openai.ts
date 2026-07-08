// lib/pipeline/openai.ts
// OpenAI ile senaryo + hook üretimi (server-side only).

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY environment değişkeni tanımlı değil.");
}

export interface ScriptResult {
  hook: string;
  script: string;
  thumbnailPrompt: string; // Gemini'ye verilecek görsel promptu
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

  const systemPrompt = `You are an expert short-form and YouTube video scriptwriter.
Respond ONLY with a valid JSON object, no markdown, no extra text. Schema:
{
  "hook": "attention-grabbing opening line (max 2 sentences)",
  "script": "full voice-over script",
  "thumbnailPrompt": "a vivid, cinematic ENGLISH image-generation prompt for the video thumbnail, 16:9, includes short bold overlay text idea"
}
Rules:
- "hook" and "script" must be written in this language: ${outputLanguage}
- "thumbnailPrompt" must ALWAYS be in English regardless of output language.
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

  if (!parsed.hook || !parsed.script || !parsed.thumbnailPrompt) {
    throw new Error("OpenAI yanıtında beklenen alanlar eksik (hook/script/thumbnailPrompt).");
  }

  return parsed;
}