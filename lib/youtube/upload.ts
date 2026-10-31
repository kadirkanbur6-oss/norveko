// lib/youtube/upload.ts
// Server-only: resumable videos.insert + thumbnails.set with a user access token.

import "server-only";
import type { buildVideoResource } from "./metadata";

export interface UploadedVideo {
  id: string;
  privacyStatus: string;
  uploadStatus?: string;
}

async function googleError(res: Response, what: string): Promise<Error> {
  const json = await res.json().catch(() => null);
  const reason: string = json?.error?.errors?.[0]?.reason ?? json?.error?.status ?? "";
  const message: string = json?.error?.message ?? res.statusText;
  const err = new Error(`${what} failed (${res.status}${reason ? `, ${reason}` : ""}): ${message}`);
  (err as Error & { reason?: string; status?: number }).reason = reason;
  (err as Error & { reason?: string; status?: number }).status = res.status;
  return err;
}

export async function uploadVideo(
  accessToken: string,
  resource: ReturnType<typeof buildVideoResource>,
  video: Buffer
): Promise<UploadedVideo> {
  // 1) Open a resumable session.
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(video.length),
      },
      body: JSON.stringify(resource),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!init.ok) throw await googleError(init, "YouTube upload");
  const location = init.headers.get("location");
  if (!location) throw new Error("YouTube did not return an upload URL.");

  // 2) Send the bytes (Shorts-length MP4s are small enough for one PUT).
  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(video.length) },
    body: new Uint8Array(video),
    signal: AbortSignal.timeout(220_000),
  });
  if (!put.ok) throw await googleError(put, "YouTube upload");
  const json = await put.json();
  return { id: String(json.id), privacyStatus: String(json.status?.privacyStatus ?? ""), uploadStatus: json.status?.uploadStatus };
}

/** Custom thumbnails need a verified channel; failure is reported, never fatal. */
export async function setThumbnail(accessToken: string, videoId: string, image: Buffer, contentType: string): Promise<boolean> {
  if (image.length > 2 * 1024 * 1024) return false;
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": contentType || "image/jpeg" },
    body: new Uint8Array(image),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    console.warn("[youtube] thumbnail not set:", (await googleError(res, "thumbnail")).message);
    return false;
  }
  return true;
}

/** Plain-English explanation for the errors creators actually hit. */
export function friendlyUploadError(err: unknown): string {
  const reason = (err as { reason?: string })?.reason ?? "";
  const status = (err as { status?: number })?.status ?? 0;
  if (reason === "uploadLimitExceeded") return "Your YouTube channel has reached its daily upload limit. Try again tomorrow.";
  if (reason === "quotaExceeded") return "Norveko's daily YouTube upload quota is used up. Please try again tomorrow, or download the MP4 and upload it yourself.";
  if (reason === "youtubeSignupRequired") return "This Google account has no YouTube channel yet. Create one on youtube.com, then connect again.";
  if (reason === "forbidden" || status === 403) return "YouTube refused the upload for this channel. Reconnect YouTube and make sure you allow uploads.";
  if (status === 401) return "Your YouTube connection expired. Please reconnect YouTube.";
  return "The upload to YouTube failed. Please try again in a minute.";
}
