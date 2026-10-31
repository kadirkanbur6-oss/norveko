// lib/pipeline/watermark.ts
// Server-only image watermarking for free-trial thumbnails. The clean
// original is kept under an unguessable path (clean/…) so the first
// purchase can swap it back in without regenerating anything.

import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { WATERMARK_PUBLIC_PATH } from "./watermark-policy";

let badgeCache: Buffer | null = null;

async function badge(baseUrl: string): Promise<Buffer> {
  if (badgeCache) return badgeCache;
  const res = await fetch(`${baseUrl}${WATERMARK_PUBLIC_PATH}`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`watermark badge HTTP ${res.status}`);
  badgeCache = Buffer.from(await res.arrayBuffer());
  return badgeCache;
}

/** Badge in the bottom-right corner, ~30% of the image width. */
export async function addWatermark(image: Buffer, baseUrl: string): Promise<Buffer> {
  const img = sharp(image);
  const meta = await img.metadata();
  const width = meta.width ?? 1280;
  const height = meta.height ?? 720;
  const badgeWidth = Math.round(width * 0.3);
  const resized = await sharp(await badge(baseUrl)).resize({ width: badgeWidth }).toBuffer();
  const badgeHeight = (await sharp(resized).metadata()).height ?? Math.round(badgeWidth * 0.3);
  const margin = Math.round(width * 0.03);
  const out = img.composite([{ input: resized, left: width - badgeWidth - margin, top: height - badgeHeight - margin }]);
  return meta.format === "jpeg" ? out.jpeg({ quality: 90 }).toBuffer() : out.png().toBuffer();
}

/**
 * Watermark a stored thumbnail in place. Returns the public URL of the clean
 * copy (kept for when the user buys a pack).
 */
export async function watermarkStoredThumbnail(args: {
  storagePath: string;
  jobId: string;
  baseUrl: string;
}): Promise<{ cleanUrl: string; cleanPath: string }> {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const bucket = db.storage.from("thumbnails");
  const { data: file, error } = await bucket.download(args.storagePath);
  if (error || !file) throw new Error(`thumbnail download failed: ${error?.message ?? "empty"}`);
  const original = Buffer.from(await file.arrayBuffer());
  const ext = args.storagePath.split(".").pop() ?? "png";
  const contentType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";

  const cleanPath = `clean/${args.jobId}-${randomUUID()}.${ext}`;
  const clean = await bucket.upload(cleanPath, original, { contentType, upsert: true });
  if (clean.error) throw new Error(`clean copy upload failed: ${clean.error.message}`);

  const marked = await addWatermark(original, args.baseUrl);
  const up = await bucket.upload(args.storagePath, marked, { contentType, upsert: true });
  if (up.error) throw new Error(`watermarked upload failed: ${up.error.message}`);

  return { cleanPath, cleanUrl: bucket.getPublicUrl(cleanPath).data.publicUrl };
}

/** Creator's brand logo in the top-left corner (~18% of the width), in place. */
export async function brandStoredThumbnail(args: { storagePath: string; logoUrl: string }): Promise<void> {
  const res = await fetch(args.logoUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`brand logo HTTP ${res.status}`);
  const logo = Buffer.from(await res.arrayBuffer());
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const bucket = db.storage.from("thumbnails");
  const { data: file, error } = await bucket.download(args.storagePath);
  if (error || !file) throw new Error(`thumbnail download failed: ${error?.message ?? "empty"}`);
  const original = Buffer.from(await file.arrayBuffer());
  const img = sharp(original);
  const meta = await img.metadata();
  const width = meta.width ?? 1280;
  const box = Math.round(width * 0.18);
  const resized = await sharp(logo).resize({ width: box, height: box, fit: "inside" }).png().toBuffer();
  const margin = Math.round(width * 0.03);
  const out = img.composite([{ input: resized, left: margin, top: margin }]);
  const ext = args.storagePath.split(".").pop() ?? "png";
  const jpeg = ext === "jpg" || ext === "jpeg";
  const buf = jpeg ? await out.jpeg({ quality: 90 }).toBuffer() : await out.png().toBuffer();
  const up = await bucket.upload(args.storagePath, buf, { contentType: jpeg ? "image/jpeg" : "image/png", upsert: true });
  if (up.error) throw new Error(`branded upload failed: ${up.error.message}`);
}
