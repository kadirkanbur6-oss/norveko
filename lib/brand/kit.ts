// lib/brand/kit.ts
// Brand kit (31 Oct 2026): a creator's logo, brand colour and end-card line,
// applied to every video (logo corner + hook card / caption highlight colour +
// end card) and thumbnail (logo corner). The kit is copied onto the job at
// start (options.brand) so re-renders keep the look the video was made with.
//
// Table public.brand_kits (SQL in supabase/README.md), written only through
// /api/brand with the service role. Logos live in the public "videos" bucket
// under brand/<user>/logo-<uuid>.png (PNG, ≤ 512 px).

export interface BrandKit {
  logoUrl: string | null;
  logoPath: string | null;
  color: string | null;
  outroText: string | null;
  /** Brand name written under the logo in videos ("NORVEKO"). */
  name: string | null;
  logoOnVideo: boolean;
  logoOnThumbnail: boolean;
}

/** What a job keeps (options.brand). */
export interface BrandSnapshot {
  logoUrl?: string;
  /** Logo in the video's corner. */
  videoLogo?: boolean;
  /** Logo in the thumbnail's corner. */
  thumbLogo?: boolean;
  color?: string;
  outroText?: string;
  /** Written under the video logo. */
  name?: string;
}

export const OUTRO_MAX_CHARS = 60;
export const NAME_MAX_CHARS = 24;

export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX_CHARS);
  return t || null;
}
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MAX_PX = 512;
/** Seconds the end card stays on screen. */
export const OUTRO_SECONDS = 2.5;

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}

export function cleanOutro(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, OUTRO_MAX_CHARS);
  return t || null;
}

export function rowToKit(row: Record<string, unknown> | null): BrandKit | null {
  if (!row) return null;
  return {
    logoUrl: typeof row.logo_url === "string" ? row.logo_url : null,
    logoPath: typeof row.logo_path === "string" ? row.logo_path : null,
    color: isHexColor(row.color) ? row.color : null,
    outroText: cleanOutro(row.outro_text),
    name: cleanName(row.brand_name),
    logoOnVideo: row.logo_on_video !== false,
    logoOnThumbnail: row.logo_on_thumbnail !== false,
  };
}

/** True when the kit would change anything. */
export function kitIsUsable(kit: BrandKit | null): kit is BrandKit {
  return Boolean(kit && ((kit.logoUrl && (kit.logoOnVideo || kit.logoOnThumbnail)) || kit.color || kit.outroText));
}

export function brandSnapshot(kit: BrandKit | null): BrandSnapshot | null {
  if (!kitIsUsable(kit)) return null;
  const snap: BrandSnapshot = {};
  if (kit.logoUrl && (kit.logoOnVideo || kit.logoOnThumbnail)) {
    snap.logoUrl = kit.logoUrl;
    snap.videoLogo = kit.logoOnVideo;
    snap.thumbLogo = kit.logoOnThumbnail;
    if (kit.name && kit.logoOnVideo) snap.name = kit.name;
  }
  if (kit.color) snap.color = kit.color;
  if (kit.outroText) snap.outroText = kit.outroText;
  return snap;
}

/** Validates a stored snapshot coming back from job options. */
export function readSnapshot(v: unknown): BrandSnapshot | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const snap: BrandSnapshot = {};
  if (typeof o.logoUrl === "string" && /^https:\/\//.test(o.logoUrl)) {
    snap.logoUrl = o.logoUrl;
    snap.videoLogo = o.videoLogo === true;
    snap.thumbLogo = o.thumbLogo === true;
    const name = cleanName(o.name);
    if (name && snap.videoLogo) snap.name = name;
  }
  if (isHexColor(o.color)) snap.color = o.color;
  const outro = cleanOutro(o.outroText);
  if (outro) snap.outroText = outro;
  return Object.keys(snap).length ? snap : null;
}

/** Readable text colour (black/white) on a background colour. */
export function contrastText(hex: string): "#000000" | "#FFFFFF" {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? "#000000" : "#FFFFFF";
}
