const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

if (!GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY environment variable.");
}

// ==========================================
// ORTAK YARDIMCILAR (Gemini native endpoint)
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
  const cleaned = normalizeJsonText(rawText);

  try {
    return JSON.parse(cleaned);
  } catch {
    const candidate = extractBalancedJson(cleaned);
    if (candidate) {
      return JSON.parse(candidate);
    }
    throw new Error("JSON bulunamadı");
  }
}

function normalizeJsonText(rawText: string): string {
  return rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*json\s*/i, "")
    .trim();
}

function extractBalancedJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  return null;
}

// ==========================================
// KANAL ANALİZİ (AI INSIGHTS)
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
// AI WORKSPACE - VIDEO İÇERİK ÜRETİMİ
// ==========================================

export interface VideoContentInput {
  idea: string;
  platform: string;
  style: string;
  duration: string;
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
    throw new Error("AI çıktısı çözümlenemedi. Lütfen tekrar deneyin.");
  }
}

function buildVideoContentPrompt(input: VideoContentInput) {
  return `Sen profesyonel bir video içerik üreticisi asistanısın. Aşağıdaki video fikri için eksiksiz bir üretim paketi hazırla.

Video fikri: ${input.idea}
Platform: ${input.platform}
Stil: ${input.style}
Hedef süre: ${input.duration}

Kurallar:
- Tüm metinler Türkçe olsun (videoPrompt alanları hariç, onlar İngilizce olsun çünkü AI video araçlarında kullanılacak).
- Senaryo, seçilen süreye uygun uzunlukta olsun.
- Sahne sayısı süreye uygun olsun (30-60 saniye için 4-6 sahne, 3 dakika için 8-10 sahne, 8 dakika için 12-15 sahne).
- videoPrompt alanları Kling/Runway gibi AI video araçlarına direkt yapıştırılabilecek, sinematik, detaylı İngilizce promptlar olsun.
- Başlıklar tıklama isteği uyandırsın ama clickbait yalanı olmasın.

SADECE aşağıdaki JSON formatında cevap ver:

{
  "hook": "Videonun ilk 3 saniyesinde söylenecek dikkat çekici açılış cümlesi",
  "script": "Videonun tam seslendirme metni (voice-over). Akıcı, konuşma dilinde.",
  "scenes": [
    {
      "sceneNumber": 1,
      "description": "Bu sahnede ne oluyor (Türkçe kısa açıklama)",
      "videoPrompt": "Detailed cinematic English prompt for AI video generation"
    }
  ],
  "titles": ["Başlık önerisi 1", "Başlık önerisi 2", "Başlık önerisi 3"],
  "description": "YouTube/platform açıklaması. İlk 2 satır dikkat çekici olsun.",
  "tags": ["etiket1", "etiket2", "etiket3"],
  "thumbnailIdea": "Thumbnail için detaylı görsel fikir açıklaması"
}`;
}