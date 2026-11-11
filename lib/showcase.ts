// lib/showcase.ts
// Real videos rendered by the Norveko pipeline, shown on the landing page.
// Every entry points at an actual job output in the public `videos` bucket
// (`{user}/{job}/final.mp4`) and its generated thumbnail — nothing here is a
// mock. Add an entry after a run you are happy with; remove it when the file
// is deleted. URLs are built from NEXT_PUBLIC_SUPABASE_URL so the list works
// against any Supabase project that holds the same objects.

export type ShowcaseMode = "Narrated video" | "Skit" | "Talking character" | "Character swap" | "Ambient music";

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
    // 7 Nov 2026: ad-quality 60 s narrated short (hybrid, image to video, brand kit).
    id: "93ad4e8c-9e77-4f4b-8fad-b548186f0198",
    mode: "Narrated video",
    title: "The Wow! Signal: What Did Big Ear Hear?",
    idea: "The Wow! Signal: in 1977 a radio telescope caught a 72-second burst from deep space that has never been heard again.",
    language: "English",
    seconds: 62,
    orientation: "vertical",
    videoPath: `${OWNER}/93ad4e8c-9e77-4f4b-8fad-b548186f0198/final.mp4`,
    poster: { bucket: "thumbnails", path: "93ad4e8c-9e77-4f4b-8fad-b548186f0198.jpg" },
    made: "Researched script · AI narrator · cinematic visuals + AI clips · music · subtitles",
  },
  {
    // 7 Nov 2026: ad-quality 60 s narrated short (hybrid, image to video, brand kit).
    id: "285a652e-bff8-4329-bda4-011ad509a21d",
    mode: "Narrated video",
    title: "The Book Yale Still Cannot Read",
    idea: "The Voynich Manuscript: a 600-year-old book written in a language nobody has ever been able to read, filled with plants that do not exist.",
    language: "English",
    seconds: 62,
    orientation: "vertical",
    videoPath: `${OWNER}/285a652e-bff8-4329-bda4-011ad509a21d/final.mp4`,
    poster: { bucket: "thumbnails", path: "285a652e-bff8-4329-bda4-011ad509a21d.jpg" },
    made: "Researched script · AI narrator · cinematic visuals + AI clips · music · subtitles",
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
  {
    // 10 Nov 2026 (Yağmur): 30 s Viking ambience, Lyria music + five Nano Banana pictures.
    id: "viking-ambience",
    mode: "Ambient music",
    title: "Viking Ambience: Fjord at Dawn",
    idea: "Viking ambience: deep frame drums, bowed lyre and cold wind over an icy fjord at dawn",
    language: "Instrumental",
    seconds: 30,
    orientation: "horizontal",
    videoPath: "site/viking-ambient.mp4",
    poster: { bucket: "videos", path: `${OWNER}/viking/still-707.jpg` },
    made: "AI-composed music · five cinematic pictures · slow camera moves · full-length versions up to 2 hours",
  },
];

/**
 * "Long video to Shorts" demo (7 Nov 2026): one real 3-minute video, the moments the
 * picker suggested for it (verbatim output of POST /shorts {action:"suggest"}) and the
 * Short that was rendered from one of them.
 */
export const SHORTS_DEMO = {
  long: {
    id: "4ff09d16-537c-42c2-9aba-930abb919933",
    title: "Why Did Ten People Leave the Mary Celeste?",
    seconds: 197,
    videoPath: `${OWNER}/4ff09d16-537c-42c2-9aba-930abb919933/final-v1.mp4`,
    poster: { bucket: "thumbnails", path: "4ff09d16-537c-42c2-9aba-930abb919933.jpg" },
  },
  picks: [
    { from: 0.13, to: 36.31, title: "The Mary Celeste Set Sail With 10 People Aboard", hook: "The ship returned without its people" },
    { from: 36.35, to: 88.39, title: "The Mary Celeste Was Found Sailing Without a Crew", hook: "A ship sailed with nobody aboard" },
    { from: 88.39, to: 132.84, title: "What Investigators Found Aboard the Mary Celeste", hook: "The ship wasn't in perfect order" },
    { from: 133.01, to: 169.34, title: "Could a Faulty Pump Explain the Mary Celeste Mystery?", hook: "Did the crew fear sinking?" },
  ],
  /** Index in `picks` that was rendered. */
  chosen: 2,
  short: {
    id: "a3a69a3d-b950-4e5f-b82a-7e9227de4be9",
    seconds: 44,
    videoPath: `${OWNER}/a3a69a3d-b950-4e5f-b82a-7e9227de4be9/final-v4.mp4`,
    poster: { bucket: "thumbnails", path: "a3a69a3d-b950-4e5f-b82a-7e9227de4be9.jpg" },
  },
} as const;

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

/**
 * One 16:9 cinematic loop that fills the whole hero (6 Nov 2026, Yağmur: "a 10-second
 * action scene, realistic, a visual feast"). Made with Kling 3 Pro on fal, kept in R2
 * (lab store-url). When set it replaces the wall of Shorts above.
 */
export const HERO_FEATURE_CLIP: string | null = "site/hero-rooftop-jump.mp4";

/** First frame of the hero clip, shown at once while the video loads (lab poster-submit). */
export const HERO_FEATURE_POSTER: string | null = "site/hero-rooftop-jump.jpg";

export function heroFeaturePosterUrl(): string | null {
  return HERO_FEATURE_POSTER ? `/media/videos/r2/${HERO_FEATURE_POSTER}` : null;
}

export function heroFeatureUrl(): string | null {
  return HERO_FEATURE_CLIP ? `/media/videos/r2/${HERO_FEATURE_CLIP}` : null;
}

export function heroClipUrl(path: string): string | null {
  const base = storageBase();
  return base ? `${base}/videos/${path}` : null;
}
