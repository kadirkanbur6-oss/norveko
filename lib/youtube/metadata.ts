// lib/youtube/metadata.ts
// Pure: turns a project's title/description/tags into a valid YouTube
// videos.insert body. YouTube rejects the whole upload for an over-long title,
// "<" or ">" anywhere in title/description, or tags over 500 characters total.

export const PRIVACY_OPTIONS = ["private", "unlisted", "public"] as const;
export type YouTubePrivacy = (typeof PRIVACY_OPTIONS)[number];

export interface UploadInput {
  title: string;
  description?: string;
  tags?: string[];
  privacy: YouTubePrivacy;
  /** ISO time to publish; YouTube requires privacy "private" until then. */
  publishAt?: string | null;
  style?: string | null;
}

/** People & Blogs is YouTube's neutral default; map our styles where it fits. */
export function categoryForStyle(style: string | null | undefined): string {
  switch (style) {
    case "Educational":
      return "27"; // Education
    case "Documentary":
      return "27";
    case "Mystery":
    case "Horror":
    case "Cinematic":
      return "24"; // Entertainment
    default:
      return "22"; // People & Blogs
  }
}

const clean = (s: string) => s.replace(/[<>]/g, "").replace(/\s+\n/g, "\n").trim();

export function youtubeTitle(title: string): string {
  const t = clean(title).replace(/\s+/g, " ");
  if (t.length <= 100) return t || "Untitled";
  return `${t.slice(0, 99).replace(/\s+\S*$/, "")}…`;
}

export function youtubeDescription(description: string | undefined): string {
  const d = clean(description ?? "");
  // YouTube's limit is 5000 bytes, not characters (Turkish/Arabic letters are 2 bytes).
  let out = d;
  while (Buffer.byteLength(out, "utf8") > 5000) out = out.slice(0, Math.floor(out.length * 0.95));
  return out;
}

export function youtubeTags(tags: string[] | undefined): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of tags ?? []) {
    const tag = raw.replace(/^#/, "").replace(/[<>,"]/g, "").trim().slice(0, 100);
    if (!tag || out.some((t) => t.toLowerCase() === tag.toLowerCase())) continue;
    // Tags with spaces are counted with surrounding quotes, plus a comma between tags.
    const cost = tag.length + (tag.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > 500) break;
    out.push(tag);
    total += cost;
  }
  return out;
}

/** Validates publishAt: must be a real time at least 15 min ahead (YouTube rejects past times). */
export function validPublishAt(value: string | null | undefined, now = Date.now()): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t) || t < now + 15 * 60_000 || t > now + 365 * 86_400_000) return null;
  return new Date(t).toISOString();
}

export function buildVideoResource(input: UploadInput) {
  const publishAt = validPublishAt(input.publishAt);
  return {
    snippet: {
      title: youtubeTitle(input.title),
      description: youtubeDescription(input.description),
      tags: youtubeTags(input.tags),
      categoryId: categoryForStyle(input.style),
    },
    status: {
      privacyStatus: publishAt ? "private" : input.privacy,
      ...(publishAt ? { publishAt } : {}),
      selfDeclaredMadeForKids: false,
      // Norveko videos are AI-generated (images, clips, voice): YouTube requires
      // realistic altered/synthetic media to be disclosed.
      containsSyntheticMedia: true,
      embeddable: true,
    },
  };
}
