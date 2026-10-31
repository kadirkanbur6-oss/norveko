// lib/download.ts
// Download links for files hosted on Supabase Storage. Browsers ignore the
// <a download> attribute for cross-origin URLs and just open the file (a bare
// video page), so we ask Storage itself to send it as an attachment via its
// `?download=<filename>` parameter (Content-Disposition: attachment).

/** "Dyatlov Geçidi: Dokuz Kayakçı…" → "dyatlov-gecidi-dokuz-kayakci" (ASCII, safe on every OS). */
export function safeFileName(title: string, fallback = "norveko"): string {
  const ascii = title
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const slug = ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || fallback;
}

/** Same URL, but Supabase Storage will serve it as a download named `filename`. */
export function downloadHref(url: string, filename: string): string {
  if (!url.includes("/storage/v1/object/public/")) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("download", filename);
    return u.toString();
  } catch {
    return url;
  }
}
