/* eslint-disable @typescript-eslint/no-explicit-any -- test double for the Supabase query builder */
// lib/pipeline/runner.test.ts
// Run with: npm run test:pipeline
// (= npx tsx --conditions react-server --test lib/pipeline/runner.test.ts;
// the react-server condition turns `import "server-only"` into a no-op.)
// Exercises the step loop against an in-memory Supabase stand-in.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineRunner,
  STEP_TIMEOUT_MS,
  KICK_RETRY_MS,
  type JobRow,
} from "./runner";
import type { UsageRecord } from "./usage";
import { initialStepsState, totalPipelineCredits } from "./steps";

type Row = Record<string, any>;

function makeDb() {
  const projects: Row[] = [];
  const rows = new Map<string, Row>();
  const rpc: Array<[string, Row]> = [];
  let seq = 0;

  function matches(row: Row, filters: Array<[string, any]>) {
    return filters.every(([k, v]) => {
      const m = k.match(/^steps->(\w+)->>status$/);
      if (m) return (row.steps?.[m[1]]?.status ?? null) === v;
      if (k === "__is_null") return row[v] == null;
      if (k === "__or") {
        // Minimal PostgREST `or()` support: "col.is.null,col.eq.0"
        return String(v)
          .split(",")
          .some((clause) => {
            const [col, op, val] = clause.split(".");
            if (op === "is" && val === "null") return row[col] == null;
            if (op === "eq") return String(row[col]) === val;
            return false;
          });
      }
      return row[k] === v;
    });
  }

  function from(name: string) {
    const filters: Array<[string, any]> = [];
    let patch: Row | null = null;
    let insertRow: Row | null = null;
    const run = () => {
      if (name === "projects") {
        if (insertRow) projects.push(insertRow);
        return { data: [{ id: `proj_${++seq}` }], error: null };
      }
      if (insertRow) {
        const id = `job_${++seq}`;
        rows.set(id, {
          id,
          created_at: new Date(0).toISOString(),
          credits_refunded: 0, // DB default
          error: null,
          ...insertRow,
        });
        return { data: [{ id }], error: null };
      }
      const hits = [...rows.values()].filter((r) => matches(r, filters));
      if (patch) hits.forEach((r) => Object.assign(r, structuredClone(patch)));
      return { data: hits.map((r) => structuredClone(r)), error: null };
    };
    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => (filters.push([k, v]), q),
      is: (k: string) => (filters.push(["__is_null", k]), q),
      or: (expr: string) => (filters.push(["__or", expr]), q),
      limit: () => q,
      update: (p: Row) => ((patch = p), q),
      insert: (r: Row) => ((insertRow = r), q),
      maybeSingle: async () => {
        const r = run();
        return { data: r.data[0] ?? null, error: null };
      },
      single: async () => {
        const r = run();
        return { data: r.data[0] ?? null, error: r.data[0] ? null : { message: "no row" } };
      },
      then: (resolve: any) => resolve(run()),
    };
    return q;
  }

  const db = {
    from,
    rpc: async (fn: string, args: Row) => (rpc.push([fn, args]), { data: true, error: null }),
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn/${path}` } }),
        // Music cache: pretend every track is already mirrored (no network in tests).
        list: async (_dir: string, opts: { search?: string }) => ({ data: [{ name: opts.search ?? "" }], error: null }),
      }),
    },
  };

  function seedJob(withVoice: boolean, overrides: Row = {}) {
    const steps: Row = {
      script: { status: "pending", provider: "openai:gpt-5-mini", error: null, queued_at: new Date(0).toISOString() },
      thumbnail: { status: "pending", provider: "gemini", error: null },
    };
    if (withVoice) steps.voiceover = { status: "pending", provider: "el", error: null, voice_id: "v1", subtitles: true };
    const id = `job_${++seq}`;
    rows.set(id, {
      id,
      user_id: "u1",
      idea: "Pompeii",
      platform: "YouTube Shorts",
      style: "Mystery",
      duration: "60 seconds",
      output_language: "English",
      status: "running",
      current_step: "script",
      steps,
      credits_charged: withVoice ? 30 : 15,
      credits_refunded: 0, // DB default; the refund guard must treat 0 as "not refunded"
      error: null,
      created_at: new Date(0).toISOString(),
      ...overrides,
    });
    return id;
  }

  return { db: db as any, rows, rpc, seedJob, projects };
}

function makeRunner(
  opts: { failAt?: string; now?: () => number; klingStatuses?: Record<string, "processing" | "succeed" | "failed"> } = {}
) {
  const { db, rows, rpc, seedJob, projects } = makeDb();
  const kicked: string[] = [];
  const calls: string[] = [];
  const usage: UsageRecord[] = [];
  const klingStatuses = opts.klingStatuses ?? {};
  const renderStatus: { value: "queued" | "rendering" | "done" | "failed" } = { value: "rendering" };
  let lastEdit: Record<string, unknown> | null = null;
  let lastScriptParams: Parameters<typeof createPipelineRunner>[0]["providers"]["generateScript"] extends (p: infer P) => unknown ? P | null : never = null;
  let taskSeq = 0;
  const runner = createPipelineRunner({
    db,
    providers: {
      researchTopic: async ({ idea }) => {
        calls.push("research");
        if (opts.failAt === "research") throw new Error("search down");
        return {
          brief: `Facts about ${idea}: happened on 2026-10-26.`,
          sources: [{ title: "Source A", url: "https://example.com/a" }],
          usage: { inputTokens: 500, outputTokens: 200 },
        };
      },
      generateScript: async (p) => {
        lastScriptParams = p;
        calls.push("script");
        if (opts.failAt === "script") throw new Error("openai down");
        return {
          hook: "h", script: "s",
          scenes: [1, 2, 3].map((n) => ({ sceneNumber: n, description: `d${n}`, videoPrompt: `prompt ${n}` })),
          titles: [], description: "d", tags: [],
          thumbnailIdea: "idea", thumbnailPrompt: "p",
          usage: { inputTokens: 1200, outputTokens: 800 },
        };
      },
      reviseNarration: async ({ script, range }) => {
        calls.push(`revise@${range.target}`);
        // Pretend the editor trimmed/expanded to the asked word count.
        return { hook: "h", script: Array.from({ length: range.target }, (_, i) => `w${i}`).join(" ") || script };
      },
      generateSpeech: async (_text, _voice, options) => {
        calls.push(options?.speed ? `voiceover@${options.speed}` : "voiceover");
        if (opts.failAt === "voiceover") throw new Error("eleven down");
        // "Hi there." with one character every 100 ms (0.9 s of speech).
        const chars = "Hi there.".split("");
        const step = 0.1 / (options?.speed ?? 1);
        return {
          audio: Buffer.from("mp3"),
          alignment: {
            characters: chars,
            character_start_times_seconds: chars.map((_, i) => i * step),
            character_end_times_seconds: chars.map((_, i) => (i + 1) * step),
          },
          contentType: "audio/mpeg",
          ext: "mp3" as const,
          usageKey: "elevenlabs:eleven_multilingual_v2",
        };
      },
      generateThumbnail: async () => {
        calls.push("thumbnail");
        if (opts.failAt === "thumbnail") throw new Error("gemini down");
        return { imageUrl: "https://cdn/t.png", storagePath: "t.png" };
      },
      submitTextToVideo: async ({ prompt }) => {
        calls.push(`submit:${prompt}`);
        if (opts.failAt === "video-submit") throw new Error("kling submit down");
        return `task_${++taskSeq}`;
      },
      getTextToVideoTask: async (taskId) => {
        calls.push(`poll:${taskId}`);
        const status = klingStatuses[taskId] ?? "processing";
        return {
          taskId,
          status,
          videoUrl: status === "succeed" ? `https://kling/${taskId}.mp4` : undefined,
          durationSeconds: 5,
          statusMessage: status === "failed" ? "nsfw" : undefined,
        };
      },
      submitImageToVideo: async ({ imageUrl }) => {
        const id = `fal_${++taskSeq}`;
        calls.push(`i2v:${id}:${imageUrl}`);
        return { requestId: id, statusUrl: `https://fal/${id}/status`, responseUrl: `https://fal/${id}` };
      },
      getImageToVideo: async (h) => {
        calls.push(`falpoll:${h.requestId}`);
        const status = klingStatuses[h.requestId] ?? "processing";
        return {
          status: status === "succeed" ? "succeed" : status === "failed" ? "failed" : "processing",
          videoUrl: status === "succeed" ? `https://fal/${h.requestId}.mp4` : undefined,
          durationSeconds: 5,
          statusMessage: status === "failed" ? "fal error" : undefined,
        };
      },
      downloadVideo: async () => Buffer.from("mp4"),
      generateSceneImage: async (_prompt, _jobId, _userId, sceneNumber) => {
        calls.push(`still:${sceneNumber}`);
        if (opts.failAt === "still") throw new Error("gemini still down");
        return { imageUrl: `https://cdn/still-${sceneNumber}.png`, storagePath: `still-${sceneNumber}.png` };
      },
      submitRender: async (edit) => {
        calls.push("render:submit");
        lastEdit = edit;
        if (opts.failAt === "render-submit") throw new Error("shotstack down");
        return "render_1";
      },
      getRender: async (id) => {
        calls.push(`render:poll:${id}`);
        const status = renderStatus.value;
        return { id, status, url: status === "done" ? "https://shotstack/final.mp4" : undefined, duration: 60 };
      },
      downloadRender: async () => Buffer.from("mp4-final"),
    },
    kick: async (id) => {
      kicked.push(id);
    },
    now: opts.now ?? Date.now,
    recordUsage: async (record) => {
      usage.push(record);
    },
  });
  return { runner, rows, rpc, seedJob, kicked, calls, klingStatuses, usage, renderStatus, projects, edit: () => lastEdit, scriptParams: () => lastScriptParams };
}

