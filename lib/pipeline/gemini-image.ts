// lib/pipeline/gemini-image.ts
// Gemini (Nano Banana 2) ile thumbnail üretimi + Supabase Storage'a yükleme.
// Server-side only — service role key kullanır.

import { createClient } from "@supabase/supabase-js";

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment değişkeni tanımlı değil.");
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Supabase URL veya SERVICE_ROLE_KEY tanımlı değil.");
}

// Storage'a yazmak için admin client (RLS'i aşar — sadece server-side!)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

interface ThumbnailResult {
  imageUrl: string; // public URL — doğrudan <img src> ile kullanılabilir
  storagePath: string;
}

export async function generateThumbnail(
  prompt: string,
  jobId: string
): Promise<ThumbnailResult> {
  // 1) Gemini'den görseli iste
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `YouTube thumbnail, 16:9 aspect ratio, high contrast, bold and readable overlay text, cinematic lighting. ${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          imageConfig: { aspectRatio: "16:9" },
        },
      }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini görsel API hatası (${res.status}): ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();

  // 2) Yanıttaki base64 görseli bul.
  // Görsel, parts dizisinde inlineData (bazı sürümlerde inline_data) olarak gelir.
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  let base64: string | null = null;
  let mimeType = "image/png";

  for (const part of parts) {
    const inline = part.inlineData ?? part.inline_data;
    if (inline?.data) {
      base64 = inline.data;
      mimeType = inline.mimeType ?? inline.mime_type ?? "image/png";
      break;
    }
  }

  if (!base64) {
    throw new Error("Gemini yanıtında görsel bulunamadı.");
  }

  // 3) Supabase Storage'a yükle
  const extension = mimeType.includes("jpeg") ? "jpg" : "png";
  const storagePath = `${jobId}.${extension}`;
  const buffer = Buffer.from(base64, "base64");

  const { error: uploadError } = await supabaseAdmin.storage
    .from("thumbnails")
    .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

  if (uploadError) {
    throw new Error(`Thumbnail Storage'a yüklenemedi: ${uploadError.message}`);
  }

  // 4) Public URL üret
  const { data: urlData } = supabaseAdmin.storage
    .from("thumbnails")
    .getPublicUrl(storagePath);

  return { imageUrl: urlData.publicUrl, storagePath };
}