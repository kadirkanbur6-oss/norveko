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
export const maxDuration = 300; // script runs: research + plan + draft + editor + fact check + judge

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function readJson<T>(path: string): Promise<T | null> {
  const { data } = await admin().storage.from("videos").download(path);
  if (!data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

async function writeJson(path: string, value: unknown): Promise<string> {
  const db = admin();
  const { error } = await db.storage
    .from("videos")
    .upload(path, Buffer.from(JSON.stringify(value, null, 2)), { contentType: "application/json", upsert: true });
  if (error) throw new Error(`upload failed: ${error.message}`);
  return db.storage.from("videos").getPublicUrl(path).data.publicUrl;
}

type Research = { brief: string; sources: Array<{ title: string; url: string }> };

/** Research for a lab run; eval topics are cached so every model sees the same brief. */
async function labResearch(idea: string, language: string, cacheId?: string, refresh = false): Promise<Research> {
  const path = cacheId ? `lab/eval/research/${cacheId.replace(/[^a-z0-9-]/gi, "")}.json` : null;
  if (path && !refresh) {
    const hit = await readJson<Research>(path);
    if (hit?.brief) return hit;
  }
  const { researchTopic } = await import("@/lib/pipeline/openai");
  const { RESEARCH_MODEL } = await import("@/lib/pipeline/llm");
  const r = await researchTopic({ idea, outputLanguage: language, model: RESEARCH_MODEL });
  const out = { brief: r.brief, sources: r.sources };
  if (path) await writeJson(path, out);
  return out;
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
      // Presenter debugging: submit a job's presenter audio + portrait to any fal avatar model.
      case "avatar-submit": {
        const db = admin();
        const { data: job } = await db.from("pipeline_jobs").select("id, user_id, options").eq("id", String(body.jobId ?? "")).eq("user_id", user.id).maybeSingle();
        if (!job) return NextResponse.json({ success: false, error: "job not found" }, { status: 404 });
        const { readCast } = await import("@/lib/characters/characters");
        const member = readCast((job.options as Record<string, unknown> | null)?.cast)[0];
        if (!member) return NextResponse.json({ success: false, error: "no cast" }, { status: 400 });
        const { data: signed } = await db.storage.from("characters").createSignedUrl(member.refs[0], 3600);
        const slot = Number(body.slot ?? 1);
        const ext = String(body.ext ?? "wav");
        const audioUrl = db.storage.from("videos").getPublicUrl(`${job.user_id}/${job.id}/presenter-${slot}.${ext}`).data.publicUrl;
        const model = String(body.model ?? "fal-ai/kling-video/ai-avatar/v2/pro");
        const input = { image_url: signed?.signedUrl, audio_url: audioUrl, prompt: String(body.prompt ?? "The person speaks to the camera."), ...((body.extra as Record<string, unknown>) ?? {}) };
        const res = await fetch(`https://queue.fal.run/${model}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Key ${process.env.FAL_KEY}` },
          body: JSON.stringify(input),
        });
        return NextResponse.json({ success: res.ok, status: res.status, body: (await res.text()).slice(0, 1500), audioUrl });
      }
      // Any fal queue model with a raw input (model experiments).
      case "fal-submit": {
        const model = String(body.model ?? "");
        if (!/^[a-z0-9-]+\/[a-z0-9./-]+$/i.test(model)) return NextResponse.json({ success: false, error: "bad model id" }, { status: 400 });
        let input = (body.input ?? {}) as Record<string, unknown>;
        // Character pictures live in a private bucket: sign them on the way out.
        if (typeof body.characterId === "string") {
          const db = admin();
          const { data: c } = await db.from("characters").select("reference_paths").eq("id", body.characterId).eq("user_id", user.id).maybeSingle();
          const path = (c?.reference_paths as string[] | undefined)?.[0];
          if (path) {
            const { data: signed } = await db.storage.from("characters").createSignedUrl(path, 3600);
            input = { ...input, image_url: signed?.signedUrl };
          }
        }
        const res = await fetch(`https://queue.fal.run/${model}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Key ${process.env.FAL_KEY}` },
          body: JSON.stringify(input),
        });
        return NextResponse.json({ success: res.ok, status: res.status, body: (await res.text()).slice(0, 2000) });
      }
      // One-off (3 Nov 2026, Kadir chose this over Supabase Pro): move final MP4s that still live
      // in the Supabase "videos" bucket to R2, point jobs/projects at the R2 copy, then delete the
      // Supabase copy. Idempotent and batched; { dryRun: true } only lists.
      case "migrate-finals": {
        const db = admin();
        const r2 = await import("@/lib/storage/r2");
        if (!r2.r2Configured()) return NextResponse.json({ success: false, error: "R2 not configured" }, { status: 400 });
        const limit = Math.min(10, Math.max(1, Number(body.limit) || 4));
        const found: Array<{ path: string; size: number }> = [];
        const { data: users } = await db.storage.from("videos").list("", { limit: 1000 });
        for (const u of users ?? []) {
          if (u.id || !/^[0-9a-f-]{36}$/.test(u.name)) continue; // folders only (user ids)
          const { data: jobs } = await db.storage.from("videos").list(u.name, { limit: 1000 });
          for (const j of jobs ?? []) {
            if (j.id || !/^[0-9a-f-]{36}$/.test(j.name)) continue;
            const { data: files } = await db.storage.from("videos").list(`${u.name}/${j.name}`, { limit: 1000 });
            for (const f of files ?? []) {
              // kind "clips" (4 Nov 2026): every scene clip (slot/presenter MP4s) too, not only finals.
              if (body.kind === "clips" ? /\.mp4$/i.test(f.name) : /^final(-v\d+)?\.mp4$/.test(f.name)) {
                found.push({ path: `${u.name}/${j.name}/${f.name}`, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
              }
            }
          }
        }
        const totalMb = Math.round(found.reduce((n, f) => n + f.size, 0) / 1048576);
        if (body.dryRun) return NextResponse.json({ success: true, files: found.length, totalMb, sample: found.slice(0, 5) });

        const supabaseBase = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "");
        const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://norveko.app").replace(/\/+$/, "");
        const moved: string[] = [];
        const failed: Array<{ path: string; error: string }> = [];
        for (const f of found.slice(0, limit)) {
          try {
            const oldUrls = [`${supabaseBase}/storage/v1/object/public/videos/${f.path}`, `${site}/media/videos/${f.path}`];
            await r2.copyUrlToR2(oldUrls[0], f.path, "video/mp4");
            const newUrl = r2.r2PublicUrl(f.path);
            const swapUrls = (text: string) => oldUrls.reduce((t, u) => t.split(u).join(newUrl), text);
            const jobId = f.path.split("/")[1];
            const { data: job } = await db.from("pipeline_jobs").select("id, steps").eq("id", jobId).maybeSingle();
            if (job) {
              const before = JSON.stringify(job.steps ?? {});
              const after = swapUrls(before);
              if (after !== before) {
                const steps = JSON.parse(after);
                if (steps.render && !steps.render.hosted_by) steps.render.hosted_by = "r2";
                await db.from("pipeline_jobs").update({ steps }).eq("id", jobId);
              }
              const projectId = (job.steps as { result?: { project_id?: string } } | null)?.result?.project_id;
              if (projectId) {
                const { data: project } = await db.from("projects").select("content").eq("id", projectId).maybeSingle();
                if (project) {
                  const pb = JSON.stringify(project.content ?? {});
                  const pa = swapUrls(pb);
                  if (pa !== pb) await db.from("projects").update({ content: JSON.parse(pa) }).eq("id", projectId);
                }
              }
            }
            // Only after the R2 copy and the new links are in place.
            const { error: rmErr } = await db.storage.from("videos").remove([f.path]);
            if (rmErr) throw new Error(`copied, but the old file could not be removed: ${rmErr.message}`);
            moved.push(f.path);
          } catch (err) {
            failed.push({ path: f.path, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return NextResponse.json({ success: true, moved, failed, remaining: found.length - moved.length, totalMbBefore: totalMb });
      }
      // Source clips of finished/failed swaps are never read again: free their space (4 Nov 2026).
      case "cleanup-swap-sources": {
        const db = admin();
        const { data: rows } = await db.from("swap_jobs").select("id, source_path, kind, status").neq("status", "running").eq("kind", "swap").limit(200);
        const paths = (rows ?? []).map((r) => r.source_path as string).filter((p) => /\/swap\/src-/.test(p));
        if (body.dryRun || !paths.length) return NextResponse.json({ success: true, files: paths.length });
        const { error } = await db.storage.from("videos").remove(paths);
        return NextResponse.json({ success: !error, removed: error ? 0 : paths.length, error: error?.message });
      }
      // Owner top-up for showcase / ad renders (4 Nov 2026, Kadir approved): only to the caller's own beta account.
      case "self-credits": {
        const amount = Math.round(Number(body.amount));
        if (!Number.isFinite(amount) || amount < 1 || amount > 2000) return NextResponse.json({ success: false, error: "1–2000 credits." }, { status: 400 });
        const { isWatermarkExempt } = await import("@/lib/pipeline/watermark-policy");
        if (!isWatermarkExempt(user.id)) return NextResponse.json({ success: false, error: "Beta accounts only." }, { status: 403 });
        const { error } = await admin().rpc("add_credits", { p_user_id: user.id, p_amount: amount, p_type: "bonus", p_reason: String(body.reason ?? "Owner top-up for showcase videos").slice(0, 120) });
        return NextResponse.json({ success: !error, error: error?.message });
      }
      // Stock clips for a showcase character swap (4 Nov 2026): search, then copy one into the swap uploads.
      case "stock-search": {
        const { searchStockClips } = await import("@/lib/pipeline/pexels");
        const clips = await searchStockClips(String(body.query ?? ""), body.orientation === "horizontal" ? "horizontal" : "vertical", 12);
        return NextResponse.json({ success: true, clips });
      }
      case "stock-swap-source": {
        const url = String(body.url ?? "");
        // Pixabay / Pexels clips, or a clip the lab rendered into our own bucket (5 Nov 2026: AI-made swap sources).
        const own = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/videos/lab/`;
        if (!/^https:\/\/([a-z0-9-]+\.)*(pixabay\.com|pexels\.com)\//i.test(url) && !url.startsWith(own)) return NextResponse.json({ success: false, error: "Only Pixabay / Pexels clips or lab renders." }, { status: 400 });
        const res = await fetch(url);
        if (!res.ok) return NextResponse.json({ success: false, error: `Download failed (${res.status}).` }, { status: 502 });
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > 50 * 1024 * 1024) return NextResponse.json({ success: false, error: "Clip is over 50 MB." }, { status: 400 });
        const path = `${user.id}/swap/src-${crypto.randomUUID()}.mp4`;
        const { error } = await admin().storage.from("videos").upload(path, bytes, { contentType: "video/mp4" });
        if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, path, mb: Math.round(bytes.length / 1e5) / 10 });
      }
      // Delete the lab's own test clips (videos/lab/**.mp4) — Kadir said yes on 5 Nov 2026.
      // Only MP4s under lab/: the eval research cache, images and every user's files stay.
      case "cleanup-lab-videos": {
        const db = admin();
        const found: Array<{ path: string; size: number }> = [];
        const walk = async (prefix: string, depth: number) => {
          const { data } = await db.storage.from("videos").list(prefix, { limit: 1000 });
          for (const f of data ?? []) {
            const path = `${prefix}/${f.name}`;
            if (!f.id) {
              if (depth < 3) await walk(path, depth + 1);
            } else if (/\.mp4$/i.test(f.name)) found.push({ path, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
          }
        };
        await walk("lab", 0);
        const mb = Math.round(found.reduce((n, f) => n + f.size, 0) / 1048576);
        if (body.dryRun) return NextResponse.json({ success: true, files: found.length, mb, paths: found.map((f) => f.path) });
        const removed: string[] = [];
        for (let i = 0; i < found.length; i += 50) {
          const batch = found.slice(i, i + 50).map((f) => f.path);
          const { error } = await db.storage.from("videos").remove(batch);
          if (!error) removed.push(...batch);
        }
        return NextResponse.json({ success: true, removed: removed.length, mb, failed: found.length - removed.length });
      }
      // Keep a generated fal clip for the site (6 Nov 2026: landing hero loop). fal CDN URLs only,
      // copied to R2 under site/ and served by /media/videos/r2/site/<name>.mp4.
      case "store-url": {
        const url = String(body.url ?? "");
        if (!/^https:\/\/([a-z0-9-]+\.)*fal\.(media|run)\//.test(url)) return NextResponse.json({ success: false, error: "fal media urls only" }, { status: 400 });
        const name = String(body.name ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 60);
        if (!name) return NextResponse.json({ success: false, error: "name required" }, { status: 400 });
        const { copyUrlToR2, r2PublicUrl } = await import("@/lib/storage/r2");
        const key = `site/${name}.mp4`;
        const bytes = await copyUrlToR2(url, key, "video/mp4");
        return NextResponse.json({ success: true, key, bytes, url: r2PublicUrl(key) });
      }
      // Shrink a site clip (the 10 s hero loop came back at 40 MB): Shotstack re-encodes it muted
      // at 1080p; then transcode-finish copies the result to R2 under site/<name>.mp4.
      case "transcode-submit": {
        const url = String(body.url ?? "");
        if (!/^https:\/\/([a-z0-9-]+\.)*fal\.(media|run)\//.test(url)) return NextResponse.json({ success: false, error: "fal media urls only" }, { status: 400 });
        const seconds = Math.min(20, Math.max(1, Number(body.seconds) || 10));
        const { submitRender } = await import("@/lib/pipeline/shotstack");
        const renderId = await submitRender({
          timeline: { tracks: [{ clips: [{ asset: { type: "video", src: url, volume: 0 }, start: 0, length: seconds, fit: "cover" }] }] },
          output: { format: "mp4", resolution: "1080", fps: 30, quality: String(body.quality ?? "medium") },
        });
        return NextResponse.json({ success: true, renderId });
      }
      case "transcode-finish": {
        const { getRender } = await import("@/lib/pipeline/shotstack");
        const r = await getRender(String(body.renderId ?? ""));
        if (r.status !== "done" || !r.url) return NextResponse.json({ success: true, done: false, status: r.status, error: r.error ?? null });
        const name = String(body.name ?? "").replace(/[^a-z0-9-]/gi, "").slice(0, 60);
        if (!name) return NextResponse.json({ success: false, error: "name required" }, { status: 400 });
        const { copyUrlToR2, r2PublicUrl } = await import("@/lib/storage/r2");
        const key = `site/${name}.mp4`;
        const bytes = await copyUrlToR2(r.url, key, "video/mp4");
        return NextResponse.json({ success: true, done: true, key, bytes, url: r2PublicUrl(key) });
      }
      // Can provider_usage take a skit/talk/swap row? (6 Nov 2026: none showed up.) Inserts one
      // test row for a non-pipeline job id, reports the database error if any, deletes it again.
      case "usage-probe": {
        const db = admin();
        const jobId = crypto.randomUUID();
        const { error } = await db.from("provider_usage").insert({
          job_id: jobId, user_id: user.id, step: "talk", provider: "fal", model: "probe", unit: "seconds",
          quantity: 1, estimated_cost_usd: 0, duration_ms: 0, status: "ok",
        });
        if (!error) await db.from("provider_usage").delete().eq("job_id", jobId);
        const { count } = await db.from("provider_usage").select("id", { count: "exact", head: true }).in("step", ["skit", "talk", "swap"]);
        return NextResponse.json({ success: true, insertError: error ? { code: error.code, message: error.message } : null, creativeRows: count ?? 0 });
      }
      // Where Supabase Storage space goes (5 Nov 2026: free plan 1 GB full). Read-only.
      case "storage-report": {
        const db = admin();
        const { data: buckets } = await db.storage.listBuckets();
        const groups = new Map<string, { files: number; mb: number }>();
        let listed = 0;
        const walk = async (bucket: string, prefix: string, depth: number) => {
          for (let offset = 0; offset < 20000 && listed < 60000; offset += 1000) {
            const { data } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
            if (!data?.length) break;
            for (const f of data) {
              const path = prefix ? `${prefix}/${f.name}` : f.name;
              if (!f.id) {
                if (depth < 4) await walk(bucket, path, depth + 1);
                continue;
              }
              listed++;
              const size = Number((f.metadata as { size?: number } | null)?.size ?? 0);
              // Group: bucket / first folder kind (user ids collapsed) / file kind.
              const parts = path.split("/");
              const top = /^[0-9a-f-]{36}$/.test(parts[0]) ? "<user>" : parts[0];
              const second = parts.length > 2 ? (/^[0-9a-f-]{36}$/.test(parts[1]) ? "<job>" : parts[1].replace(/-[0-9a-f-]{36}$/, "-<id>")) : "";
              const ext = (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
              const key = [bucket, top, second, ext].filter(Boolean).join(" / ");
              const g = groups.get(key) ?? { files: 0, mb: 0 };
              g.files++;
              g.mb += size / 1048576;
              groups.set(key, g);
            }
            if (data.length < 1000) break;
          }
        };
        for (const b of buckets ?? []) await walk(b.name, "", 0);
        const rows = [...groups.entries()].map(([k, v]) => ({ group: k, files: v.files, mb: Math.round(v.mb * 10) / 10 })).sort((a, b) => b.mb - a.mb);
        return NextResponse.json({ success: true, totalMb: Math.round(rows.reduce((n, r) => n + r.mb, 0)), files: listed, rows: rows.slice(0, 40) });
      }
      // Owner's own failed skit back to work from its current phase (keeps the clips already made),
      // charging its credits again since the failure refunded them (5 Nov 2026: empty voice track bug).
      case "revive-skit": {
        const db = admin();
        const { data: row } = await db.from("skit_jobs").select("*").eq("id", String(body.id ?? "")).eq("user_id", user.id).eq("status", "failed").maybeSingle();
        if (!row) return NextResponse.json({ success: false, error: "No failed skit of yours with that id." }, { status: 404 });
        if (row.refunded) {
          const { data: paid } = await db.rpc("deduct_credits", { p_user_id: row.billed_to ?? row.user_id, p_amount: row.credits, p_reason: "Skit retried (lab)" });
          if (!paid) return NextResponse.json({ success: false, error: `Not enough credits (${row.credits}).` }, { status: 402 });
        }
        const plan = { ...(row.plan as Record<string, unknown>), tries: 0 };
        const { error } = await db.from("skit_jobs").update({ status: "running", error: null, refunded: false, lease_until: null, plan, updated_at: new Date().toISOString() }).eq("id", row.id);
        return NextResponse.json({ success: !error, error: error?.message, phase: row.phase });
      }
      // Older skit / talk / swap projects were saved with style "Cinematic": relabel them (4 Nov 2026).
      case "relabel-creative-projects": {
        const db = admin();
        const out: Record<string, number> = {};
        for (const [key, label] of [["skit", "Skit"], ["talk", "Talking character"], ["swap", "Character swap"]] as const) {
          const { data, error } = await db
            .from("projects")
            .update({ style: label })
            .not(`content->${key}`, "is", null)
            .neq("style", label)
            .select("id");
          if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
          out[label] = data?.length ?? 0;
        }
        return NextResponse.json({ success: true, relabeled: out });
      }
      // Prices of fal endpoints (unit + unit price) from fal's pricing API.
      case "fal-price": {
        const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x): x is string => typeof x === "string" && /^[a-z0-9-]+\/[a-z0-9./-]+$/i.test(x)).slice(0, 20);
        const qs = ids.map((id) => `endpoint_id=${encodeURIComponent(id)}`).join("&");
        const res = await fetch(`https://api.fal.ai/v1/models/pricing?${qs}`, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
        return NextResponse.json({ success: res.ok, status: res.status, body: (await res.text()).slice(0, 4000) });
      }
      // Can Shotstack / fal read files through our R2 redirect URL? (4 Nov 2026)
      case "r2-media-test": {
        const src = String(body.imageUrl ?? "");
        const img = Buffer.from(await (await fetch(src)).arrayBuffer());
        const { storeMedia } = await import("@/lib/storage/media");
        const url = await storeMedia(admin(), `lab/r2test-${Date.now()}.jpg`, img, "image/jpeg");
        const { submitRender } = await import("@/lib/pipeline/shotstack");
        const renderId = await submitRender({
          timeline: { tracks: [{ clips: [{ asset: { type: "image", src: url }, start: 0, length: 2, fit: "cover" }] }] },
          output: { format: "mp4", size: { width: 540, height: 960 }, fps: 25 },
        });
        return NextResponse.json({ success: true, url, renderId });
      }
      case "shotstack-status": {
        const { getRender } = await import("@/lib/pipeline/shotstack");
        return NextResponse.json({ success: true, render: await getRender(String(body.id ?? "")) });
      }
      // Submit a tiny request to a fal model and return its raw answer (to read a real error).
      case "fal-probe": {
        const model = String(body.model ?? "").replace(/[^a-z0-9/._-]/gi, "");
        if (!model) return NextResponse.json({ success: false, error: "model" }, { status: 400 });
        const res = await fetch(`https://queue.fal.run/${model}`, {
          method: "POST",
          headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(body.input ?? {}),
        });
        return NextResponse.json({ success: res.ok, status: res.status, body: (await res.text()).slice(0, 2000) });
      }
      case "fal-raw": {
        const url = String(body.url ?? "");
        if (!/^https:\/\/queue\.fal\.run\//.test(url)) return NextResponse.json({ success: false, error: "fal queue urls only" }, { status: 400 });
        const res = await fetch(url, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
        return NextResponse.json({ success: res.ok, status: res.status, body: (await res.text()).slice(0, 3000) });
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
      case "text-models": {
        const { listOpenAIModels } = await import("@/lib/lab/script-eval");
        const google = (await listGoogleModels(/^gemini-/i).catch(() => [])) as Array<{ name: string; methods: string[] }>;
        return NextResponse.json({ success: true, openai: await listOpenAIModels(), google: google
            .filter((m) => m.methods.includes("generateContent") && !/image|tts|audio|live|embed|omni|banana|robot/i.test(m.name))
            .map((m) => m.name) });
      }
      case "eval-topics": {
        const { EVAL_TOPICS, JUDGE_MODEL } = await import("@/lib/lab/script-eval");
        const { SCRIPT_MODEL } = await import("@/lib/pipeline/llm");
        const { SCRIPT_PROMPT_VERSION } = await import("@/lib/pipeline/openai");
        return NextResponse.json({ success: true, topics: EVAL_TOPICS, judge: JUDGE_MODEL, current: SCRIPT_MODEL, promptVersion: SCRIPT_PROMPT_VERSION });
      }
      case "research": {
        const r = await labResearch(String(body.idea ?? ""), String(body.language ?? "English"), typeof body.cacheId === "string" ? body.cacheId : undefined, body.refresh === true);
        return NextResponse.json({ success: true, ...r, ms: Date.now() - started });
      }
      case "script": {
        // One script-writer run: optional research → full generateScript → optional judge.
        const idea = String(body.idea ?? "").trim();
        const language = String(body.language ?? "English");
        const style = String(body.style ?? "Documentary");
        const duration = String(body.duration ?? "60 seconds");
        const { SCRIPT_MODEL } = await import("@/lib/pipeline/llm");
        const model = String(body.model ?? SCRIPT_MODEL);
        let research: string | null = typeof body.research === "string" && body.research.trim() ? body.research : null;
        if (!research && body.withResearch === true) {
          research = (await labResearch(idea, language, typeof body.cacheId === "string" ? body.cacheId : undefined)).brief;
        }
        const { generateScript } = await import("@/lib/pipeline/openai");
        const { narrationWordCount, wordRange } = await import("@/lib/pipeline/narration");
        const { languageCode } = await import("@/lib/pipeline/options");
        const { estimateCostUsd, splitProvider } = await import("@/lib/pipeline/usage");
        const t0 = Date.now();
        const r = await generateScript({
          idea,
          platform: "YouTube Shorts",
          style,
          duration,
          outputLanguage: language,
          model,
          orientation: "vertical",
          research,
          notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 500) : null,
        });
        const writeMs = Date.now() - t0;
        const range = wordRange(duration, languageCode(language));
        const words = narrationWordCount(r.hook, r.script);
        const { provider, model: m } = splitProvider(r.usageKey ?? `openai:${model}`);
        const costUsd = estimateCostUsd(provider, m, { inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens });
        let judge = null;
        if (body.judge === true) {
          const { judgeScript } = await import("@/lib/lab/script-eval");
          judge = (await judgeScript({ idea, language, hook: r.hook, script: r.script, research, wordCount: words, range })).scores;
        }
        return NextResponse.json({
          success: true,
          ms: Date.now() - started,
          writeMs,
          model: r.usageKey,
          promptVersion: r.promptVersion,
          hook: r.hook,
          script: r.script,
          words,
          range,
          plan: r.plan,
          factCheck: r.factCheck,
          usage: r.usage,
          costUsd,
          research,
          judge,
        });
      }
      case "usage-report": {
        // Read-only: real provider cost per job/step (provider_usage) to price credits.
        const db = admin();
        const since = String(body.since ?? new Date(Date.now() - 2 * 86400_000).toISOString());
        const { data: rows, error } = await db
          .from("provider_usage")
          .select("job_id, step, provider, model, unit, quantity, input_tokens, output_tokens, estimated_cost_usd, status, created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(5000);
        if (error) throw new Error(error.message);
        const ids = [...new Set((rows ?? []).map((r) => r.job_id))];
        const { data: jobs } = ids.length
          ? await db.from("pipeline_jobs").select("id, idea, status, credits_charged, credits_refunded, output_language, options, steps").in("id", ids)
          : { data: [] as Array<Record<string, unknown>> };
        const out = (jobs ?? []).map((j) => {
          const steps = (j.steps ?? {}) as Record<string, Record<string, unknown>>;
          const plan = steps.video?.plan as Record<string, unknown> | undefined;
          const usage = (rows ?? []).filter((r) => r.job_id === j.id);
          return {
            id: j.id,
            idea: String(j.idea).slice(0, 60),
            status: j.status,
            lang: j.output_language,
            charged: j.credits_charged,
            refunded: j.credits_refunded,
            footage: plan?.footage,
            clipMode: plan?.clipMode,
            seconds: steps.voiceover?.duration_seconds,
            calls: usage.map((u) => ({
              step: u.step,
              model: `${u.provider}:${u.model}`,
              unit: u.unit,
              qty: u.quantity,
              inTok: u.input_tokens,
              outTok: u.output_tokens,
              usd: Number(u.estimated_cost_usd),
              ok: u.status === "ok",
            })),
          };
        });
        return NextResponse.json({ success: true, since, jobs: out });
      }
      case "rerender": {
        // Re-render a finished full video with a different background track
        // (and/or subtitle style). Only the render step runs again, no charge.
        const { queueRerender } = await import("@/lib/pipeline/rerender");
        const r = await queueRerender(admin(), String(body.jobId ?? ""), user.id, {
          musicId: typeof body.musicId === "string" ? body.musicId : null,
          captionStyle: typeof body.captionStyle === "string" ? body.captionStyle : null,
          reason: "lab",
        });
        return NextResponse.json({ success: true, version: r.version });
      }
      case "style-previews": {
        // One sample still per visual style for the /chat picker:
        // videos/previews/styles/<id>.jpg (3:4, 480 px). ?only=<id> regenerates one.
        const { VISUAL_STYLES, stillPrompt } = await import("@/lib/pipeline/visual-styles");
        const sharp = (await import("sharp")).default;
        const scene =
          typeof body.scene === "string" && body.scene.trim()
            ? body.scene.trim()
            : "A lone lighthouse on a rocky cliff above a stormy sea at dusk, its beam cutting through the mist, a small figure with a lantern on the path below.";
        const only = typeof body.only === "string" ? body.only : null;
        const model = process.env.GEMINI_SCENE_IMAGE_MODEL || "gemini-nano-banana-2.1";
        const results: Array<{ id: string; ok: boolean; error?: string }> = [];
        await Promise.all(
          VISUAL_STYLES.filter((s) => !only || s.id === only).map(async (style) => {
            try {
              const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY ?? "" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: stillPrompt(scene, style.id, "3:4") }] }],
                  generationConfig: { imageConfig: { aspectRatio: "3:4" } },
                }),
                signal: AbortSignal.timeout(120_000),
              });
              if (!res.ok) throw new Error(`Gemini ${res.status}`);
              const data = await res.json();
              const part = (data?.candidates?.[0]?.content?.parts ?? []).find(
                (p: { inlineData?: { data?: string }; inline_data?: { data?: string } }) => (p.inlineData ?? p.inline_data)?.data
              );
              const b64 = (part?.inlineData ?? part?.inline_data)?.data;
              if (!b64) throw new Error("no image");
              const jpg = await sharp(Buffer.from(b64, "base64")).resize(480).jpeg({ quality: 82 }).toBuffer();
              const { error } = await admin()
                .storage.from("videos")
                .upload(`previews/styles/${style.id}.jpg`, jpg, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
              if (error) throw new Error(error.message);
              results.push({ id: style.id, ok: true });
            } catch (err) {
              results.push({ id: style.id, ok: false, error: err instanceof Error ? err.message : String(err) });
            }
          })
        );
        return NextResponse.json({ success: true, results, ms: Date.now() - started });
      }
      case "music-list": {
        const { MUSIC_TRACKS } = await import("@/lib/pipeline/music");
        return NextResponse.json({ success: true, tracks: MUSIC_TRACKS });
      }
      case "music-catalog": {
        // Kevin MacLeod's own catalogue metadata (feel / genre / length per piece).
        const url = String(body.url ?? "https://incompetech.com/music/royalty-free/pieces.json");
        if (!url.startsWith("https://incompetech.com/")) throw new Error("incompetech.com only");
        const res = await fetch(url, { cache: "no-store" });
        const text = await res.text();
        let pieces: Array<Record<string, unknown>> = [];
        try {
          const j = JSON.parse(text);
          pieces = Array.isArray(j) ? j : Array.isArray(j?.pieces) ? j.pieces : [];
        } catch {
          return NextResponse.json({ success: false, status: res.status, error: "not JSON", head: text.slice(0, 400) });
        }
        const want = Array.isArray(body.titles) ? (body.titles as string[]).map((t) => t.toLowerCase()) : null;
        const feel = typeof body.feel === "string" ? body.feel.toLowerCase() : null;
        const rows = pieces.filter((p) => {
          const title = String(p.title ?? "").toLowerCase();
          if (want && !want.includes(title)) return false;
          if (feel && !JSON.stringify(p.feel ?? "").toLowerCase().includes(feel)) return false;
          return true;
        });
        return NextResponse.json({ success: true, total: pieces.length, keys: Object.keys(pieces[0] ?? {}), rows: rows.slice(0, 300) });
      }
      case "music-analyze": {
        const { analyzeTrack } = await import("@/lib/lab/music-analyze");
        return NextResponse.json({ success: true, result: await analyzeTrack(String(body.title ?? "")), ms: Date.now() - started });
      }
      case "save-eval": {
        const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${String(body.model ?? "model").replace(/[^a-z0-9.-]/gi, "_")}`;
        const url = await writeJson(`lab/eval/runs/${id}.json`, { savedAt: new Date().toISOString(), ...(body.result as object) });
        return NextResponse.json({ success: true, url, id });
      }
      case "list-evals": {
        const db = admin();
        const { data } = await db.storage.from("videos").list("lab/eval/runs", { limit: 100, sortBy: { column: "name", order: "desc" } });
        const runs = [];
        for (const f of (data ?? []).slice(0, 30)) {
          const j = await readJson<Record<string, unknown>>(`lab/eval/runs/${f.name}`);
          if (j) runs.push({ id: f.name.replace(/\.json$/, ""), model: j.model, promptVersion: j.promptVersion, average: j.average, count: j.count, savedAt: j.savedAt, costUsd: j.costUsd });
        }
        return NextResponse.json({ success: true, runs });
      }
      default:
        return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
  }
}