function seedVideoJob(seedJob: ReturnType<typeof makeDb>["seedJob"]) {
  return seedJob(false, {
    steps: {
      script: { status: "pending", provider: "openai", error: null, queued_at: new Date(0).toISOString() },
      thumbnail: { status: "pending", provider: "gemini", error: null },
      video: { status: "pending", provider: "kling", error: null },
    },
    credits_charged: 15 + 130 * 5,
  });
}

test("runs steps in order, one per invocation, then finalizes into a project", async () => {
  const { runner, rows, seedJob, calls, rpc } = makeRunner();
  const id = seedJob(true);

  assert.equal(await runner.runNextStep(id), "advanced");
  assert.deepEqual(calls, ["script"]);
  assert.equal(rows.get(id)!.current_step, "voiceover");

  assert.equal(await runner.runNextStep(id), "advanced");
  assert.deepEqual(calls, ["script", "voiceover"]);

  assert.equal(await runner.runNextStep(id), "completed");
  assert.deepEqual(calls, ["script", "voiceover", "thumbnail"]);

  const job = rows.get(id)!;
  assert.equal(job.status, "completed");
  assert.equal(job.current_step, null);
  assert.match(job.steps.result.project_id, /^proj_/);
  assert.equal(job.steps.thumbnail.image_url, "https://cdn/t.png");
  assert.deepEqual(
    job.steps.voiceover.captions,
    [{ start: 0, end: 0.9, text: "Hi there." }],
    "voiceover step stores word-timed caption cues when the add-on is on"
  );
  assert.equal(rpc.length, 0, "no refunds on success");

  assert.equal(await runner.runNextStep(id), "noop", "completed job is a noop");
});

