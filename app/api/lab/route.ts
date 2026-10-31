// app/api/lab/route.ts
// Private-beta model comparison lab. POST { action, ... } → generates one
// candidate output, stores it under videos/lab/<run>/ and returns its URL.
// Only users allowed to render full videos can call it.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase-server";
import { isFullVideoEnabled } from "@/lib/pipeline/features";
import {
  listGoogleModels,
  labImage,
  labSpeech,
  labVideoPoll,
  labVideoSubmit,
  type ImageProvider,
  type Media,
  type TtsProvider,
  type VideoHandle,
  type VideoProvider,
} from "@/lib/lab/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function store(run: string, name: string, media: Media): Promise<string> {
  const db = admin();
  const safe = name.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 80);
  const path = `lab/${run}/${safe}.${media.ext}`;
  const { error } = await db.storage.from("videos").upload(path, media.buffer, { contentType: media.contentType, upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return db.storage.from("videos").getPublicUrl(path).data.publicUrl;
}

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user || !isFullVideoEnabled(user.id)) {
    return NextResponse.json({ success: false, error: "Not available." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const run = String(body.run ?? "default").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "default";
  const name = String(body.name ?? body.model ?? "item");
  const started = Date.now();
  try {
    switch (body.action) {
      case "image": {
        const media = await labImage(body.provider as ImageProvider, String(body.model), String(body.prompt ?? ""));
        return NextResponse.json({ success: true, url: await store(run, name, media), ms: Date.now() - started, bytes: media.buffer.length });
      }
      case "tts": {
        const media = await labSpeech(body.provider as TtsProvider, String(body.model), String(body.text ?? ""), String(body.voice ?? ""));
        return NextResponse.json({ success: true, url: await store(run, name, media), ms: Date.now() - started, note: media.note, bytes: media.buffer.length });
      }
      case "video": {
        const handle = await labVideoSubmit(
          body.provider as VideoProvider,
          String(body.model),
          String(body.prompt ?? ""),
          typeof body.imageUrl === "string" && body.imageUrl ? body.imageUrl : undefined
        );
        return NextResponse.json({ success: true, handle, ms: Date.now() - started });
      }
      case "poll": {
        const handle = body.handle as VideoHandle;
        const r = await labVideoPoll(handle);
        if (!r.done) return NextResponse.json({ success: true, done: false });
        if (r.error || !r.media) return NextResponse.json({ success: false, done: true, error: r.error ?? "failed" });
        return NextResponse.json({ success: true, done: true, url: await store(run, name, r.media), bytes: r.media.buffer.length });
      }
      case "align": {
        // Debug: run ElevenLabs forced alignment on a stored narration.
        const audioUrl = String(body.audioUrl ?? "");
        const audioRes = await fetch(audioUrl);
        if (!audioRes.ok) throw new Error(`audio fetch HTTP ${audioRes.status}`);
        const buf = Buffer.from(await audioRes.arrayBuffer());
        const { forceAlign } = await import("@/lib/pipeline/elevenlabs");
        const a = await forceAlign(buf, String(body.text ?? ""), audioRes.headers.get("content-type") ?? "audio/wav");
        return NextResponse.json({
          success: true,
          ms: Date.now() - started,
          bytes: buf.length,
          chars: a?.characters.length ?? 0,
          last: a ? a.character_end_times_seconds[a.character_end_times_seconds.length - 1] : null,
        });
      }
      case "models":
        return NextResponse.json({ success: true, models: await listGoogleModels() });
      default:
        return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
  }
}
