// lib/lab/music-analyze.ts
// Lab-only: download a Kevin MacLeod (incompetech, CC BY 4.0) track, check it
// exists and is long enough, then let Gemini LISTEN to it and tag its mood.
// Used to curate lib/pipeline/music.ts instead of guessing from titles
// (31 Oct: "Hidden Agenda", a playful spy-jazz cue, landed under a tragedy).

import "server-only";

export const MOOD_TAGS = ["tragic", "eerie", "tense", "mysterious", "epic", "wonder", "upbeat", "playful"] as const;
export type MoodTag = (typeof MOOD_TAGS)[number];

export interface TrackAnalysis {
  title: string;
  ok: boolean;
  error?: string;
  bytes?: number;
  seconds?: number;
  moods?: MoodTag[];
  energy?: number;
  description?: string;
  avoidFor?: string;
}

const INCOMPETECH = "https://incompetech.com/music/royalty-free/mp3-royaltyfree/";

/** Duration of a CBR/VBR-ish MP3 from the first frame header (good enough to check ≥ 60 s). */
export function estimateMp3Seconds(buf: Buffer): number | null {
  let i = 0;
  // Skip an ID3v2 tag.
  if (buf.slice(0, 3).toString("latin1") === "ID3") {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size;
  }
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  for (; i < Math.min(buf.length - 4, 200_000); i++) {
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) {
      const versionBits = (buf[i + 1] >> 3) & 0x03; // 3 = MPEG1
      const layerBits = (buf[i + 1] >> 1) & 0x03; // 1 = Layer III
      const brIndex = (buf[i + 2] >> 4) & 0x0f;
      if (versionBits === 3 && layerBits === 1 && brIndex > 0 && brIndex < 15) {
        const kbps = bitrates[brIndex];
        return Math.round(((buf.length - i) * 8) / (kbps * 1000));
      }
    }
  }
  return null;
}

export async function analyzeTrack(title: string): Promise<TrackAnalysis> {
  const url = `${INCOMPETECH}${encodeURIComponent(title)}.mp3`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { title, ok: false, error: `download HTTP ${res.status}` };
  const type = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (!/audio|mpeg|octet/.test(type) || buf.length < 100_000) return { title, ok: false, error: `not audio (${type}, ${buf.length} B)` };
  const seconds = estimateMp3Seconds(buf) ?? undefined;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return { title, ok: false, error: "GEMINI_API_KEY is not set." };
  const model = process.env.MUSIC_ANALYZE_MODEL || "gemini-3.8-flash";
  const prompt = `Listen to this instrumental track and judge it as background music under a narrated 60-second documentary Short.
Return ONLY JSON: {"moods": [...], "energy": 1-5, "description": "one sentence: instruments, tempo, feeling", "avoidFor": "topics it would be wrong for"}.
"moods" = 1–3 tags from exactly this list, best first: ${MOOD_TAGS.join(", ")}.
tragic = sad, mournful, somber, fit for deaths and disasters. eerie = unsettling, dark ambient, horror. tense = suspense, investigation, building dread. mysterious = intriguing, curious, not scary. epic = grand, cinematic, heroic. wonder = light, hopeful, curious, science. upbeat = energetic, positive. playful = quirky, comedic, jazzy, light-hearted (wrong for any serious topic).
Be honest: if it sounds jazzy, cheeky or like a caper, it is playful, not mysterious.`;
  const g = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/mpeg", data: buf.toString("base64") } }, { text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
    signal: AbortSignal.timeout(100_000),
  });
  if (!g.ok) return { title, ok: false, bytes: buf.length, seconds, error: `Gemini HTTP ${g.status}: ${(await g.text()).slice(0, 200)}` };
  const data = await g.json();
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  try {
    const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const moods = (Array.isArray(j.moods) ? j.moods : []).filter((m: string) => (MOOD_TAGS as readonly string[]).includes(m)) as MoodTag[];
    return {
      title,
      ok: true,
      bytes: buf.length,
      seconds,
      moods,
      energy: Number(j.energy) || undefined,
      description: String(j.description ?? "").slice(0, 300),
      avoidFor: String(j.avoidFor ?? "").slice(0, 200),
    };
  } catch {
    return { title, ok: false, bytes: buf.length, seconds, error: "could not parse Gemini answer" };
  }
}
