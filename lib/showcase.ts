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
    // Realistic street interview (the viral man-on-the-street format), 5 Nov 2026.
    id: "b24376f6-0388-4138-86bd-42853f4bcb0b",
    mode: "Skit",
    title: "The Secret to a Happy Marriage",
    idea: "Reporter: Sir, what's the secret to a happy marriage? Old man: Two words. \"You're right.\" Reporter: And what if she's wrong? Old man: Then I'm suddenly deaf.",
    language: "English",
    seconds: 21,
    orientation: "vertical",
    videoPath: `${OWNER}/skit/b24376f6-0388-4138-86bd-42853f4bcb0b/final-v1.mp4`,
    poster: { bucket: "videos", path: `${OWNER}/skit-b24376f6-0388-4138-86bd-42853f4bcb0b/still-3.jpg` },
    made: "Realistic cast · character voices · lip-sync · cinematic shots",
  },
  {
    // First skit whose speaking shots say their lines themselves (Veo 3.1 Fast), 5 Nov 2026 — Kadir: "iyi bu".
    id: "41afe86b-079f-4127-ae59-ec40b8f61f54",
    mode: "Skit",
    title: "The Whole Sofa",
    idea: "Puppy: Grandpa! I ate the whole sofa. Am I in trouble? Cat: The sofa? The whole sofa? Puppy: Well... and the remote. Cat: Kid, I've been planning that for nine years.",
    language: "English",
    seconds: 22,
    orientation: "vertical",
    videoPath: `${OWNER}/skit/41afe86b-079f-4127-ae59-ec40b8f61f54/final.mp4`,
    poster: { bucket: "videos", path: `${OWNER}/skit-41afe86b-079f-4127-ae59-ec40b8f61f54/still-2.jpg` },
    made: "3D animated cast · characters speak their own lines · AI video shots",
  },
  {
    // Bigfoot vlog (viral AI format), 5 Nov 2026.
    id: "bb366887-daff-4a6b-be18-55847bdf8c74",
    mode: "Talking character",
    title: "Bigfoot's Vlog, Day 400",
    idea: "Bigfoot here. Day four hundred of hiding from humans. A guy just walked past me and took a photo of a tree. Amateurs.",
    language: "English",
    seconds: 13,
    orientation: "vertical",
    videoPath: `${OWNER}/talk/bb366887-daff-4a6b-be18-55847bdf8c74/final.mp4`,
    poster: { bucket: "videos", path: `${OWNER}/talk-bb366887-daff-4a6b-be18-55847bdf8c74/still-1.jpg` },
    made: "One character · your line · gruff voice · lip-sync",
  },
];

// Character swap: no showcase entry yet (5 Nov 2026 — the Office Cat swap came back as the
// original man; Wan Animate "replace" keeps a human when the target is an animal. A human→human
// swap works (Timur test on 4 Nov); pick a globally recognisable human character before adding one).

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
