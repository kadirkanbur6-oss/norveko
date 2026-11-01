// lib/pipeline/stock-check.ts
// Visual fit check for stock clips and archive photos (1 Nov 2026, Kadir: a
// violinist appeared at 2:50 of the Noah's Ark video — Pixabay matched "rock
// snow mountain" on its tags). Keyword matching can't see what's IN the frame,
// so a fast vision model looks at the candidates' preview frames and keeps
// only those that fit what the narrator is saying. Server-side; fails open
// (null → caller keeps the keyword-ranked list).

const MODEL = process.env.STOCK_VISION_MODEL || "gemini-3.8-flash";
const UA = "Norveko/1.0 (https://norveko.app; video generator)";

/** Cheap pre-filter: tags that mean "the clip is about something else". */
const OFF_TOPIC_TAGS =
  /\b(violin|guitar|piano|music|musician|concert|dance|dancer|wedding|bride|selfie|model|fashion|business|office|laptop|computer|smartphone|phone|tablet|meeting|yoga|fitness|gym|party|christmas|cartoon|animation|3d|render|logo|text|advertis\w*|car|traffic|drone footage of city)\b/i;

export function offTopicTags(tags: string, query: string): boolean {
  const m = tags.match(OFF_TOPIC_TAGS);
  return Boolean(m && !query.toLowerCase().includes(m[1].toLowerCase()));
}

async function imagePart(url: string): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    return { inlineData: { mimeType: type.split(";")[0], data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

/**
 * Which candidate frames fit the narration? Returns the indices (best first)
 * of `previews` that may be shown, [] if none fit, or null if the check could
 * not run (no key / model error) — then the caller decides without it.
 */
export async function pickFittingFrames(args: {
  /** What the narrator says / the scene shows (any language). */
  scene: string;
  /** The English visual prompt of the scene (context for the model). */
  prompt: string;
  /** Real-world subject when the scene is about one ("Mount Ararat"). */
  subject?: string;
  previews: string[];
}): Promise<number[] | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !args.previews.length) return null;
  const parts = await Promise.all(args.previews.slice(0, 8).map(imagePart));
  const content: Array<Record<string, unknown>> = [
    {
      text: `You pick B-roll for a documentary. The narrator is saying: "${args.scene}". The intended shot: ${args.prompt}${
        args.subject ? `\nThe scene is about the real place/subject: ${args.subject}.` : ""
      }
Below are numbered candidate frames. Keep a frame ONLY if a viewer would see it as illustrating this moment. Reject frames whose main subject is unrelated (people performing, playing music, posing, working at computers, modern city life in a historical story, sports, cartoons, illustrations, maps, text or logos, paintings unless the scene is about that painting). Respond ONLY with JSON {"fit": [indices of fitting frames, best first]}.`,
    },
  ];
  parts.forEach((p, i) => {
    if (!p) return;
    content.push({ text: `Frame ${i}:` });
    content.push(p);
  });
  if (content.length === 1) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: content }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn(`[stock-check] ${MODEL} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
    const parsed = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()) as { fit?: unknown };
    if (!Array.isArray(parsed.fit)) return null;
    return parsed.fit.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < args.previews.length);
  } catch (err) {
    console.warn("[stock-check] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
