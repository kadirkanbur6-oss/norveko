// lib/storage/r2.ts
// Cloudflare R2 for finished videos (1 Nov 2026). Long-form MP4s are 100–600 MB:
// too big for Supabase's 50 MB free-plan objects, and R2 has no egress fees
// (every play, download and YouTube/TikTok hand-off is free traffic).
//
// The bucket stays PRIVATE. Videos are addressed by a stable URL on our own
// domain, https://norveko.app/media/videos/r2/<key>, whose route handler
// redirects to a short-lived signed R2 URL (app/media/videos/r2/[...key]).
// Supabase keeps the database and the small files (images, audio, captions).
//
// Env (server-only): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET. Without them everything falls back to Supabase Storage.

import "server-only";
import { S3Client, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { R2_URL_PATH, r2KeyFromUrl } from "./r2-url";

export { R2_URL_PATH, r2KeyFromUrl };

const env = (name: string) => (process.env[name] ?? "").trim();

export function r2Configured(): boolean {
  return Boolean(env("R2_ACCOUNT_ID") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY") && env("R2_BUCKET"));
}

let client: S3Client | null = null;
function r2(): S3Client {
  if (!r2Configured()) throw new Error("Cloudflare R2 is not configured.");
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  });
  return client;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://norveko.app").replace(/\/+$/, "");
}

/** Stable public URL (on our domain) for an R2 object key. */
export function r2PublicUrl(key: string): string {
  return `${siteUrl()}${R2_URL_PATH}${key.split("/").map(encodeURIComponent).join("/")}`;
}

/**
 * Stream a remote file (e.g. a finished Shotstack render) into R2 without
 * holding it in memory: multipart upload in 16 MB parts. Returns bytes stored.
 */
export async function copyUrlToR2(sourceUrl: string, key: string, contentType: string): Promise<number> {
  const res = await fetch(sourceUrl, { cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`Could not download the file (HTTP ${res.status}).`);
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const upload = new Upload({
    client: r2(),
    params: {
      Bucket: env("R2_BUCKET"),
      Key: key,
      Body: res.body.pipeThrough(counter) as unknown as ReadableStream,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    },
    partSize: 16 * 1024 * 1024,
    queueSize: 3,
  });
  await upload.done();
  return bytes;
}

/** Short-lived signed GET URL; `downloadName` makes the browser save it as that file. */
export async function signedR2Url(
  key: string,
  downloadName?: string | null,
  expiresIn = 3600,
  /** Fixed signing time: the same URL comes back until it changes, so browsers can cache the file. */
  signingDate?: Date
): Promise<string> {
  const safe = downloadName ? downloadName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) : null;
  return getSignedUrl(
    r2(),
    new GetObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: key,
      ...(safe ? { ResponseContentDisposition: `attachment; filename="${safe}"` } : {}),
    }),
    { expiresIn, ...(signingDate ? { signingDate } : {}) }
  );
}

/** Delete every object under a prefix (account deletion: `<userId>/`); `keep` spares keys, `dryRun` only counts. */
export async function deleteR2Prefix(prefix: string, opts: { keep?: (key: string) => boolean; dryRun?: boolean } = {}): Promise<number> {
  if (!r2Configured() || !prefix) return 0;
  let deleted = 0;
  let token: string | undefined;
  do {
    const list = await r2().send(new ListObjectsV2Command({ Bucket: env("R2_BUCKET"), Prefix: prefix, ContinuationToken: token }));
    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! })).filter((o) => o.Key && !opts.keep?.(o.Key));
    if (opts.dryRun) deleted += keys.length;
    else if (keys.length) {
      await r2().send(new DeleteObjectsCommand({ Bucket: env("R2_BUCKET"), Delete: { Objects: keys, Quiet: true } }));
      deleted += keys.length;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

/** Store a small file (picture, voice line, subtitles) in R2. */
export async function putR2(key: string, body: Buffer, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({ Bucket: env("R2_BUCKET"), Key: key, Body: body, ContentType: contentType }));
}
