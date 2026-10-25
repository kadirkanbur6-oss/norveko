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

type Row = Record<string, any>;

function makeDb() {
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
      if (name === "projects") return { data: [{ id: `proj_${++seq}` }], error: null };
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
        getPublicUrl: () => ({ data: { publicUrl: "https://cdn/x.mp3" } }),
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

  return { db: db as any, rows, rpc, seedJob };
}

function makeRunner(
  opts: { failAt?: string; now?: () => number; klingStatuses?: Record<string, "processing" | "succeed" | "failed"> } = {}
) {
  const { db, rows, rpc, seedJob } = makeDb();
  const kicked: string[] = [];
  const calls: string[] = [];
  const usage: UsageRecord[] = [];
  const klingStatuses = opts.klingStatuses ?? {};
  let taskSeq = 0;
  const runner = createPipelineRunner({
    db,
    providers: {
      generateScript: async () => {
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
      generateSpeech: async () => {
        calls.push("voiceover");
        if (opts.failAt === "voiceover") throw new Error("eleven down");
        // "Hi there." with one character every 100 ms.
        const chars = "Hi there.".split("");
        return {
          audio: Buffer.from("mp3"),
          alignment: {
            characters: chars,
            character_start_times_seconds: chars.map((_, i) => i * 0.1),
            character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.1),
          },
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
      downloadVideo: async () => Buffer.from("mp4"),
    },
    kick: async (id) => {
      kicked.push(id);
    },
    now: opts.now ?? Date.now,
    recordUsage: async (record) => {
      usage.push(record);
    },
  });
  return { runner, rows, rpc, seedJob, kicked, calls, klingStatuses, usage };
}

function seedVideoJob(seedJob: ReturnType<typeof makeDb>["seedJob"]) {
  return seedJob(false, {
    steps: {
      script: { status: "pending", provider: "openai", error: null, queued_at: new Date(0).toISOString() },
      thumbnail: { status: "pending", provider: "gemini", error: null },
      video: { status: "pending", provider: "kling", error: null },
    },
    credits_charged: 15 + 12 * 5,
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

test("a failing step fails the job and refunds exactly once", async () => {
  const { runner, rows, rpc, seedJob } = makeRunner({ failAt: "thumbnail" });
  const id = seedJob(false);
  assert.equal(await runner.runNextStep(id), "advanced");
  assert.equal(await runner.runNextStep(id), "failed");

  const job = rows.get(id)!;
  assert.equal(job.status, "failed");
  assert.equal(job.error, "gemini down");
  assert.equal(job.steps.thumbnail.status, "failed");
  assert.equal(job.credits_refunded, 15);
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0][0], "add_credits");
  assert.equal(rpc[0][1].p_amount, 15);

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
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [24]);

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
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [24, 12]);
  assert.equal(job.steps.result.project_id.startsWith("proj_"), true);
});

test("video step: every submit failing fails the job with a full refund", async () => {
  const { runner, rows, rpc, seedJob } = makeRunner({ failAt: "video-submit" });
  const id = seedVideoJob(seedJob);
  assert.equal(await runner.runNextStep(id), "advanced");
  assert.equal(await runner.runNextStep(id), "advanced");
  assert.equal(await runner.runNextStep(id), "failed");
  const job = rows.get(id)!;
  assert.equal(job.status, "failed");
  assert.equal(job.credits_refunded, 75);
  assert.deepEqual(rpc.map(([, a]) => a.p_amount), [75]);
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
