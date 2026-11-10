// lib/characters/characters.ts
// Recurring characters (2 Nov 2026, Kadir): the creator registers a person once
// — themself or someone who agreed (photos), a historical figure (portrait from
// Wikimedia Commons) or an invented one (generated portrait) — and every scene
// that features them is drawn from those references, so the same face appears
// throughout the video.
//
// Rules (shown in the UI and enforced here):
//   • photos: only the creator or a person who gave permission (checkbox,
//     stored as consent_at); no children (vision check on every photo);
//   • any real or invented person may be used (3 Nov 2026, Kadir: the creator
//     decides and takes responsibility) — no children, nothing explicit;
//   • "historical" = any real, well-known person (portrait from Commons).
// Reference images live in the PRIVATE "characters" bucket; the pipeline
// reads them with the service role. Server-only.

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type CharacterKind = "self" | "person" | "historical" | "fictional";
export const CHARACTER_KINDS: CharacterKind[] = ["self", "person", "historical", "fictional"];
export const CHARACTER_BUCKET = "characters";
export const MAX_CHARACTERS = 12;
export const MAX_REFERENCES = 4;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // all photos together (Vercel body limit 4.5 MB)
export const MAX_CAST = 3;

export interface CharacterRow {
  id: string;
  user_id: string;
  name: string;
  kind: CharacterKind;
  description: string | null;
  reference_paths: string[];
  consent_at: string | null;
  created_at: string;
}

/** What a job carries about its cast (snapshot at start). */
export interface CastMember {
  id: string;
  name: string;
  kind: CharacterKind;
  description: string;
  /** Paths in the private characters bucket. */
  refs: string[];
}

export function cleanName(v: unknown): string {
  return typeof v === "string" ? v.replace(/[<>"\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) : "";
}
export function cleanDescription(v: unknown): string {
  return typeof v === "string" ? v.replace(/[<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : "";
}

export async function ensureBucket(db: SupabaseClient): Promise<void> {
  const { data } = await db.storage.getBucket(CHARACTER_BUCKET);
  if (data) return;
  await db.storage.createBucket(CHARACTER_BUCKET, { public: false, fileSizeLimit: 8 * 1024 * 1024 });
}

export async function listCharacters(db: SupabaseClient, userId: string): Promise<CharacterRow[]> {
  const { data, error } = await db.from("characters").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CharacterRow[];
}

/** Snapshot of the chosen characters for a job (only the user's own, max MAX_CAST). */
export async function castSnapshot(db: SupabaseClient, userId: string, ids: unknown): Promise<CastMember[]> {
  const wanted = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string").slice(0, MAX_CAST) : [];
  if (!wanted.length) return [];
  const { data } = await db.from("characters").select("*").eq("user_id", userId).in("id", wanted);
  return ((data ?? []) as CharacterRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind,
    description: c.description ?? "",
    refs: (c.reference_paths ?? []).slice(0, MAX_REFERENCES),
  }));
}

export function readCast(v: unknown): CastMember[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is CastMember => Boolean(c) && typeof (c as CastMember).name === "string" && Array.isArray((c as CastMember).refs))
    .slice(0, MAX_CAST);
}

/** Download a character's reference images (service role) for the image model. */
export async function loadReferenceImages(db: SupabaseClient, paths: string[]): Promise<Array<{ mimeType: string; data: string }>> {
  const out: Array<{ mimeType: string; data: string }> = [];
  for (const path of paths.slice(0, MAX_REFERENCES)) {
    const { data } = await db.storage.from(CHARACTER_BUCKET).download(path);
    if (!data) continue;
    const buf = Buffer.from(await data.arrayBuffer());
    out.push({ mimeType: data.type || "image/jpeg", data: buf.toString("base64") });
  }
  return out;
}

/** Short-lived links for showing references in the UI. */
export async function signedReferenceUrls(db: SupabaseClient, paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const { data } = await db.storage.from(CHARACTER_BUCKET).createSignedUrls(paths, 3600);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => Boolean(u));
}

