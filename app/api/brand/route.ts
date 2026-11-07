// app/api/brand/route.ts — the creator's brand kit (lib/brand/kit.ts).
// GET: kit (or null). PUT: colour / end-card line / where the logo shows.
// POST (multipart "logo"): upload a logo (PNG/JPEG/WebP ≤ 2 MB → PNG ≤ 512 px).
// DELETE ?part=logo removes the logo; without it, the whole kit.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { requireUser } from "@/lib/supabase-server";
import { adminDb } from "@/lib/youtube/oauth";
import { cleanName, cleanOutro, isHexColor, LOGO_MAX_BYTES, LOGO_MAX_PX, rowToKit } from "@/lib/brand/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });

async function load(db: ReturnType<typeof adminDb>, userId: string) {
  const { data, error } = await db.from("brand_kits").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown> | null;
}

export async function GET() {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  try {
    return NextResponse.json({ success: true, kit: rowToKit(await load(adminDb(), user.id)) });
  } catch (err) {
    console.error("[brand] load failed:", err);
    return NextResponse.json({ success: true, kit: null });
  }
}

export async function PUT(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.color !== null && body.color !== undefined && !isHexColor(body.color)) {
    return NextResponse.json({ success: false, error: "Pick a colour like #7C3AED." }, { status: 400 });
  }
  const db = adminDb();
  const row: Record<string, unknown> = {
    user_id: user.id,
    color: isHexColor(body.color) ? body.color.toUpperCase() : null,
    outro_text: cleanOutro(body.outroText),
    brand_name: cleanName(body.name),
    logo_on_video: body.logoOnVideo !== false,
    logo_on_thumbnail: body.logoOnThumbnail !== false,
    updated_at: new Date().toISOString(),
  };
  let { error } = await db.from("brand_kits").upsert(row);
  // Before the brand_name column exists (supabase/README.md), save everything else.
  if (error && /brand_name/.test(error.message)) {
    delete row.brand_name;
    ({ error } = await db.from("brand_kits").upsert(row));
  }
  if (error) return NextResponse.json({ success: false, error: "Couldn't save your brand kit." }, { status: 500 });
  return NextResponse.json({ success: true, kit: rowToKit(await load(db, user.id)) });
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const form = await req.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ success: false, error: "Choose an image file." }, { status: 400 });
  }
  if (file.size > LOGO_MAX_BYTES) return NextResponse.json({ success: false, error: "The logo must be under 2 MB." }, { status: 400 });
  let png: Buffer;
  try {
    png = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: LOGO_MAX_PX, height: LOGO_MAX_PX, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
  } catch {
    return NextResponse.json({ success: false, error: "That file isn't an image we can read (use PNG, JPG or WebP)." }, { status: 400 });
  }
  const db = adminDb();
  const previous = await load(db, user.id);
  const path = `brand/${user.id}/logo-${randomUUID()}.png`;
  const up = await db.storage.from("videos").upload(path, png, { contentType: "image/png", upsert: false });
  if (up.error) return NextResponse.json({ success: false, error: "Upload failed. Please try again." }, { status: 500 });
  const url = db.storage.from("videos").getPublicUrl(path).data.publicUrl;
  const { error } = await db.from("brand_kits").upsert({
    user_id: user.id,
    logo_url: url,
    logo_path: path,
    color: previous?.color ?? null,
    outro_text: previous?.outro_text ?? null,
    ...(previous && "brand_name" in previous ? { brand_name: previous.brand_name ?? null } : {}),
    logo_on_video: previous?.logo_on_video ?? true,
    logo_on_thumbnail: previous?.logo_on_thumbnail ?? true,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ success: false, error: "Couldn't save your logo." }, { status: 500 });
  // Old logo files stay: videos made earlier still point at them (re-renders).
  return NextResponse.json({ success: true, kit: rowToKit(await load(db, user.id)) });
}

export async function DELETE(req: Request) {
  const { user } = await requireUser();
  if (!user) return unauthorized();
  const db = adminDb();
  if (new URL(req.url).searchParams.get("part") === "logo") {
    await db.from("brand_kits").update({ logo_url: null, logo_path: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
    return NextResponse.json({ success: true, kit: rowToKit(await load(db, user.id)) });
  }
  await db.from("brand_kits").delete().eq("user_id", user.id);
  return NextResponse.json({ success: true, kit: null });
}
