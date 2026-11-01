// lib/pipeline/commons.ts
// Real archive photos from Wikimedia Commons (1 Nov 2026, Kadir: "gerçek arşiv
// görüntüleri de olsun"). Only licences that allow commercial use in a video
// WITHOUT share-alike: public domain, CC0 and CC BY. Every photo used is
// credited in the video description (archiveCredits()).
// Server-side fetch; the module itself is pure enough for tests.

export interface ArchiveImage {
  id: number;
  /** ≤1920 px rendition (JPEG thumbnail) — what the renderer loads. */
  url: string;
  pageUrl: string;
  title: string;
  author: string;
  license: string;
  width: number;
  height: number;
}

const UA = "Norveko/1.0 (https://norveko.app; video generator) archive-search";

/** Licences we can use in a commercial video without share-alike or other limits. */
export function usableLicense(short: string): boolean {
  const l = short.trim().toLowerCase();
  if (!l || /\b(sa|nc|nd)\b|share ?alike|non-?commercial|no ?deriv|fair use|non-free/.test(l)) return false;
  return /^(public domain|pd\b|pd-|cc0|cc[- ]by[- ]\d|cc[- ]by$|no restrictions)/.test(l);
}

const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();

/** Maps, flags, logos, diagrams and scans of text are not "footage". */
const NOT_A_PHOTO = /\b(map|karte|harita|logo|flag|coat of arms|diagram|chart|graph|icon|seal|emblem|signature|plan|stamp|banknote|coin|page|manuscript|text)\b/i;

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    width: number;
    height: number;
    mime: string;
    descriptionurl: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

export function parseCommons(pages: CommonsPage[]): ArchiveImage[] {
  const out: ArchiveImage[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|tiff)$/.test(info.mime)) continue;
    if (info.width < 900 || info.height < 500) continue;
    const meta = info.extmetadata ?? {};
    const license = strip(meta.LicenseShortName?.value ?? "");
    if (!usableLicense(license)) continue;
    const title = p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    if (NOT_A_PHOTO.test(title)) continue;
    out.push({
      id: p.pageid,
      url: info.thumburl ?? info.url,
      pageUrl: info.descriptionurl,
      title,
      author: strip(meta.Artist?.value ?? "") || "Unknown author",
      license,
      width: info.thumbwidth ?? info.width,
      height: info.thumbheight ?? info.height,
    });
  }
  return out;
}

/** Search Commons photos for a real subject ("Mount Ararat", "Durupınar site"). */
export async function searchArchiveImages(query: string, perPage = 10): Promise<ArchiveImage[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "30",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1920",
    iiextmetadatafilter: "LicenseShortName|Artist",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { "User-Agent": UA, "Api-User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Wikimedia Commons error (HTTP ${res.status}).`);
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage & { index?: number }> } };
  const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return parseCommons(pages).slice(0, perPage);
}

/** Description footer crediting every archive photo used (CC BY needs it; PD is courtesy). */
export function archiveCredits(items: Array<{ title: string; author: string; license: string; pageUrl: string }>): string | null {
  const seen = new Set<string>();
  const lines = items
    .filter((i) => !seen.has(i.pageUrl) && seen.add(i.pageUrl))
    .map((i) => `• ${i.title} — ${i.author} (${i.license}), ${i.pageUrl}`);
  return lines.length ? `Archive photos (Wikimedia Commons):\n${lines.join("\n")}` : null;
}

/**
 * Download a Commons photo with our User-Agent. Wikimedia refuses generic
 * fetchers (the renderer got "Asset URL not downloadable"), so archive photos
 * are copied into our own bucket before rendering.
 */
export async function downloadArchiveImage(url: string): Promise<{ bytes: Buffer; type: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !/(^|\.)wikimedia\.org$/.test(u.hostname)) throw new Error("Not a Wikimedia URL.");
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Archive photo download failed (HTTP ${res.status}).`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 25 * 1024 * 1024) throw new Error("Archive photo is too large.");
  return { bytes, type: res.headers.get("content-type") ?? "image/jpeg" };
}