test("without voiceover the voiceover step is skipped", async () => {
  const { runner, seedJob, calls } = makeRunner();
  const id = seedJob(false);
  assert.equal(await runner.runNextStep(id), "advanced");
  assert.equal(await runner.runNextStep(id), "completed");
  assert.deepEqual(calls, ["script", "thumbnail"]);
});

test("a failing step fails the job, refunds only the unfinished steps, keeps the finished work as a project", async () => {
  const { runner, rows, rpc, seedJob } = makeRunner({ failAt: "thumbnail" });
  const id = seedJob(false);
  assert.equal(await runner.runNextStep(id), "advanced");
  assert.equal(await runner.runNextStep(id), "failed");

  const job = rows.get(id)!;
  assert.equal(job.status, "failed");
  assert.equal(job.error, "gemini down");
  assert.equal(job.steps.thumbnail.status, "failed");
  // 15 charged: script (5) completed and is kept, thumbnail (10) refunded.
  assert.equal(job.credits_refunded, 10);
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0][0], "add_credits");
  assert.equal(rpc[0][1].p_amount, 10);
  assert.equal(job.steps.result?.status, "partial");
  assert.match(job.steps.result?.project_id, /^proj_/, "script saved as a project");

  // Any later attempt must not refund again.
  assert.equal(await runner.failJob(id, "again"), false);
  assert.equal(await runner.runNextStep(id), "noop");
  assert.equal(rpc.length, 1);
});

