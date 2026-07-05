const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

if (!GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY environment variable.");
}

// ==========================================
// SHARED HELPERS (Gemini native endpoint)
// ==========================================

async function callGemini(
  prompt: string,
  maxTokens: number,
  jsonMode: boolean = false
): Promise<string> {
  const url = `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent`;

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: maxTokens,
    thinkingConfig: { thinkingBudget: 0 },
  };

  if (jsonMode) {
    generationConfig.responseMimeType = "application/json";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": GEMINI_API_KEY as string,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    const message =
      result?.error?.message || `Gemini API error (${response.status})`;
    throw new Error(message);
  }

  const rawText = extractResponseText(result);

  if (!rawText) {
    throw new Error("Gemini API returned no text output.");
  }

  return rawText;
}

function extractResponseText(result: any): string | null {
  const candidate = result?.candidates?.[0];
  if (!candidate) return null;

  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");

  return text.length > 0 ? text : null;
}

function extractJson(rawText: string): any {
  // Strip markdown code fences first
  const cleaned = rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // Try direct parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // Fall back to extracting the first { ... last } block
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("No JSON found in response");
  }
}

// ==========================================
// CHANNEL ANALYSIS (AI INSIGHTS)
// ==========================================

export interface RecentVideoSummary {
  title: string;
  viewCount?: string | number;
  likeCount?: string | number;
  commentCount?: string | number;
  publishedAt?: string;
}

export interface ChannelInsightsInput {
  subscriberCount: string | number;
  viewCount: string | number;
  videoCount: string | number;
  growth: {
    views: number;
    subscribers: number;
    videos: number;
  };
  insufficientGrowthData?: boolean;
  recentVideos: RecentVideoSummary[];
}

export async function generateChannelInsights(input: ChannelInsightsInput) {
  const prompt = buildPrompt(input);
  const rawText = await callGemini(prompt, 800);

  return rawText
    .split(/\r?\n/)
    .map((line: string) => line.replace(/^\s*[-•*]?\s*/, "").trim())
    .filter((line: string) => line.length > 0);
}

function buildPrompt(input: ChannelInsightsInput) {
  const recentVideosText = input.recentVideos
    .map(
      (video, index) =>
        `${index + 1}. ${video.title} | views: ${video.viewCount ?? "N/A"} | likes: ${video.likeCount ?? "N/A"} | comments: ${video.commentCount ?? "N/A"} | published: ${video.publishedAt ?? "N/A"}`
    )
    .join("\n");

  return `You are an analytics assistant. Based on the channel metrics below, provide 3-4 specific, actionable insights for the creator. Use the actual numeric values and recent video examples to make the advice concrete. Avoid generic statements.

Channel metrics:
- Subscribers: ${input.subscriberCount}
- Total views: ${input.viewCount}
- Total videos: ${input.videoCount}
- Growth (7d): views ${input.growth.views}%, subscribers ${input.growth.subscribers}%, videos ${input.growth.videos}%
- Growth data available: ${input.insufficientGrowthData ? "no" : "yes"}

Recent videos:
${recentVideosText}

Provide the suggestions as short, clear bullets or numbered items. If growth data is limited, note that the growth estimate is not fully reliable and focus on the available performance signals.`;
}

// ==========================================
// AI WORKSPACE - VIDEO CONTENT GENERATION
// ==========================================

export interface VideoContentInput {
  idea: string;
  platform: string;
  style: string;
  duration: string;
  language?: string;
}

export interface VideoScene {
  sceneNumber: number;
  description: string;
  videoPrompt: string;
}

export interface VideoContentOutput {
  hook: string;
  script: string;
  scenes: VideoScene[];
  titles: string[];
  description: string;
  tags: string[];
  thumbnailIdea: string;
}

export async function generateVideoContent(
  input: VideoContentInput
): Promise<VideoContentOutput> {
  const prompt = buildVideoContentPrompt(input);
  const rawText = await callGemini(prompt, 8192, true);

  try {
    const parsed = extractJson(rawText);
    return {
      hook: parsed.hook ?? "",
      script: parsed.script ?? "",
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
      titles: Array.isArray(parsed.titles) ? parsed.titles : [],
      description: parsed.description ?? "",
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      thumbnailIdea: parsed.thumbnailIdea ?? "",
    };
  } catch {
    throw new Error("Could not parse the AI output. Please try again.");
  }
}

function buildVideoContentPrompt(input: VideoContentInput) {
  const lang = input.language || "English";

  return `You are a professional video content production assistant. Create a complete production package for the video idea below.

Video idea: ${input.idea}
Platform: ${input.platform}
Style: ${input.style}
Target duration: ${input.duration}
Output language: ${lang}

Rules:
- Write ALL text content (hook, script, scene descriptions, titles, description, tags, thumbnail idea) in ${lang}.
- EXCEPTION: videoPrompt fields must ALWAYS be in English, because they will be pasted into AI video tools like Kling or Runway.
- The script length must match the target duration.
- Scene count must match the duration (4-6 scenes for 30-60 seconds, 8-10 for 3 minutes, 12-15 for 8 minutes).
- videoPrompt fields must be detailed, cinematic English prompts ready to paste into AI video generators.
- Titles should drive clicks without being dishonest clickbait.

Respond ONLY in the following JSON format:

{
  "hook": "Attention-grabbing opening line for the first 3 seconds",
  "script": "Full voice-over script. Natural, spoken language.",
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "What happens in this scene (short description in ${lang})",
      "videoPrompt": "Detailed cinematic English prompt for AI video generation"
    }
  ],
  "titles": ["Title option 1", "Title option 2", "Title option 3"],
  "description": "Platform description. First 2 lines must hook the reader.",
  "tags": ["tag1", "tag2", "tag3"],
  "thumbnailIdea": "Detailed visual concept for the thumbnail"
}`;
}