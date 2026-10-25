// Unit tests for the caption builder. Run with: npm run test:pipeline
import test from "node:test";
import assert from "node:assert/strict";
import {
  alignmentToWords,
  wordsToCues,
  cuesToSrt,
  cuesToVtt,
  wrapLines,
  type CharacterAlignment,
} from "./captions";

function align(text: string, secondsPerChar = 0.08): CharacterAlignment {
  const characters = text.split("");
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * secondsPerChar),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * secondsPerChar),
  };
}

test("alignmentToWords groups characters by whitespace with word timings", () => {
  const words = alignmentToWords(align("Hello big world"));
  assert.deepEqual(
    words.map((w) => w.text),
    ["Hello", "big", "world"]
  );
  assert.equal(words[0].start, 0);
  assert.ok(Math.abs(words[0].end - 0.4) < 1e-9);
  assert.ok(words[1].start > words[0].end);
});

test("wordsToCues respects the two-line character budget", () => {
  const text = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const cues = wordsToCues(alignmentToWords(align(text, 0.02)));
  assert.ok(cues.length > 1);
  for (const cue of cues) {
    for (const line of cue.text.split("\n")) assert.ok(line.length <= 38, line);
    assert.ok(cue.text.split("\n").length <= 2);
    assert.ok(cue.end > cue.start);
  }
  // Nothing lost.
  assert.equal(cues.map((c) => c.text.replace(/\n/g, " ")).join(" "), text);
});

test("wordsToCues breaks on long pauses and on max duration", () => {
  const words = [
    { text: "One", start: 0, end: 0.3 },
    { text: "two.", start: 0.4, end: 0.7 },
    { text: "Three", start: 2.0, end: 2.3 }, // 1.3 s pause → new cue
    { text: "four", start: 2.4, end: 8.0 }, // would exceed 5 s → new cue
  ];
  const cues = wordsToCues(words);
  assert.deepEqual(
    cues.map((c) => c.text),
    ["One two.", "Three", "four"]
  );
  assert.equal(cues[0].end, 0.8, "short cue extended to the minimum display time");
});

test("wrapLines balances two lines at a word boundary", () => {
  const wrapped = wrapLines("the quick brown fox jumps over the lazy dog tonight", 38, 2);
  const lines = wrapped.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.length <= 38));
  assert.ok(Math.abs(lines[0].length - lines[1].length) < 15, "lines are roughly balanced");
});

test("SRT and VTT renderers format timestamps correctly", () => {
  const cues = [
    { start: 0, end: 1.5, text: "Hello\nworld" },
    { start: 61.25, end: 3661.001, text: "Later" },
  ];
  assert.equal(
    cuesToSrt(cues),
    "1\n00:00:00,000 --> 00:00:01,500\nHello\nworld\n\n2\n00:01:01,250 --> 01:01:01,001\nLater\n"
  );
  assert.equal(
    cuesToVtt(cues),
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello\nworld\n\n00:01:01.250 --> 01:01:01.001\nLater\n"
  );
});

test("pricing: subtitles add 10 credits only together with a voiceover", async () => {
  const { totalPipelineCredits, initialStepsState, optionsFromSteps } = await import("./steps");
  assert.equal(totalPipelineCredits({ voiceover: true }), 30);
  assert.equal(totalPipelineCredits({ voiceover: true, subtitles: true }), 40);
  assert.equal(totalPipelineCredits({ voiceover: false, subtitles: true }), 15, "no voiceover → no subtitles charge");
  const steps = initialStepsState({ voiceover: true, subtitles: true });
  assert.equal(steps.voiceover.subtitles, true);
  assert.deepEqual(optionsFromSteps(steps), { voiceover: true, subtitles: true, video: false });
});
