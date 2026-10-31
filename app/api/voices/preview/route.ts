// app/api/voices/preview/route.ts
// GET /api/voices/preview?voice=Charon&language=Türkçe
// Short sample of a Gemini voice in the chosen language. Generated on first
// request and cached in storage (videos/previews/gemini/<voice>-<lang>.wav);
// later requests redirect straight to the cached file.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { GEMINI_VOICES, generateGeminiSpeech } from "@/lib/pipeline/gemini-tts";
import { LANGUAGES, isOneOf, languageCode } from "@/lib/pipeline/options";

export const runtime = "nodejs";
export const maxDuration = 60;

const SAMPLES: Record<string, string> = {
  tr: "Bu hikâye, kimsenin açıklayamadığı tek bir ayrıntıyla başlıyor. Ve o ayrıntı her şeyi değiştiriyor.",
  en: "This story begins with a single detail no one could explain. And that detail changes everything.",
  es: "Esta historia comienza con un detalle que nadie pudo explicar. Y ese detalle lo cambia todo.",
  de: "Diese Geschichte beginnt mit einem Detail, das niemand erklären konnte. Und dieses Detail ändert alles.",
  fr: "Cette histoire commence par un détail que personne n'a pu expliquer. Et ce détail change tout.",
  pt: "Esta história começa com um detalhe que ninguém conseguiu explicar. E esse detalhe muda tudo.",
  it: "Questa storia inizia con un dettaglio che nessuno è riuscito a spiegare. E quel dettaglio cambia tutto.",
  ar: "تبدأ هذه القصة بتفصيلة واحدة لم يستطع أحد تفسيرها. وتلك التفصيلة تغيّر كل شيء.",
  ru: "Эта история начинается с одной детали, которую никто не смог объяснить. И эта деталь меняет всё.",
};

export async function GET(req: NextRequest) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });

  const voice = req.nextUrl.searchParams.get("voice") ?? "";
  if (!GEMINI_VOICES.some((v) => v.name === voice)) {
    return NextResponse.json({ success: false, error: "Unknown voice." }, { status: 400 });
  }
  const langParam = req.nextUrl.searchParams.get("language");
  const code = languageCode(isOneOf(LANGUAGES, langParam) ? langParam : LANGUAGES[0]);
  const sampleCode = SAMPLES[code] ? code : "en";

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const file = `${voice}-${sampleCode}.wav`;
  const path = `previews/gemini/${file}`;
  const publicUrl = db.storage.from("videos").getPublicUrl(path).data.publicUrl;

  const { data: existing } = await db.storage.from("videos").list("previews/gemini", { search: file, limit: 1 });
  if (!existing?.some((f) => f.name === file)) {
    try {
      const speech = await generateGeminiSpeech(SAMPLES[sampleCode], voice);
      const { error } = await db.storage.from("videos").upload(path, speech.audio, { contentType: "audio/wav", upsert: true });
      if (error) throw new Error(error.message);
    } catch (err) {
      return NextResponse.json({ success: false, error: err instanceof Error ? err.message : "Preview failed." }, { status: 502 });
    }
  }
  return NextResponse.redirect(publicUrl, 302);
}
