"use client";

// app/components/SiteTranslator.tsx
// Shows the site in the visitor's language (14 Nov 2026).
//
// The interface is written in English. When another language is picked (LanguageMenu,
// saved in localStorage "nv_lang"), this component swaps the text nodes of the page for
// their translation and keeps doing so as React renders new content:
//   1. the shared dictionary for that language is read from public storage (and kept in
//      localStorage so the next page load is instant);
//   2. strings it does not have yet are sent to /api/i18n in small batches, translated
//      once and added to the shared dictionary for everyone.
// Text inside inputs, code, and anything marked translate="no" or data-nt is left alone.
// Mounted once in app/layout.tsx. Picking English puts the original text back.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { DEFAULT_SITE_LANGUAGE, I18N_MAX_BATCH, I18N_MAX_BATCH_CHARS, dictionaryPath, translatable } from "@/lib/i18n/languages";
import { useSiteLanguage } from "@/lib/i18n/store";
import LanguageMenu from "./LanguageMenu";

const SKIP = 'script,style,noscript,textarea,code,pre,svg,[translate="no"],[data-nt],[contenteditable="true"]';
// Pages a visitor reads signed out carry long paragraphs (FAQ, Terms). Inside the app, long
// text is the user's own script, so only short interface strings are translated there.
const PUBLIC_PATHS = ["/", "/terms", "/privacy", "/refund", "/compare", "/developers", "/login", "/signup", "/forgot-password"];

type Dictionary = Record<string, string>;

/** English text of every node we changed, and what we changed it to. */
const original = new WeakMap<Text, string>();
const shown = new WeakMap<Text, string>();

function cacheKey(code: string) {
  return `nv_i18n_${code}`;
}

function cachedDictionary(code: string): Dictionary {
  try {
    const raw = localStorage.getItem(cacheKey(code));
    return raw ? (JSON.parse(raw) as Dictionary) : {};
  } catch {
    return {};
  }
}

function rememberDictionary(code: string, dict: Dictionary) {
  try {
    const raw = JSON.stringify(dict);
    if (raw.length < 900_000) localStorage.setItem(cacheKey(code), raw);
  } catch {
    // Storage full or blocked: the dictionary is fetched again next time.
  }
}

