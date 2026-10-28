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
  const o = optionsFromSteps(steps);
  assert.equal(o.voiceover, true);
  assert.equal(o.subtitles, true);
  assert.equal(o.video, false);
  assert.equal(o.fullVideo, false);
});

test("timeline: planSlots spreads Kling slots evenly and maps scenes in order", async () => {
  const { planSlots, stillScenes, buildEdit, narrationSeconds } = await import("./timeline");
  const scenes = [1, 2, 3, 4, 5].map((n) => ({ sceneNumber: n, videoPrompt: `p${n}` }));
  const slots = planSlots(scenes, 58.2, 12, 3);
  assert.equal(slots.length, 12);
  assert.deepEqual(slots.filter((s) => s.kind === "kling").map((s) => s.index), [0, 4, 8]);
  assert.deepEqual(slots.map((s) => s.sceneNumber), [1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5, 5]);
  const totalLen = slots.reduce((n, s) => n + s.length, 0);
  assert.ok(Math.abs(totalLen - 58.2) < 0.05, "slots cover the narration exactly");
  assert.deepEqual(stillScenes(slots), [1, 2, 3, 4, 5]);
  assert.equal(narrationSeconds([{ start: 0, end: 51.9, text: "x" }], 60), 52.5);
  assert.equal(narrationSeconds(undefined, 60), 60);

  // Edit: failed slot borrows the nearest ready visual; Kling clip is slowed to fill its slot.
  slots.forEach((s) => {
    s.status = s.index === 1 ? "failed" : "succeed";
    s.url = `https://cdn/${s.index}`;
    if (s.kind === "kling") s.sourceSeconds = 5;
  });
  const edit = buildEdit({ slots, voiceoverUrl: "https://cdn/v.mp3", subtitlesUrl: "https://cdn/c.srt", orientation: "vertical", totalSeconds: 58.2 }) as any;
  // Slots here are 4.85 s, shorter than the 5 s clip → trimmed at normal speed.
  assert.equal(edit.timeline.tracks[1].clips[0].asset.speed, 1);
  // A longer narration (70 s / 12 = 5.83 s slots) slows the clip to fill the slot.
  const longSlots = planSlots(scenes, 70, 12, 3);
  longSlots.forEach((s) => { s.status = "succeed"; s.url = "u"; if (s.kind === "kling") s.sourceSeconds = 5; });
  const longEdit = buildEdit({ slots: longSlots, voiceoverUrl: "v", orientation: "horizontal", totalSeconds: 70 }) as any;
  assert.ok(longEdit.timeline.tracks[0].clips[0].asset.speed < 1 && longEdit.timeline.tracks[0].clips[0].asset.speed >= 0.5);
  assert.equal(longEdit.timeline.tracks.length, 1, "no subtitles → no caption track");
  const visual = edit.timeline.tracks[1].clips;
  assert.equal(visual.length, 12);
  assert.equal(visual[1].asset.src, "https://cdn/0", "failed slot falls back to its neighbour");
  assert.equal(visual[0].asset.type, "video");
  assert.equal(visual[2].asset.type, "image");
  assert.ok(visual[2].effect, "stills get a Ken Burns effect");
  assert.equal(edit.output.size.height, 1920);
  assert.equal(edit.output.range.length, 58.2);
});

test("narration: word range tracks the selected duration at ~2.1 words/s", async () => {
  const { wordRange, narrationWordCount } = await import("./narration");
  const r30 = wordRange("30 seconds");
  assert.deepEqual(r30, { min: 63, target: 69, max: 75, seconds: 30 });
  const r60 = wordRange("60 seconds");
  assert.equal(r60.target, 138);
  assert.equal(wordRange("3 minutes").seconds, 180);
  assert.equal(narrationWordCount("Bir iki.", "üç  dört\nbeş"), 5);
});
