// lib/pipeline/templates.ts
// Niche templates for the AI Workspace. Each one pre-fills the form and adds a
// short "brief" that is appended to the script prompt so the output matches
// the genre's conventions. Shared by the UI and the API (validation).

import type { DURATIONS, PLATFORMS, STYLES } from "./options";

export interface NicheTemplate {
  id: string;
  name: string;
  tagline: string;
  platform: (typeof PLATFORMS)[number];
  style: (typeof STYLES)[number];
  duration: (typeof DURATIONS)[number];
  /** Example ideas shown as one-click chips. */
  examples: string[];
  /** Genre guidance injected into the script prompt (English). */
  brief: string;
}

export const NICHE_TEMPLATES: NicheTemplate[] = [
  {
    id: "history-documentary",
    name: "History documentary",
    tagline: "Long-form, narrated, archival feel",
    platform: "YouTube Long-form",
    style: "Documentary",
    duration: "8 minutes",
    examples: [
      "The last days of Pompeii, told through one family",
      "How the Library of Alexandria was really lost",
      "The forgotten engineers behind the Roman aqueducts",
    ],
    brief:
      "Genre: history documentary. Open with a vivid, specific moment rather than a summary. Anchor the narrative in verifiable dates, places and named people; flag anything uncertain as 'historians believe' rather than asserting it. Structure: hook → context → rising events → turning point → consequences → reflective close. Scene prompts should favour archival textures: maps, period paintings, slow push-ins on artefacts, dust and candlelight, muted palettes.",
  },
  {
    id: "true-crime",
    name: "True crime",
    tagline: "Tense, factual, case-driven",
    platform: "YouTube Long-form",
    style: "Mystery",
    duration: "8 minutes",
    examples: [
      "The disappearance that was solved by a parking ticket",
      "A cold case reopened by a single DNA match",
    ],
    brief:
      "Genre: true crime. Stay factual and respectful toward victims; no speculation presented as fact, no gore. Present a clear timeline, the investigation, the breakthrough and the outcome. Build tension with pacing and open questions, not sensational language. Scene prompts: night streets, evidence close-ups, rain on windows, cold blue and amber tones, slow dolly moves.",
  },
  {
    id: "mystery-unexplained",
    name: "Mystery & unexplained",
    tagline: "Curiosity-driven, cliffhanger structure",
    platform: "YouTube Shorts",
    style: "Mystery",
    duration: "60 seconds",
    examples: [
      "The radio signal that repeats every 16 days",
      "Why no one can explain the Dyatlov Pass incident",
      "The village where every clock stopped at the same time",
    ],
    brief:
      "Genre: unexplained mystery. First line must pose the question. Present the known facts, then the competing explanations, then the one detail that doesn't fit. End on a line that invites comments. Keep claims honest: distinguish documented facts from theories. Scene prompts: fog, abandoned places, archival photos with slow zoom, eerie but grounded.",
  },
  {
    id: "explainer",
    name: "Explainer / how it works",
    tagline: "Clear, visual, one concept per scene",
    platform: "YouTube Long-form",
    style: "Educational",
    duration: "3 minutes",
    examples: [
      "How container ships changed the price of everything",
      "Why airplane windows are round",
      "How your phone knows where you are without GPS",
    ],
    brief:
      "Genre: explainer. Start with the everyday observation the viewer already has, then reveal the mechanism step by step; one idea per scene. Use a concrete analogy early. Avoid jargon; when a term is needed, define it in the same sentence. Scene prompts: clean 3D-style diagrams, cutaways, macro shots, bright even lighting.",
  },
  {
    id: "listicle",
    name: "Top 5 / listicle",
    tagline: "Fast, punchy, countdown format",
    platform: "YouTube Shorts",
    style: "Cinematic",
    duration: "60 seconds",
    examples: [
      "5 ancient inventions we still can't fully explain",
      "Top 5 most expensive mistakes in history",
    ],
    brief:
      "Genre: listicle countdown. Announce the count in the hook, then one item per scene from least to most surprising, each with a single memorable fact. Keep each item to two sentences. Finish with the #1 and a one-line payoff. Scene prompts: bold, high-contrast, one hero subject per scene.",
  },
  {
    id: "motivational-story",
    name: "Motivational story",
    tagline: "Emotional arc, strong close",
    platform: "TikTok",
    style: "Cinematic",
    duration: "60 seconds",
    examples: [
      "The janitor who became NASA's problem solver",
      "She was told no 200 times before her first yes",
    ],
    brief:
      "Genre: motivational short. Tell one real person's arc: struggle → turning point → outcome → the lesson in one sentence. Second person for the close ('you'). No clichés like 'never give up' without a concrete image behind them. Scene prompts: golden hour, slow motion, close-ups on hands and faces, warm tones.",
  },
];

export function getTemplate(id: string | null | undefined): NicheTemplate | undefined {
  if (!id) return undefined;
  return NICHE_TEMPLATES.find((t) => t.id === id);
}