test("a step already claimed as running is not executed twice", async () => {
  const { runner, rows, seedJob, calls } = makeRunner();
  const id = seedJob(false);
  rows.get(id)!.steps.script.status = "running";
  rows.get(id)!.steps.script.started_at = new Date().toISOString();
  assert.equal(await runner.runNextStep(id), "noop");
  assert.deepEqual(calls, []);
});

test("reconcile: times out a dead step with refund, re-kicks a forgotten pending step", async () => {
  const clock = 1_000_000;
  const { runner, rows, rpc, seedJob, kicked } = makeRunner({ now: () => clock });

  // Dead running step
  const dead = seedJob(false);
  rows.get(dead)!.steps.script.status = "running";
  rows.get(dead)!.steps.script.started_at = new Date(clock - STEP_TIMEOUT_MS - 1).toISOString();
  assert.equal(await runner.reconcileJob(rows.get(dead)! as JobRow), "failed");
  assert.equal(rows.get(dead)!.status, "failed");
  assert.equal(rpc.length, 1);

  // Healthy running step: left alone
  const fine = seedJob(false);
  rows.get(fine)!.steps.script.status = "running";
  rows.get(fine)!.steps.script.started_at = new Date(clock - 1000).toISOString();
  assert.equal(await runner.reconcileJob(rows.get(fine)! as JobRow), "ok");

  // Pending step nobody picked up: re-kicked once, then throttled
  const forgotten = seedJob(false);
  rows.get(forgotten)!.steps.script.queued_at = new Date(clock - KICK_RETRY_MS - 1).toISOString();
  assert.equal(await runner.reconcileJob(rows.get(forgotten)! as JobRow), "kicked");
  assert.deepEqual(kicked, [forgotten]);
  assert.equal(await runner.reconcileJob(rows.get(forgotten)! as JobRow), "ok", "throttled right after a kick");

  // Cron sweep sees the remaining running jobs
  const summary = await runner.reapStuckJobs();
  assert.equal(summary.checked, 2);
  assert.equal(summary.failed, 0);
});

test("video step: submits one task per scene, refunds unused clips, polls until stored, merges into project", async () => {
  const { runner, rows, rpc, seedJob, calls, klingStatuses } = makeRunner();
  const id = seedVideoJob(seedJob);

  assert.equal(await runner.runNextStep(id), "advanced"); // script
  assert.equal(await runner.runNextStep(id), "advanced"); // thumbnail
  assert.equal(await runner.runNextStep(id), "advanced"); // video: submit only
  assert.deepEqual(calls.filter((c) => c.startsWith("submit:")), ["submit:prompt 1", "submit:prompt 2", "submit:prompt 3"]);

  let job = rows.get(id)!;
  assert.equal(job.steps.video.status, "running");
  assert.equal(job.steps.video.clips.length, 3);
  // 5 clips charged, 3 scenes -> 2 clips refunded right away
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [260]);

  // Still processing: polling is a noop
  assert.equal(await runner.runNextStep(id), "noop");
  assert.equal(rows.get(id)!.status, "running");

  // Two succeed, one fails -> settled, one more clip refunded, pipeline completes
  klingStatuses.task_1 = "succeed";
  klingStatuses.task_2 = "failed";
  klingStatuses.task_3 = "succeed";
  assert.equal(await runner.runNextStep(id), "completed");

  job = rows.get(id)!;
  assert.equal(job.status, "completed");
  assert.equal(job.steps.video.status, "completed");
  assert.deepEqual(job.steps.video.clips.map((c: any) => c.status), ["succeed", "failed", "succeed"]);
  assert.match(job.steps.video.clips[0].video_url, /^https:\/\/cdn\//);
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [260, 130]);
  assert.equal(job.steps.result.project_id.startsWith("proj_"), true);
});

