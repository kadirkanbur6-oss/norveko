// app/api/characters/route.ts — recurring characters (lib/characters/characters.ts).
// GET: the user's characters (+ signed preview links) and whether they may add one.
// POST (multipart): kind, name, description, consent, photos[] → checks, references, row.
// DELETE ?id=… removes a character and its reference images.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { hasPurchased, isWatermarkExempt } from "@/lib/pipeline/watermark-policy";
import {
  CHARACTER_BUCKET,
  CHARACTER_KINDS,
  MAX_CHARACTERS,
  MAX_PHOTO_BYTES,
  MAX_REFERENCES,
  checkIdentity,
  checkPhoto,
  cleanDescription,
  cleanName,
  ensureBucket,
  listCharacters,
  signedReferenceUrls,
  type CharacterKind,
} from "@/lib/characters/characters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const unauthorized = () => NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
const bad = (error: string, status = 400) => NextResponse.json({ success: false, error }, { status });

async function allowed(db: ReturnType<typeof adminDb>, userId: string): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false;
  return isWatermarkExempt(userId) || (await hasPurchased(db, userId));
}

async function toJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

export async function GET() {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const db = adminDb();
  try {
    const [rows, ok] = await Promise.all([listCharacters(db, user.id), allowed(db, user.id)]);
    const characters = await Promise.all(
      rows.map(async (c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        description: c.description ?? "",
        previews: await signedReferenceUrls(db, (c.reference_paths ?? []).slice(0, 2)),
        createdAt: c.created_at,
      }))
    );
    return NextResponse.json({ success: true, allowed: ok, max: MAX_CHARACTERS, characters });
  } catch (err) {
    console.error("[characters] list failed:", err);
    return NextResponse.json({ success: true, allowed: false, max: MAX_CHARACTERS, characters: [] });
  }
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const db = adminDb();
  if (!(await allowed(db, user.id))) return bad("Characters are available on any plan or pack.", 403);

  const form = await req.formData().catch(() => null);
  if (!form) return bad("Invalid request.");
  const kind = String(form.get("kind") ?? "") as CharacterKind;
  if (!CHARACTER_KINDS.includes(kind)) return bad("Pick a character type.");
  const name = cleanName(form.get("name"));
  if (name.length < 2) return bad("Give the character a name.");
  const description = cleanDescription(form.get("description"));
  if (kind === "fictional" && description.length < 10) return bad("Describe how the character looks (age, face, hair, clothing).");
  const uploads = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_REFERENCES);
  // Historical figures may come with the creator's own portrait (e.g. a painting they found).
  const ownPortrait = kind === "historical" && uploads.length > 0;
  const usesPhotos = kind === "self" || kind === "person" || ownPortrait;
  if (usesPhotos && form.get("consent") !== "yes") {
    return bad(
      kind === "self"
        ? "Confirm that the photos are of you."
        : ownPortrait
          ? "Confirm that you have the right to use these pictures."
          : "Confirm that this person agreed to appear in your videos."
    );
  }

  const existing = await listCharacters(db, user.id);
  if (existing.length >= MAX_CHARACTERS) return bad(`You can keep up to ${MAX_CHARACTERS} characters. Delete one first.`);
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) return bad("You already have a character with this name.");

  // Children are refused; any real person is allowed (creator's responsibility).
  let identity: Awaited<ReturnType<typeof checkIdentity>>;
  try {
    identity = await checkIdentity(name, description, kind);
  } catch (err) {
    console.error("[characters] identity check failed:", err);
    identity = kind === "historical" ? { ok: false, reason: "We couldn't verify this historical figure right now. Please try again." } : { ok: true };
  }
  if (!identity.ok) return bad(identity.reason);

  await ensureBucket(db);
  const id = randomUUID();
  const images: Array<{ bytes: Buffer; type: string }> = [];

  try {
    if (usesPhotos) {
      const files = uploads;
      if (!files.length) return bad("Add 1–4 clear photos of the person's face.");
      if (files.reduce((n, f) => n + f.size, 0) > MAX_PHOTO_BYTES) return bad("The photos must be under 4 MB together.");
      for (const f of files) {
        let jpg: Buffer;
        try {
          jpg = await toJpeg(Buffer.from(await f.arrayBuffer()));
        } catch {
          return bad("One of the files isn't an image we can read (use JPG, PNG or WebP).");
        }
        const check = await checkPhoto(jpg, "image/jpeg");
        if (!check.ok) return bad(check.reason);
        images.push({ bytes: jpg, type: "image/jpeg" });
      }
      if (ownPortrait) {
        // Their portrait → a lifelike reference first (the painting itself stays as a second reference).
        const { generateReferencePortrait } = await import("@/lib/pipeline/gemini-image");
        const portrait = await generateReferencePortrait({
          name,
          description,
          fromImage: { mimeType: "image/jpeg", data: images[0].bytes.toString("base64") },
        });
        images.unshift({ bytes: await toJpeg(portrait.bytes), type: "image/jpeg" });
        images.splice(MAX_REFERENCES);
      }
    } else {
      const { generateReferencePortrait } = await import("@/lib/pipeline/gemini-image");
      let source: { mimeType: string; data: string } | null = null;
      if (kind === "historical") {
        // Their best-known (public-domain) portrait from Wikimedia Commons.
        const { searchArchiveImages, downloadArchiveImage } = await import("@/lib/pipeline/commons");
        const { pickFittingFrames } = await import("@/lib/pipeline/stock-check");
        const query = (identity.portraitQuery || name).slice(0, 80);
        const found = await searchArchiveImages(`${query} portrait`, 8).catch(() => []);
        const fit = found.length
          ? await pickFittingFrames({ scene: `A portrait of ${name}`, prompt: `portrait of ${name}`, subject: name, previews: found.map((f) => f.url) }).catch(() => null)
          : null;
        const best = fit && fit.length ? found[fit[0]] : null;
        if (best) {
          const img = await downloadArchiveImage(best.url);
          const jpg = await toJpeg(img.bytes);
          images.push({ bytes: jpg, type: "image/jpeg" });
          source = { mimeType: "image/jpeg", data: jpg.toString("base64") };
        }
      }
      const portrait = await generateReferencePortrait({ name, description, fromImage: source });
      images.unshift({ bytes: await toJpeg(portrait.bytes), type: "image/jpeg" });
    }

    const paths: string[] = [];
    for (const [i, img] of images.entries()) {
      const path = `${user.id}/${id}/ref-${i + 1}.jpg`;
      const up = await db.storage.from(CHARACTER_BUCKET).upload(path, img.bytes, { contentType: img.type, upsert: true });
      if (up.error) throw new Error(up.error.message);
      paths.push(path);
    }
    const { error } = await db.from("characters").insert({
      id,
      user_id: user.id,
      name,
      kind,
      description: description || null,
      reference_paths: paths,
      consent_at: usesPhotos ? new Date().toISOString() : null,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      success: true,
      character: { id, name, kind, description, previews: await signedReferenceUrls(db, paths.slice(0, 2)) },
    });
  } catch (err) {
    console.error("[characters] create failed:", err);
    return bad("We couldn't create this character. Please try again.", 500);
  }
}

export async function DELETE(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return bad("Unknown character.");
  const db = adminDb();
  const { data } = await db.from("characters").select("reference_paths").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) return bad("Unknown character.", 404);
  const paths = (data.reference_paths as string[] | null) ?? [];
  if (paths.length) await db.storage.from(CHARACTER_BUCKET).remove(paths);
  await db.from("characters").delete().eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ success: true });
}
