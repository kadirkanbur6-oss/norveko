// lib/i18n/languages.ts — languages the site itself can be read in (14 Nov 2026).
//
// The interface is written in English. Visitors can pick another language in the
// navbar (LanguageMenu); SiteTranslator then swaps the page text for a machine
// translation that is made once per string and kept in a shared dictionary
// (app/api/i18n/route.ts). The list is the same 29 languages videos can be made in.
// Pure and client-safe.

import { LANGUAGE_OPTIONS } from "@/lib/pipeline/options";

export const SITE_LANGUAGES = LANGUAGE_OPTIONS.map((l) => ({ code: l.code, label: l.label, english: l.english, flag: l.flag }));
export const SITE_LANGUAGE_CODES: readonly string[] = SITE_LANGUAGES.map((l) => l.code);
export const DEFAULT_SITE_LANGUAGE = "en";
export const SITE_LANGUAGE_KEY = "nv_lang";

export function siteLanguage(code: string | null | undefined) {
  return SITE_LANGUAGES.find((l) => l.code === code) ?? SITE_LANGUAGES[0];
}

/** Limits shared by the browser and the API. */
export const I18N_MAX_STRING = 1500;
export const I18N_MAX_BATCH = 60;
export const I18N_MAX_BATCH_CHARS = 14000;
/** What the browser actually sends per request: small batches come back faster and line up reliably. */
export const I18N_CLIENT_BATCH = 24;
export const I18N_CLIENT_BATCH_CHARS = 3500;

/** Public address of a language's dictionary (JSON object: English text → translation). */
export function dictionaryPath(code: string): string {
  return `i18n/${code}.json`;
}

/** Text worth translating: real words in Latin script, not a bare number, price, e-mail or link. */
export function translatable(text: string, maxLength = I18N_MAX_STRING): boolean {
  if (text.length < 2 || text.length > maxLength) return false;
  if (!/[A-Za-z]{2}/.test(text)) return false;
  if (/^\S+@\S+\.\S+$/.test(text) || /^(https?:\/\/|www\.)\S+$/i.test(text)) return false;
  return true;
}