test("video step: every submit failing fails the job, refunding the clips but keeping the package", async () => {
  const { runner, rows, rpc, seedJob } = makeRunner({ failAt: "video-submit" });
  const id = seedVideoJob(seedJob);
  assert.equal(await runner.runNextStep(id), "advanced");
  assert.equal(await runner.runNextStep(id), "advanced");
  assert.equal(await runner.runNextStep(id), "failed");
  const job = rows.get(id)!;
  assert.equal(job.status, "failed");
  // 665 charged = script 5 + thumbnail 10 (kept) + 5 clips × 130 (refunded)
  assert.equal(job.credits_refunded, 650);
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [650]);
  assert.equal(job.steps.result?.status, "partial");
});

test("reconcile: an in-flight video step is re-kicked for polling, not timed out at 8 minutes", async () => {
  let clock = 1_000_000;
  const { runner, rows, seedJob, kicked, klingStatuses } = makeRunner({ now: () => clock });
  const id = seedVideoJob(seedJob);
  klingStatuses.task_1 = "processing";
  await runner.runNextStep(id);
  await runner.runNextStep(id);
  await runner.runNextStep(id); // submitted at clock

  clock += 10 * 60 * 1000; // 10 min later: would kill a sync step
  assert.equal(await runner.reconcileJob(rows.get(id)! as JobRow), "kicked");
  assert.deepEqual(kicked, [id]);
  assert.equal(rows.get(id)!.status, "running");

  clock += 5 * 1000; // throttled: polled 5s ago
  assert.equal(await runner.reconcileJob(rows.get(id)! as JobRow), "ok");

  clock += 45 * 60 * 1000; // way past the async timeout
  assert.equal(await runner.reconcileJob(rows.get(id)! as JobRow), "failed");
  assert.equal(rows.get(id)!.status, "failed");
});

test("provider usage is logged per step with units and an estimated cost", async () => {
  const { runner, seedJob, usage } = makeRunner();
  const id = seedJob(true);
  await runner.runNextStep(id); // script
  await runner.runNextStep(id); // voiceover
  await runner.runNextStep(id); // thumbnail

  assert.deepEqual(
    usage.map((u) => [u.step, u.provider, u.unit, u.quantity, u.status]),
    [
      ["script", "openai", "tokens", 2000, "ok"],
      ["voiceover", "elevenlabs", "characters", 1, "ok"],
      ["thumbnail", "gemini", "images", 1, "ok"],
    ]
  );
  const script = usage[0];
  assert.equal(script.inputTokens, 1200);
  assert.equal(script.outputTokens, 800);
  // gpt-5-mini list price: 1200 in @ $0.25/M + 800 out @ $2/M
  assert.equal(script.estimatedCostUsd, 0.0019);
  assert.ok(usage.every((u) => u.jobId === id && u.userId === "u1"));
});

test("a failed provider call is logged as failed with zero cost", async () => {
  const { runner, seedJob, usage } = makeRunner({ failAt: "script" });
  const id = seedJob(false);
  assert.equal(await runner.runNextStep(id), "failed");
  assert.equal(usage.length, 1);
  assert.equal(usage[0].status, "failed");
  assert.equal(usage[0].estimatedCostUsd, 0);
  assert.match(usage[0].error ?? "", /openai down/);
});

test("subtitles add-on off: voiceover completes without caption cues", async () => {
  const { runner, rows, seedJob } = makeRunner();
  const id = seedJob(true);
  rows.get(id)!.steps.voiceover.subtitles = false;
  await runner.runNextStep(id); // script
  await runner.runNextStep(id); // voiceover
  const job = rows.get(id)!;
  assert.equal(job.steps.voiceover.status, "completed");
  assert.equal(job.steps.voiceover.captions, undefined);
});