const GEMINI_TEXT = process.env.CHARACTER_CHECK_MODEL || "gemini-3.8-flash";

export async function geminiJson(parts: Array<Record<string, unknown>>): Promise<Record<string, unknown> | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_TEXT)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Check model error (${res.status}).`);
  const data = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
  return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
}

/**
 * Only children are refused (3 Nov 2026: living public figures are allowed —
 * the creator's responsibility). For real/historical people the check also
 * finds the portrait to start from; a check error there refuses.
 */
export async function checkIdentity(name: string, description: string, kind: CharacterKind): Promise<{ ok: true; portraitQuery?: string; diedYear?: number } | { ok: false; reason: string }> {
  const r = await geminiJson([
    {
      text: `A video creator wants to add a recurring character to their videos.
Name: "${name}"
Description: "${description}"
Type: ${kind === "historical" ? "a historical figure" : kind === "fictional" ? "an invented character" : kind === "self" ? "the creator themself (photos)" : "a person who gave the creator permission (photos)"}
Answer as JSON: {"realPerson": boolean (does the name/description clearly refer to a specific real, well-known person?), "living": boolean (is that real person alive, or died less than 50 years ago?), "publicFigure": boolean (politician, athlete, coach, celebrity, influencer, business leader, royalty…), "minor": boolean (described as a child/teen), "diedYear": number|null, "portraitQuery": string (for historical figures: the English title of their best-known portrait as it would be named on Wikimedia Commons, else "")}`,
    },
  ]);
  if (!r) return kind === "historical" ? { ok: false, reason: "We couldn't verify this historical figure right now. Please try again." } : { ok: true };
  if (r.minor === true) return { ok: false, reason: "Characters can't be children." };
  if (kind === "historical") {
    if (r.realPerson !== true) return { ok: false, reason: "We couldn't find this person. Check the spelling, or create an invented character instead." };
    return { ok: true, portraitQuery: typeof r.portraitQuery === "string" ? r.portraitQuery : name, diedYear: typeof r.diedYear === "number" ? r.diedYear : undefined };
  }
  return { ok: true };
}

/** Vision check on an uploaded photo: one clearly visible adult, not a child. */
export async function checkPhoto(bytes: Buffer, mimeType: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const r = await geminiJson([
    { text: 'Look at this photo. Answer as JSON: {"faces": number (people clearly visible), "child": boolean (does any visible person look under 18?), "explicit": boolean (nudity or sexual content)}' },
    { inlineData: { mimeType, data: bytes.toString("base64") } },
  ]).catch(() => null);
  if (!r) return { ok: false, reason: "We couldn't check this photo right now. Please try again." };
  if (r.explicit === true) return { ok: false, reason: "This photo can't be used." };
  if (r.child === true) return { ok: false, reason: "Photos of children can't be used for characters." };
  if (typeof r.faces === "number" && r.faces < 1) return { ok: false, reason: "We couldn't see a face in one of the photos. Use clear photos of one person." };
  return { ok: true };
}

/**
 * Historical people at the heart of a video idea ("Timur and Bayezid at
 * Ankara" → ["Timur", "Bayezid I"]), so the workspace can offer them as
 * characters in one click.
 */
export async function suggestHistoricalCast(idea: string): Promise<string[]> {
  const r = await geminiJson([
    {
      text: `Video idea: "${idea.slice(0, 600)}"
List the real, well-known PEOPLE who are central characters of this idea (living or dead; at most 3; none for places, events, objects or groups). Use the name the way the idea writes it, or the usual name in the idea's language. Answer as JSON: {"people": ["..."]}`,
    },
  ]).catch(() => null);
  const people = Array.isArray(r?.people) ? (r!.people as unknown[]) : [];
  return people
    .map((p) => String(p ?? "").trim().replace(/\s+/g, " ").slice(0, 40))
    .filter((p) => p.length >= 2)
    .slice(0, 3);
}