async function fetchDictionary(code: string): Promise<Dictionary> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return {};
  try {
    // A new address every ten minutes keeps the CDN copy reasonably fresh.
    const res = await fetch(`${base}/storage/v1/object/public/videos/${dictionaryPath(code)}?v=${Math.floor(Date.now() / 600_000)}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data && typeof data === "object" ? (data as Dictionary) : {};
  } catch {
    return {};
  }
}

function restore(root: Node) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    const source = original.get(node);
    if (source !== undefined && shown.get(node) === node.nodeValue) node.nodeValue = source;
    original.delete(node);
    shown.delete(node);
  }
  document.querySelectorAll<HTMLElement>("[data-nv-ph]").forEach((el) => {
    el.setAttribute("placeholder", el.dataset.nvPh ?? "");
    delete el.dataset.nvPh;
    delete el.dataset.nvPhT;
  });
}

function startTranslating(code: string, maxLength: number): () => void {
  let stopped = false;
  const dict: Dictionary = cachedDictionary(code);
  const waiting = new Map<string, Set<Text | HTMLElement>>();
  const failed = new Set<string>();
  const queue = new Set<string>();
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const applyText = (node: Text, source: string, translation: string) => {
    if (node.nodeValue !== source) return; // React changed it meanwhile; the observer sees the new text
    const lead = source.match(/^\s*/)?.[0] ?? "";
    const trail = source.match(/\s*$/)?.[0] ?? "";
    const next = lead + translation + trail;
    original.set(node, source);
    shown.set(node, next);
    node.nodeValue = next;
  };

  const applyPlaceholder = (el: HTMLElement, translation: string) => {
    if (el.dataset.nvPh === undefined) el.dataset.nvPh = el.getAttribute("placeholder") ?? "";
    el.dataset.nvPhT = translation;
    el.setAttribute("placeholder", translation);
  };

  const want = (core: string, target: Text | HTMLElement) => {
    if (failed.has(core)) return;
    let set = waiting.get(core);
    if (!set) waiting.set(core, (set = new Set()));
    set.add(target);
    queue.add(core);
    if (!timer) timer = setTimeout(flush, 150);
  };

  const visitText = (node: Text) => {
    const value = node.nodeValue ?? "";
    if (shown.get(node) === value) return; // already ours
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const core = value.trim();
    if (!translatable(core, maxLength)) return;
    const hit = dict[core];
    if (hit) applyText(node, value, hit);
    else want(core, node);
  };

  const visitPlaceholder = (el: HTMLElement) => {
    if (el.closest('[translate="no"],[data-nt]')) return;
    const current = el.getAttribute("placeholder") ?? "";
    if (el.dataset.nvPhT === current) return;
    delete el.dataset.nvPh; // the app set a new placeholder
    const core = current.trim();
    if (!translatable(core, maxLength)) return;
    const hit = dict[core];
    if (hit) applyPlaceholder(el, hit);
    else want(core, el);
  };

  const scan = (root: Node) => {
    if (root.nodeType === Node.TEXT_NODE) return visitText(root as Text);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const el = root as HTMLElement;
    if (el.closest(SKIP)) return;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) visitText(n as Text);
    if (el.matches("input[placeholder],textarea[placeholder]")) visitPlaceholder(el);
    el.querySelectorAll<HTMLElement>("input[placeholder],textarea[placeholder]").forEach(visitPlaceholder);
  };

  const settle = (core: string, translation: string | undefined) => {
    const targets = waiting.get(core);
    waiting.delete(core);
    if (!translation) {
      failed.add(core);
      return;
    }
    dict[core] = translation;
    targets?.forEach((target) => {
      if (!target.isConnected) return;
      if (target instanceof Text) {
        const value = target.nodeValue ?? "";
        if (value.trim() === core) applyText(target, value, translation);
      } else if ((target.getAttribute("placeholder") ?? "").trim() === core) {
        applyPlaceholder(target, translation);
      }
    });
  };

  async function flush() {
    timer = null;
    while (!stopped && queue.size && inFlight < 3) {
      const batch: string[] = [];
      let chars = 0;
      for (const core of queue) {
        if (batch.length >= I18N_MAX_BATCH || chars + core.length > I18N_MAX_BATCH_CHARS) break;
        batch.push(core);
        chars += core.length;
      }
      batch.forEach((core) => queue.delete(core));
      inFlight += 1;
      void fetch("/api/i18n", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: code, texts: batch }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((data: { translations?: Dictionary } | null) => {
          if (stopped) return;
          const got = data?.translations ?? {};
          batch.forEach((core) => settle(core, got[core]));
          rememberDictionary(code, dict);
        })
        .finally(() => {
          inFlight -= 1;
          if (!stopped && queue.size) void flush();
        });
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "characterData") scan(m.target);
      else if (m.type === "attributes") scan(m.target);
      else m.addedNodes.forEach(scan);
    }
  });

  scan(document.body);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });

  // The shared dictionary may know more than this browser's copy.
  void fetchDictionary(code).then((remote) => {
    if (stopped || !Object.keys(remote).length) return;
    Object.assign(dict, remote);
    rememberDictionary(code, dict);
    for (const core of [...waiting.keys()]) {
      if (!remote[core]) continue;
      queue.delete(core);
      settle(core, remote[core]);
    }
    scan(document.body);
  });

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    observer.disconnect();
    restore(document.body);
  };
}

export default function SiteTranslator() {
  const lang = useSiteLanguage();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.includes(pathname ?? "/");
  const [needsFloating, setNeedsFloating] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
    if (lang === DEFAULT_SITE_LANGUAGE) return;
    return startTranslating(lang, isPublic ? 1500 : 240);
  }, [lang, isPublic]);

  // Every page gets a language menu: pages without one in their own header get a small floating one.
  useEffect(() => {
    const t = setTimeout(() => setNeedsFloating(!document.querySelector("[data-lang-menu]:not([data-lang-floating])")), 400);
    return () => clearTimeout(t);
  }, [pathname]);

  if (!needsFloating) return null;
  return (
    <div className="fixed bottom-4 right-4 z-40" data-lang-floating>
      <LanguageMenu placement="up" floating />
    </div>
  );
}
