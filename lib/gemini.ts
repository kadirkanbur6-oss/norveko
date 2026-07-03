const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = process.env.GEMINI_API_URL ?? "https://api.openai.com/v1/responses";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

if (!GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY environment variable.");
}

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

  const response = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GEMINI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      input: prompt,
      max_output_tokens: 400,
    }),
  });

  const result = await response.json();

  if (!response.ok) {
    const message = result?.error?.message || `Gemini API error (${response.status})`;
    throw new Error(message);
  }

  const rawText = extractResponseText(result);

  if (!rawText) {
    throw new Error("Gemini API returned no text output.");
  }

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

function extractResponseText(result: any) {
  if (typeof result.output_text === "string") {
    return result.output_text;
  }

  if (Array.isArray(result.output)) {
    const textContent = result.output
      .flatMap((item: any) => item?.content ?? [])
      .filter((block: any) => block?.type === "output_text")
      .map((block: any) => block?.text)
      .filter(Boolean);

    if (textContent.length > 0) {
      return textContent.join("\n");
    }
  }

  if (Array.isArray(result.choices) && result.choices[0]) {
    const choice = result.choices[0];
    if (typeof choice.text === "string") {
      return choice.text;
    }
    if (choice.message) {
      if (typeof choice.message.content === "string") {
        return choice.message.content;
      }
      if (Array.isArray(choice.message.content)) {
        return choice.message.content
          .map((block: any) => (block?.text ? block.text : ""))
          .join("\n");
      }
    }
  }

  return null;
}
