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

function extractResponseText(result: unknown): string | null {
  const r = result as { candidates?: Array<{ content?: { parts?: unknown } }> } | null;
  const candidate = r?.candidates?.[0];
  if (!candidate) return null;

  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const text = parts
    .map((part: unknown) => {
      const p = part as { text?: unknown } | null;
      return typeof p?.text === "string" ? p.text : "";
    })
    .filter(Boolean)
    .join("\n");

  return text.length > 0 ? text : null;
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
