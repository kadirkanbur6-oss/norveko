// lib/showcase.ts
// Real videos rendered by the Norveko pipeline, shown on the landing page.
// Every entry points at an actual job output in the public `videos` bucket
// (`{user}/{job}/final.mp4`) and its generated thumbnail — nothing here is a
// mock. Add an entry after a run you are happy with; remove it when the file
// is deleted. URLs are built from NEXT_PUBLIC_SUPABASE_URL so the list works
// against any Supabase project that holds the same objects.

export type ShowcaseMode = "Narrated video" | "Skit" | "Talking character" | "Character swap";

export interface ShowcaseVideo {
  id: string;
  /** Which Norveko studio made it (shown on the card). */
  mode: ShowcaseMode;
  title: string;
  /** What the creator typed or picked. */
  idea: string;
  language: string;
  seconds: number;
  orientation: "vertical" | "horizontal";
  /** R2 key of the finished MP4 (served by /media/videos/r2/…). */
  videoPath: string;
  /** Poster: a path in the public `thumbnails` bucket, a path in the public `videos` bucket, or none (first frame). */
  poster?: { bucket: "thumbnails" | "videos"; path: string };
  /** What the video is made of, one short line. */
  made: string;
}

const OWNER = "92779a9c-cb1c-47a8-bcc8-e07f4de6dc56";

// 4 Nov 2026 (Kadir: "one English video per mode, labelled, global"): the four studios.
export const SHOWCASE_VIDEOS: ShowcaseVideo[] = [
  {
    id: "fd43ddfc-4b45-486d-8b0f-b9b1dfe43f91",
    mode: "Narrated video",
    title: "The Three Lighthouse Keepers Who Vanished",
    idea: "The three lighthouse keepers who vanished from the Flannan Isles in 1900",
    language: "English",
    seconds: 31,
    orientation: "vertical",
    videoPath: `${OWNER}/fd43ddfc-4b45-486d-8b0f-b9b1dfe43f91/final.mp4`,
    poster: { bucket: "thumbnails", path: "fd43ddfc-4b45-486d-8b0f-b9b1dfe43f91.jpg" },
    made: "Researched script · AI narrator · visuals · music · subtitles",
  },
  {
    id: "4b9d2833-3504-47a7-bbfe-61607b374fe8",
    mode: "Skit",
    title: "The Cockroach Press Conference",
    idea: "Reporter: Mr. President, people say you only come out at night. Is that true? President: Lies! I also come out when someone turns on the kitchen light.",
    language: "English",
    seconds: 22,
    orientation: "vertical",
    videoPath: `${OWNER}/skit/4b9d2833-3504-47a7-bbfe-61607b374fe8/final.mp4`,
    poster: { bucket: "videos", path: `${OWNER}/skit-4b9d2833-3504-47a7-bbfe-61607b374fe8/still-3.jpg` },
    made: "Cast · character voices · lip-sync · crowd & sound effects",
  },
  {
    id: "ccd97b03-9aea-4264-8b0e-db1e8a93f590",
    mode: "Talking character",
    title: "Coach Chick's Pep Talk",
    idea: "Listen up, team! Nobody believed in us. But today we play like champions. Peck hard, run fast, and never, ever chicken out!",
    language: "English",
    seconds: 8,
    orientation: "vertical",
    videoPath: `${OWNER}/talk/ccd97b03-9aea-4264-8b0e-db1e8a93f590/final.mp4`,
    poster: { bucket: "videos", path: `${OWNER}/talk-ccd97b03-9aea-4264-8b0e-db1e8a93f590/still-1.jpg` },
    made: "One character · your line · cartoon voice · lip-sync",
  },
];

// Added to SHOWCASE_VIDEOS once its render finishes (4 Nov 2026).
export const PENDING_SWAP_SHOWCASE: ShowcaseVideo =
{
    id: "4d52ec19-1484-4036-b919-272c07302efd",
    mode: "Character swap",
    title: "A 14th-Century Conqueror at the Office",
    idea: "A stock clip of a man in a suit, with Timur the conqueror swapped in",
    language: "No dialogue",
    seconds: 10,
    orientation: "vertical",
    videoPath: `${OWNER}/swap/4d52ec19-1484-4036-b919-272c07302efd/final.mp4`,
    made: "Your clip · your character · same moves and sound",
  };

function storageBase(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return url ? `${url}/storage/v1/object/public` : null;
}

/** Finished videos moved to Cloudflare R2 on 3 Nov 2026 (served through our signed-URL route). */
export function showcaseVideoUrl(v: ShowcaseVideo): string | null {
  return `/media/videos/r2/${v.videoPath}`;
}

export function showcaseThumbnailUrl(v: ShowcaseVideo): string | null {
  const base = storageBase();
  return base && v.poster ? `${base}/${v.poster.bucket}/${v.poster.path}` : null;
}

/**
 * Short (5 s, 720×1280, ~3–4 MB) AI clips from real runs, used as the
 * muted looping background of the landing hero. Only ever-upright clips
 * (generated after the 29 Oct camera-level fix). The FIRST clip is the one
 * phones show.
 */
export const HERO_LOOP_CLIPS: string[] = [
  `${OWNER}/c52fd94e-f62a-4db2-baf5-1083ae0c57bb/slot-8.mp4`, // Dyatlov: a frozen glove rising from the snow (Seedance image→video)
  `${OWNER}/159af1f9-8823-4bdb-8e1b-1c88f0073669/slot-0.mp4`, // pyramids at dusk
  `${OWNER}/54173f2f-cb6b-4997-aa85-e6522b1b7dc9/slot-0.mp4`, // Belmez: face in the concrete
  `${OWNER}/83322c8f-a030-4f85-96f1-5182a686fd25/slot-8.mp4`, // city crowd at night
];

export function heroClipUrl(path: string): string | null {
  const base = storageBase();
  return base ? `${base}/videos/${path}` : null;
}
