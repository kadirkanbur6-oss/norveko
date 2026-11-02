// lib/pipeline/source-url.ts
// "Make a video from a link" (2 Nov 2026): fetch a public article/blog page,
// pull out its readable text, and let the research step turn it into the
// brief the script is written from (instead of a web search).
//
// Safety: only http(s) on public addresses (no localhost / private / link-local
// ranges, re-checked on every redirect), small timeouts and a size cap.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const MAX_SOURCE_CHARS = 14_000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Normalise what the user pasted; null when it isn't a usable web address. */
export function cleanSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname.includes(".") && !isIP(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === "::" || s === "::1") return true;
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
  }
  return true;
}

async function assertPublic(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("That address isn't a public web page.");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("That address isn't a public web page.");
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
function decode(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Readable text of an HTML page: the article/main part, without menus, scripts and footers. */
export function extractArticle(html: string): { title: string; text: string } {
  const title = decode((html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim()).slice(0, 200);
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template|form|button|select)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside)[\s\S]*?<\/\1>/gi, " ");
  const article = body.match(/<article[\s\S]*?<\/article>/gi);
  const main = body.match(/<main[\s\S]*?<\/main>/i);
  if (article?.length) body = article.sort((a, b) => b.length - a.length)[0];
  else if (main) body = main[0];
  const text = decode(
    body
      .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/tr|\/blockquote)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, MAX_SOURCE_CHARS);
  return { title, text };
}

/** Fetch a public page and return its readable text. */
export async function fetchArticle(raw: string): Promise<{ url: string; title: string; text: string }> {
  let url = new URL(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NorvekoBot/1.0; +https://norveko.app)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("That link redirects somewhere we can't read.");
      continue;
    }
    if (!res.ok) throw new Error(`The page answered with an error (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) throw new Error("That link isn't a web page we can read (PDFs and videos aren't supported yet).");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const html = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
    const article = /text\/plain/i.test(type) ? { title: "", text: html.slice(0, MAX_SOURCE_CHARS) } : extractArticle(html);
    if (article.text.length < 300) throw new Error("We couldn't find enough readable text on that page (it may need a login or be built with scripts).");
    return { url: url.toString(), ...article };
  }
  throw new Error("That link redirects too many times.");
}
