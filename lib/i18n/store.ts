"use client";

// lib/i18n/store.ts — the visitor's chosen site language (localStorage "nv_lang").
// Shared by LanguageMenu (sets it) and SiteTranslator (applies it).

import { useSyncExternalStore } from "react";
import { DEFAULT_SITE_LANGUAGE, SITE_LANGUAGE_CODES, SITE_LANGUAGE_KEY } from "./languages";

const EVENT = "nv-lang";

function readLanguage(): string {
  try {
    const saved = localStorage.getItem(SITE_LANGUAGE_KEY);
    if (saved && SITE_LANGUAGE_CODES.includes(saved)) return saved;
  } catch {
    // Private mode: stay in English.
  }
  return DEFAULT_SITE_LANGUAGE;
}

export function setSiteLanguage(code: string) {
  try {
    localStorage.setItem(SITE_LANGUAGE_KEY, code);
  } catch {
    // The choice lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: code }));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useSiteLanguage(): string {
  return useSyncExternalStore(subscribe, readLanguage, () => DEFAULT_SITE_LANGUAGE);
}

