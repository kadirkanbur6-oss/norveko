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
          credits_refunded: null,
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
    if (withVoice) steps.voiceover = { status: "pending", provider: "el", error: null, voice_id: "v1" };
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
      credits_refunded: null,
      error: null,
      created_at: new Date(0).toISOString(),
      ...overrides,
    });
    return id;
  }

  return { db: db as any, rows, rpc, seedJob };
}

function makeRunner(opts: { failAt?: string; now?: () => number } = {}) {
  const { db, rows, rpc, seedJob } = makeDb();
  const kicked: string[] = [];
  const calls: string[] = [];
  const runner = createPipelineRunner({
    db,
    providers: {
      generateScript: async () => {
        calls.push("script");
        if (opts.failAt === "script") throw new Error("openai down");
        return {
          hook: "h", script: "s", scenes: [], titles: [], description: "d", tags: [],
          thumbnailIdea: "idea", thumbnailPrompt: "p",
        };
      },
      generateSpeech: async () => {
        calls.push("voiceover");
        if (opts.failAt === "voiceover") throw new Error("eleven down");
        return Buffer.from("mp3");
      },
      generateThumbnail: async () => {
        calls.push("thumbnail");
        if (opts.failAt === "thumbnail") throw new Error("gemini down");
        return { imageUrl: "https://cdn/t.png", storagePath: "t.png" };
      },
    },
    kick: async (id) => {
      kicked.push(id);
    },
    now: opts.now ?? Date.now,
  });
  return { runner, rows, rpc, seedJob, kicked, calls };
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