function seedFullVideoJob(
  seedJob: ReturnType<typeof makeDb>["seedJob"],
  footage: "hybrid" | "cinematic" | "stills" = "hybrid",
  clipMode: "text" | "image" = "text"
) {
  const opts = { fullVideo: true, footage, clipMode, duration: "60 seconds" as const };
  const steps = initialStepsState(opts) as Record<string, any>;
  steps.script.queued_at = new Date(0).toISOString();
  steps.voiceover.voice_id = "v1";
  return seedJob(false, { steps, credits_charged: totalPipelineCredits(opts), options: { orientation: "vertical" } });
}

test("full video (hybrid, 60 s): 12 slots, 3 Kling + stills, render to final MP4, 70%-margin pricing", async () => {
  assert.equal(totalPipelineCredits({ fullVideo: true, footage: "hybrid", clipMode: "text", duration: "60 seconds" }), 5 + 15 + 10 + 10 + 3 * 130 + 9 * 12 + 2 * 30);
  assert.equal(totalPipelineCredits({ fullVideo: true, footage: "cinematic", clipMode: "text", duration: "60 seconds" }), 40 + 12 * 130 + 60);
  // Image→video (Seedance) is the default clip mode and much cheaper per clip.
  assert.equal(totalPipelineCredits({ fullVideo: true, footage: "hybrid", duration: "60 seconds" }), 40 + 3 * 50 + 9 * 12 + 60);
  assert.equal(totalPipelineCredits({ fullVideo: true, footage: "stills", duration: "30 seconds" }), 40 + 6 * 12 + 30);
  assert.equal(totalPipelineCredits({ fullVideo: true, duration: "8 minutes" }), 15, "unsupported duration → plain package");

  const { runner, rows, rpc, seedJob, calls, klingStatuses, renderStatus, edit, projects } = makeRunner();
  const id = seedFullVideoJob(seedJob);

  assert.equal(await runner.runNextStep(id), "advanced"); // script
  assert.equal(await runner.runNextStep(id), "advanced"); // voiceover (+captions)
  // 0.9 s of speech for a 60 s target: far off → the narration is rewritten to
  // the word count the measured rate implies and re-synthesised, then the
  // (still short) take gets the slowest natural-sounding speed (0.88).
  assert.deepEqual(
    calls.filter((c) => c.startsWith("voiceover") || c.startsWith("revise")),
    ["voiceover", "revise@" + Math.round(1 / (0.9 / 60)), "voiceover", "voiceover@0.88"]
  );
  assert.equal(rows.get(id)!.steps.voiceover.speed, 0.88);
  assert.equal(rows.get(id)!.steps.voiceover.rewritten_for_length, true);
  assert.equal(await runner.runNextStep(id), "advanced"); // thumbnail
  assert.equal(await runner.runNextStep(id), "advanced"); // visuals: submit
  let job = rows.get(id)!;
  assert.equal(job.steps.video.slots.length, 12);
  assert.deepEqual(
    job.steps.video.slots.filter((s: any) => s.kind === "kling").map((s: any) => s.index),
    [0, 4, 8]
  );
  assert.equal(calls.filter((c) => c.startsWith("submit:")).length, 3);
  // Every still slot gets its own image (no back-to-back repeats) → nothing refunded up front
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), []);

  // Polls: Kling still processing, stills generated 2 per poll (9 slots → 5 polls)
  assert.equal(await runner.runNextStep(id), "noop");
  assert.equal(calls.filter((c) => c.startsWith("still:")).length, 2);
  for (let i = 0; i < 4; i++) await runner.runNextStep(id);
  assert.equal(calls.filter((c) => c.startsWith("still:")).length, 9, "one image per still slot");

  klingStatuses.task_1 = "succeed";
  klingStatuses.task_2 = "succeed";
  klingStatuses.task_3 = "failed";
  assert.equal(await runner.runNextStep(id), "advanced"); // visuals settle → render queued
  job = rows.get(id)!;
  assert.equal(job.steps.video.status, "completed");
  assert.equal(job.current_step, "render");
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [130], "failed Kling slot refunded");

  assert.equal(await runner.runNextStep(id), "advanced"); // render: submit
  const e = edit()!;
  const tl = e.timeline as any;
  assert.equal(tl.tracks.length, 4, "hook card + captions track + visuals track + music track");
  const musicClip = tl.tracks[3].clips[0];
  assert.equal(musicClip.asset.type, "audio");
  assert.ok(musicClip.asset.volume <= 0.2, "music sits well under the narration");
  assert.match(musicClip.asset.src, /^https:\/\/cdn\/music\/[a-z-]+\.mp3$/);
  assert.equal(tl.tracks[0].clips[0].asset.type, "rich-text");
  assert.equal(tl.tracks[0].clips[0].asset.text, "H");
  assert.equal(tl.tracks[0].clips[0].start, 0);
  assert.ok(tl.tracks[0].clips[0].length > 0 && tl.tracks[0].clips[0].length <= 4, "hook card covers the first seconds (≤ 4 s)");
  assert.equal(tl.tracks[1].clips[0].asset.type, "rich-caption");
  assert.equal(tl.tracks[2].clips.length, 12, "every slot has a visual (failed one falls back to a neighbour)");
  assert.equal((e.output as any).size.width, 1080);
  assert.equal(tl.soundtrack.src.startsWith("https://cdn/"), true);

  assert.equal(await runner.runNextStep(id), "noop"); // rendering
  renderStatus.value = "done";
  assert.equal(await runner.runNextStep(id), "completed");
  job = rows.get(id)!;
  assert.equal(job.status, "completed");
  assert.equal(job.steps.render.status, "completed");
  assert.equal(job.steps.render.storage_path, "u1/" + id + "/final.mp4");
  assert.ok(typeof job.steps.render.video_url === "string" && job.steps.render.video_url.startsWith("https://cdn/"));
  // CC BY attribution for the background track lands in the saved description.
  assert.match(String(projects.at(-1)?.content?.description), /Music: ".+" by Kevin MacLeod/);
});

