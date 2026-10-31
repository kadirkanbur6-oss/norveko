// lib/voice/clones.ts
// Creators' own cloned voices (31 Oct 2026). One per account, created with
// ElevenLabs Instant Voice Cloning from samples the creator uploads or
// records, after confirming it is their voice (or they have permission).
// A clone lives in the shared ElevenLabs account, so:
//   - it is listed only to its owner (/api/voices "mine"),
//   - nobody else may use it (/api/pipeline/start),
//   - library-voice eviction never removes it (addLibraryVoice protectedIds).
// Table public.voice_clones (SQL in supabase/README.md), service role only.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface VoiceClone {
  user_id: string;
  voice_id: string;
  name: string;
  created_at: string;
}

export const CLONE_MAX_BYTES = 4 * 1024 * 1024; // Vercel request body limit is 4.5 MB
export const CLONE_MIN_BYTES = 40 * 1024;
export const CLONE_MAX_FILES = 3;

/** Every clone's voice id → owner (small table; read per request). */
export async function cloneOwners(db: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await db.from("voice_clones").select("voice_id, user_id");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r: { voice_id: string; user_id: string }) => [r.voice_id, r.user_id]));
}

export async function userClone(db: SupabaseClient, userId: string): Promise<VoiceClone | null> {
  const { data, error } = await db.from("voice_clones").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VoiceClone | null) ?? null;
}

export function cleanVoiceName(v: unknown): string {
  const t = typeof v === "string" ? v.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
  return t || "My voice";
}

/** Text the creator reads aloud when recording in the browser (~45 s). */
export const READING_SCRIPT =
  "On a cold December night in 1900, a supply ship reached a lonely lighthouse in Scotland. " +
  "The lamp was dark, the beds were made, and the three keepers were nowhere to be found. " +
  "What happened to them? Some say a giant wave. Others tell stranger stories. " +
  "Today, I'm going to walk you through what we actually know, step by step, " +
  "and let you decide for yourself. Stay with me until the end, because the last clue changes everything.";
