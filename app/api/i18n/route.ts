// app/api/i18n/route.ts
// Site translation (14 Nov 2026). The browser sends the English strings it has no
// translation for; this route translates them once (Gemini Flash) and adds them to a
// shared dictionary stored as public JSON in the `videos` bucket (i18n/<code>.json), so
// every later visitor gets them straight from storage with no model call.
//
// Public on purpose (the landing page is read signed out). Guards: known languages only,
// small batches, a per-IP rate limit, and a cap on dictionary size.
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/supabase-admin";
import { captureError } from "@/lib/observability";
import {
  I18N_MAX_BATCH,
  I18N_MAX_BATCH_CHARS,
  I18N_MAX_STRING,
  SITE_LANGUAGE_CODES,
  dictionaryPath,
  siteLanguage,
  translatable,
} from "@/lib/i18n/languages";

export const maxDuration = 120;

const BUCKET = "videos";
const MAX_ENTRIES = 12000;
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = 60;
const hits = new Map<string, { count: number; reset: number }>();

type Dictionary = Record<string, string>;

function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || h.reset < now) {
    hits.set(ip, { count: 1, reset: now + WINDOW_MS });
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return false;
  }
  h.count += 1;
  return h.count > MAX_REQUESTS;
}

async function loadDictionary(code: string): Promise<Dictionary> {
  const { data, error } = await adminDb().storage.from(BUCKET).download(dictionaryPath(code));
  if (error || !data) return {};
  try {
    const parsed = JSON.parse(await data.text());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Dictionary) : {};
  } catch {
    return {};
  }
}

async function saveDictionary(code: string, dict: Dictionary) {
  const { error } = await adminDb()
    .storage.from(BUCKET)
    .upload(dictionaryPath(code), JSON.stringify(dict), { contentType: "application/json", upsert: true, cacheControl: "60" });
  if (error) throw new Error(error.message);
}

async function translateOnce(code: string, strings: string[]): Promise<Dictionary> {
  const { chatJSON } = await import("@/lib/pipeline/llm");
  const language = siteLanguage(code);
  const { data } = await chatJSON<{ translations?: unknown }>({
    model: process.env.UI_TRANSLATE_MODEL || "gemini-3.8-flash",
    timeoutMs: 50_000,
    system: `You translate the interface text of Norveko, a web app that turns an idea into a finished video, from English into ${language.english} (${language.label}).
Rules:
- Return JSON: {"translations": [...]} with exactly one translation per input string, in the same order.
- Write the way a good ${language.english} product interface reads: natural, concise, friendly and polite. Not word for word.
- Keep unchanged: brand and product names (Norveko, YouTube, TikTok, Instagram, Shorts, Reels, Paddle, Wikimedia Commons), plan and pack names (Creator, Pro, Starter, Growth, Business), file types (MP4, SRT, VTT, API), numbers, prices, units, symbols, emojis, URLs and e-mail addresses.
- A string may be a fragment of a sentence that sits next to a number (for example " credits for a 20 s skit" or "≈"). Translate it as that fragment and keep its leading and trailing punctuation.
- Quoted example ideas and video titles are translated too.
- Never add notes, explanations or quotation marks of your own. If a string should stay as it is, return it unchanged.`,
    user: JSON.stringify({ strings }),
  });
  const out: Dictionary = {};
  const list = Array.isArray(data?.translations) ? data.translations : [];
  if (list.length !== strings.length) return out; // misaligned answer: cache nothing
  strings.forEach((source, i) => {
    const t = list[i];
    if (typeof t !== "string") return;
    const text = t.trim();
    if (!text || text.length > source.length * 4 + 60) return;
    out[source] = text;
  });
  return out;
}

/** A long batch sometimes comes back with a different number of items; halves usually line up. */
async function translate(code: string, strings: string[]): Promise<Dictionary> {
  const first = await translateOnce(code, strings).catch(() => ({}) as Dictionary);
  if (Object.keys(first).length || strings.length < 2) return first;
  const mid = Math.ceil(strings.length / 2);
  const [a, b] = await Promise.all([
    translateOnce(code, strings.slice(0, mid)).catch(() => ({}) as Dictionary),
    translateOnce(code, strings.slice(mid)).catch(() => ({}) as Dictionary),
  ]);
  return { ...a, ...b };
}

export async function POST(request: Request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return NextResponse.json({ success: false, error: "Too many requests." }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { lang?: unknown; texts?: unknown } | null;
  const code = typeof body?.lang === "string" ? body.lang : "";
  if (!SITE_LANGUAGE_CODES.includes(code) || code === "en") {
    return NextResponse.json({ success: false, error: "Unknown language." }, { status: 400 });
  }
  const texts = Array.isArray(body?.texts)
    ? [...new Set(body.texts.filter((t): t is string => typeof t === "string").map((t) => t.trim()))].filter((t) => translatable(t, I18N_MAX_STRING))
    : [];
  if (!texts.length || texts.length > I18N_MAX_BATCH || texts.join("").length > I18N_MAX_BATCH_CHARS) {
    return NextResponse.json({ success: false, error: "Send 1 to 60 short strings." }, { status: 400 });
  }

  try {
    const dict = await loadDictionary(code);
    const missing = texts.filter((t) => !(t in dict));
    if (missing.length) {
      const fresh = await translate(code, missing);
      if (Object.keys(fresh).length) {
        // Re-read before saving so a batch translated in parallel is not lost.
        const latest = await loadDictionary(code);
        const merged = { ...latest, ...fresh };
        if (Object.keys(merged).length <= MAX_ENTRIES) await saveDictionary(code, merged);
        Object.assign(dict, fresh);
      }
    }
    const translations: Dictionary = {};
    for (const t of texts) if (dict[t]) translations[t] = dict[t];
    return NextResponse.json({ success: true, translations });
  } catch (err) {
    captureError(err, { step: "i18n" });
    return NextResponse.json({ success: false, error: "Translation is not available right now." }, { status: 502 });
  }
}
