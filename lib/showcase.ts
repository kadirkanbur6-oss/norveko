// lib/showcase.ts
// Real videos rendered by the Norveko pipeline, shown on the landing page.
// Every entry points at an actual job output in the public `videos` bucket
// (`{user}/{job}/final.mp4`) and its generated thumbnail — nothing here is a
// mock. Add an entry after a run you are happy with; remove it when the file
// is deleted. URLs are built from NEXT_PUBLIC_SUPABASE_URL so the list works
// against any Supabase project that holds the same objects.

export interface ShowcaseVideo {
  id: string;
  title: string;
  /** The single sentence the creator typed. */
  idea: string;
  language: string;
  style: string;
  seconds: number;
  orientation: "vertical" | "horizontal";
  /** Storage paths inside the public buckets. */
  videoPath: string;
  thumbnailPath: string;
  /** Which full-video footage mode produced it. */
  footage: "hybrid" | "cinematic" | "stills";
}

const OWNER = "92779a9c-cb1c-47a8-bcc8-e07f4de6dc56";

export const SHOWCASE_VIDEOS: ShowcaseVideo[] = [
  {
    id: "c52fd94e-f62a-4db2-baf5-1083ae0c57bb",
    title: "Dyatlov Geçidi: Dokuz Kayakçıyı Ne Öldürdü?",
    idea: "Dyatlov Geçidi olayı: 1959'da dokuz dağcıya ne oldu?",
    language: "Türkçe",
    style: "Mystery",
    seconds: 58,
    orientation: "vertical",
    // v1 = re-rendered with "Lost Time" (tragic) instead of a mismatched cue.
    videoPath: `${OWNER}/c52fd94e-f62a-4db2-baf5-1083ae0c57bb/final-v1.mp4`,
    thumbnailPath: "c52fd94e-f62a-4db2-baf5-1083ae0c57bb.jpg",
    footage: "hybrid",
  },
  {
    id: "06d78aba-f9a9-4a72-a4fc-36b0682039a9",
    title: "Penguenler Neden Uçamaz?",
    idea: "Penguenler neden uçamaz?",
    language: "Türkçe",
    style: "Educational",
    seconds: 30,
    orientation: "vertical",
    videoPath: `${OWNER}/06d78aba-f9a9-4a72-a4fc-36b0682039a9/final.mp4`,
    thumbnailPath: "06d78aba-f9a9-4a72-a4fc-36b0682039a9.jpg",
    footage: "hybrid",
  },
  {
    id: "f7d77bdb-7f41-4188-ba90-0bf261ba2c98",
    title: "Kapadokya'nın Yeraltı Sırrı",
    idea: "Kapadokya'nın yeraltı şehirleri neden inşa edildi?",
    language: "Türkçe",
    style: "Mystery",
    seconds: 30,
    orientation: "vertical",
    videoPath: `${OWNER}/f7d77bdb-7f41-4188-ba90-0bf261ba2c98/final.mp4`,
    thumbnailPath: "f7d77bdb-7f41-4188-ba90-0bf261ba2c98.jpg",
    footage: "hybrid",
  },
  {
    id: "53010faf-a6fe-463d-b49c-76e81edf1ca5",
    title: "Hamamböceklerinden Kalıcı Kurtulmanın 6 Yolu",
    idea: "Türkiye'de viral olan hamamböceği videoları",
    language: "Türkçe",
    style: "Educational",
    seconds: 60,
    orientation: "vertical",
    videoPath: `${OWNER}/53010faf-a6fe-463d-b49c-76e81edf1ca5/final.mp4`,
    thumbnailPath: "53010faf-a6fe-463d-b49c-76e81edf1ca5.jpg",
    footage: "hybrid",
  },
];

function storageBase(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  return url ? `${url}/storage/v1/object/public` : null;
}

export function showcaseVideoUrl(v: ShowcaseVideo): string | null {
  const base = storageBase();
  return base ? `${base}/videos/${v.videoPath}` : null;
}

export function showcaseThumbnailUrl(v: ShowcaseVideo): string | null {
  const base = storageBase();
  return base ? `${base}/thumbnails/${v.thumbnailPath}` : null;
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
