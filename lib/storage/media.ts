// lib/storage/media.ts
// Where generated working files go (4 Nov 2026 — Supabase's free 1 GB kept filling
// up): Cloudflare R2 when configured, else the public Supabase "videos" bucket.
// R2 files are addressed by https://norveko.app/media/videos/r2/<key>, which
// redirects to a short-lived signed URL — renderers and models follow it.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function storeMedia(db: SupabaseClient, path: string, body: Buffer, contentType: string): Promise<string> {
  const r2 = await import("./r2");
  if (r2.r2Configured()) {
    await r2.putR2(path, body, contentType);
    return r2.r2PublicUrl(path);
  }
  const { error } = await db.storage.from("videos").upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  return db.storage.from("videos").getPublicUrl(path).data.publicUrl;
}
