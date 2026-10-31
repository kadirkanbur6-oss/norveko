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

// Loose shape of the Shotstack edit for assertions (tests only).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EditJson = any;

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
  const edit = buildEdit({ slots, voiceoverUrl: "https://cdn/v.mp3", subtitlesUrl: "https://cdn/c.srt", orientation: "vertical", totalSeconds: 58.2 }) as EditJson;
  // Slots here are 4.85 s, shorter than the 5 s clip → trimmed at normal speed.
  assert.equal(edit.timeline.tracks[1].clips[0].asset.speed, 1);
  // A longer narration (70 s / 12 = 5.83 s slots) slows the clip to fill the slot.
  const longSlots = planSlots(scenes, 70, 12, 3);
  longSlots.forEach((s) => { s.status = "succeed"; s.url = "u"; if (s.kind === "kling") s.sourceSeconds = 5; });
  const longEdit = buildEdit({ slots: longSlots, voiceoverUrl: "v", orientation: "horizontal", totalSeconds: 70 }) as EditJson;
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

test("sanitizeClipPrompt strips orientation and camera-rotation words that make Kling rotate the frame", async () => {
  const { sanitizeClipPrompt } = await import("./kling-prompt");
  assert.equal(
    sanitizeClipPrompt("Vertical cinematic aerial sunrise over the Giza plateau, tall framing, golden light, slow dolly-in, 9:16, camera orbiting the pyramids"),
    "aerial sunrise over the Giza plateau, golden light, slow dolly-in, the pyramids"
  );
  assert.equal(sanitizeClipPrompt("A quiet harbor at dawn"), "A quiet harbor at dawn");
});

test("hookTitle keeps the first sentence, caps it at 7 words and uppercases it with the locale", async () => {
  const { hookTitle } = await import("./timeline");
  assert.equal(hookTitle("Penguenler neden uçamaz? Kanatları yüzgece dönüştü."), "PENGUENLER NEDEN UÇAMAZ?");
  assert.equal(hookTitle("Keops piramidi liman ile inşa edildi mi?", "tr"), "KEOPS PİRAMİDİ LİMAN İLE İNŞA EDİLDİ Mİ?");
  assert.equal(hookTitle("one two three four five six seven eight nine ten eleven"), "ONE TWO THREE FOUR FIVE SIX SEVEN…");
  assert.equal(hookTitle("  "), null);
});

test("cuesToSrt can uppercase with Turkish rules for burned-in captions", () => {
  const srt = cuesToSrt([{ start: 0, end: 1, text: "piramidi ılık" }], { uppercase: "tr" });
  assert.match(srt, /PİRAMİDİ ILIK/);
  assert.match(cuesToSrt([{ start: 0, end: 1, text: "piramidi" }]), /piramidi/);
});

test("word budget is language-aware and the measured-ratio range shrinks a long script", async () => {
  const { wordRange, rangeForMeasuredRatio } = await import("./narration");
  assert.equal(wordRange("60 seconds", "en").target, 144);
  assert.equal(wordRange("60 seconds", "tr").target, 111);
  assert.equal(wordRange("30 seconds").target, 69); // default rate
  // 144 words came out at 81 s for a 60 s target → ~107 words would fit.
  const r = rangeForMeasuredRatio(144, 81 / 60, 60);
  assert.equal(r.target, 107);
  assert.ok(r.min < r.target && r.max > r.target);
});

test("estimateAlignment spreads characters over the audio length with pauses at punctuation", async () => {
  // tts.ts imports "server-only"; load the pure helper through a tiny shim.
  const mod = await import("./tts-estimate");
  const a = mod.estimateAlignment("Bir. İki, üç", 10);
  assert.equal(a.characters.length, 12);
  assert.ok(a.character_end_times_seconds.at(-1)! <= 10 && a.character_end_times_seconds.at(-1)! > 9.5);
  const dot = a.characters.indexOf(".");
  const durDot = a.character_end_times_seconds[dot] - a.character_start_times_seconds[dot];
  const durB = a.character_end_times_seconds[0] - a.character_start_times_seconds[0];
  assert.ok(durDot > durB * 4, "full stop is a longer pause");
});

/* ---------------- Script writer helpers (31 Oct) ---------------- */

test("llmProvider routes model ids to the right provider", async () => {
  const { llmProvider, llmUsageKey } = await import("./llm");
  assert.deepEqual(llmProvider("gpt-5-mini"), { provider: "openai", id: "gpt-5-mini" });
  assert.deepEqual(llmProvider("openai:gpt-5"), { provider: "openai", id: "gpt-5" });
  assert.deepEqual(llmProvider("gemini:gemini-2.5-pro"), { provider: "gemini", id: "gemini-2.5-pro" });
  assert.deepEqual(llmProvider("gemini-3-pro-preview"), { provider: "gemini", id: "gemini-3-pro-preview" });
  assert.equal(llmUsageKey("gpt-5-mini"), "openai:gpt-5-mini");
});

test("style examples: mystery/horror share one, ads get none, hook opens the script", async () => {
  const { exampleForStyle, exampleBlock } = await import("./script-examples");
  assert.equal(exampleForStyle("Horror"), exampleForStyle("Mystery"));
  assert.equal(exampleForStyle("Ad / Promo"), null);
  assert.equal(exampleBlock("Ad / Promo"), "");
  for (const s of ["Mystery", "Documentary", "Educational", "Cinematic"]) {
    const ex = exampleForStyle(s)!;
    assert.ok(ex.script.startsWith(ex.hook), `${s} example must open with its hook`);
    assert.match(exampleBlock(s), /never reuse its topic/);
  }
});

test("music: story mood wins over style, forced track wins over both, every track ≥ 60 s", async () => {
  const { pickMusicTrack, MUSIC_TRACKS, MUSIC_MOODS } = await import("./music");
  for (const seed of ["a", "b", "c", "d", "e"]) {
    assert.equal(pickMusicTrack("Mystery", seed, { mood: "tragic" }).mood, "tragic");
    assert.equal(pickMusicTrack("Horror", seed).mood, "eerie");
  }
  assert.equal(pickMusicTrack("Mystery", "x", { mood: "tragic", trackId: "dark-times" }).title, "Dark Times");
  assert.equal(pickMusicTrack("Mystery", "x", { mood: "nonsense" }).mood, "mysterious");
  for (const m of MUSIC_MOODS) assert.ok(MUSIC_TRACKS.some((t) => t.mood === m), `no track for ${m}`);
  assert.ok(MUSIC_TRACKS.every((t) => t.seconds >= 60));
  assert.ok(!MUSIC_TRACKS.some((t) => ["Hidden Agenda", "Thinking Music"].includes(t.title)), "humorous cues must not return");
  assert.equal(new Set(MUSIC_TRACKS.map((t) => t.id)).size, MUSIC_TRACKS.length);
});