test("full video: a failed render fails the job and refunds", async () => {
  const { runner, rows, seedJob, klingStatuses, renderStatus } = makeRunner();
  const id = seedFullVideoJob(seedJob, "stills");
  for (let i = 0; i < 4; i++) await runner.runNextStep(id); // script, voiceover, thumbnail, visuals submit
  klingStatuses.task_1 = "succeed";
  // Poll until the render has been submitted (stills: 2 per poll, then settle, then submit).
  for (let i = 0; i < 12 && !rows.get(id)!.steps.render?.render_id; i++) await runner.runNextStep(id);
  const job0 = rows.get(id)!;
  assert.equal(job0.current_step, "render");
  assert.ok(job0.steps.render.render_id, "render submitted");
  renderStatus.value = "failed";
  assert.equal(await runner.runNextStep(id), "failed");
  const job = rows.get(id)!;
  assert.equal(job.status, "failed");
  assert.ok(job.credits_refunded > 0);
});

test("research step runs first and its brief is handed to the script", async () => {
  const opts = { research: true, voiceover: false };
  assert.equal(totalPipelineCredits(opts), 5 + 5 + 10);
  const { runner, rows, seedJob, calls, scriptParams } = makeRunner();
  const steps = initialStepsState(opts) as Record<string, any>;
  steps.research.queued_at = new Date(0).toISOString();
  const id = seedJob(false, { steps, current_step: "research", credits_charged: 20 });

  assert.equal(await runner.runNextStep(id), "advanced"); // research
  assert.deepEqual(calls, ["research"]);
  let job = rows.get(id)!;
  assert.equal(job.steps.research.status, "completed");
  assert.match(job.steps.research.brief, /2026-10-26/);
  assert.equal(job.current_step, "script");

  assert.equal(await runner.runNextStep(id), "advanced"); // script
  assert.match(String(scriptParams()?.research), /2026-10-26/, "script receives the research brief");
  assert.equal(await runner.runNextStep(id), "completed"); // thumbnail → finalize
  job = rows.get(id)!;
  assert.equal(job.status, "completed");
});

