import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlaylist, chunkPlaylist } from "./playlist";
import { AMBIENT_MARGIN, AMBIENT_MINUTES, ambientCreditsFor, ambientTracksFor, AMBIENT_SONG_COST } from "../skit/pricing";
import { REVENUE_PER_CREDIT_USD } from "../pipeline/steps";

test("playlist covers the length and never repeats a song back to back", () => {
  const d = [170, 180, 175, 190];
  const order = buildPlaylist(d, 3600, "job-1");
  assert.ok(order.reduce((s, i) => s + d[i], 0) >= 3600);
  for (let k = 1; k < order.length; k++) assert.notEqual(order[k], order[k - 1]);
  assert.deepEqual(order, buildPlaylist(d, 3600, "job-1"));
});

test("chunks add up to exactly the video length", () => {
  const d = Array.from({ length: 12 }, () => 180);
  const total = 120 * 60;
  const chunks = chunkPlaylist(buildPlaylist(d, total, "x"), d, total, 3600);
  assert.equal(chunks.length, 2);
  assert.equal(Math.round(chunks.reduce((s, c) => s + c.seconds, 0)), total);
});

test("ambient prices keep at least a 65% margin on the real cost", () => {
  for (const m of AMBIENT_MINUTES) {
    const cost = ambientTracksFor(m) * AMBIENT_SONG_COST + 0.04 + 0.03 * (Math.ceil(m / 60) + 1);
    const revenue = ambientCreditsFor(m) * REVENUE_PER_CREDIT_USD;
    assert.ok(1 - cost / revenue >= AMBIENT_MARGIN, `${m} min margin ${(1 - cost / revenue).toFixed(2)}`);
  }
});