test("research failure skips the step, refunds 5 credits and the job still completes", async () => {
  const { runner, rows, seedJob, rpc, calls } = makeRunner({ failAt: "research" });
  const steps = initialStepsState({ research: true }) as Record<string, any>;
  steps.research.queued_at = new Date(0).toISOString();
  const id = seedJob(false, { steps, current_step: "research", credits_charged: 20 });
  assert.equal(await runner.runNextStep(id), "advanced");
  let job = rows.get(id)!;
  assert.equal(job.steps.research.status, "skipped");
  assert.equal(job.steps.research.refunded, 5);
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [5]);
  assert.equal(await runner.runNextStep(id), "advanced"); // script
  assert.equal(await runner.runNextStep(id), "completed"); // thumbnail → finalize
  job = rows.get(id)!;
  assert.equal(job.status, "completed");
  assert.deepEqual(calls, ["research", "script", "thumbnail"]);
  assert.equal(rpc.length, 1, "research refunded exactly once");
});

test("a research step whose worker died is skipped by reconcile after 2 minutes, not failed after 8", async () => {
  let clock = 0;
  const { runner, rows, seedJob, rpc, kicked } = makeRunner({ now: () => clock });
  const steps = initialStepsState({ research: true }) as Record<string, any>;
  steps.research = { ...steps.research, status: "running", started_at: new Date(0).toISOString() };
  const id = seedJob(false, { steps, current_step: "research", credits_charged: 20 });
  clock = 60 * 1000;
  assert.equal(await runner.reconcileJob(rows.get(id)! as JobRow), "ok");
  clock = 3 * 60 * 1000;
  assert.equal(await runner.reconcileJob(rows.get(id)! as JobRow), "kicked");
  const job = rows.get(id)!;
  assert.equal(job.status, "running");
  assert.equal(job.steps.research.status, "skipped");
  assert.equal(job.current_step, "script");
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [5]);
  assert.deepEqual(kicked, [id]);
});


test("full video, image→video clips: still first, then the video model; a failed clip keeps its still and is refunded", async () => {
  const { runner, rows, rpc, seedJob, calls, klingStatuses, renderStatus, edit } = makeRunner();
  const id = seedFullVideoJob(seedJob, "hybrid", "image");
  for (let i = 0; i < 3; i++) await runner.runNextStep(id); // script, voiceover, thumbnail
  assert.equal(await runner.runNextStep(id), "advanced"); // visuals: plan only (no Kling submit)
  assert.equal(calls.filter((c) => c.startsWith("kling")).length, 0);
  let job = rows.get(id)!;
  assert.equal(job.steps.video.plan.clipMode, "image");
  assert.equal(job.steps.video.slots.filter((s: any) => s.kind === "kling").length, 3);

  // Polls: clips get a still and are handed to fal before plain stills.
  for (let i = 0; i < 12 && rows.get(id)!.steps.video.slots.some((s: any) => s.kind === "kling" && s.status === "pending"); i++) {
    await runner.runNextStep(id);
  }
  job = rows.get(id)!;
  const clipSlots = job.steps.video.slots.filter((s: any) => s.kind === "kling");
  assert.ok(clipSlots.every((s: any) => s.status === "processing" && s.imageUrl && s.fal), "every clip slot has a still and a fal request");
  assert.ok(calls.some((c) => c.startsWith("i2v:") && c.includes("still-")), "the still is what gets animated");

  // Two clips succeed, one fails.
  const [a, b, c] = clipSlots.map((s: any) => s.fal.requestId);
  klingStatuses[a] = "succeed";
  klingStatuses[b] = "succeed";
  klingStatuses[c] = "failed";
  for (let i = 0; i < 12 && rows.get(id)!.steps.video.status !== "completed"; i++) await runner.runNextStep(id);
  job = rows.get(id)!;
  assert.equal(job.steps.video.status, "completed");
  assert.deepEqual(rpc.map(([, x]) => x.p_amount), [50], "only the failed clip's 50 credits come back");

  await runner.runNextStep(id); // render submit
  const clips = (edit()!.timeline as any).tracks.find((t: any) => t.clips?.length >= 12).clips;
  const failedSlot = job.steps.video.slots.find((s: any) => s.fal?.requestId === c);
  const atFailed = clips.find((x: any) => Math.abs(x.start - failedSlot.start) < 0.01);
  assert.equal(atFailed.asset.type, "image", "the failed clip's own still fills its slot");
  assert.equal(atFailed.asset.src, failedSlot.imageUrl);
  assert.equal(clips.filter((x: any) => x.asset.type === "video").length, 2);
  renderStatus.value = "done";
});
