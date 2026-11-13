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

test("pricing: subtitles are charged only together with a voiceover; voice priced per minute and engine", async () => {
  const { totalPipelineCredits, initialStepsState, optionsFromSteps, subtitlesCredits, voiceoverCredits, scriptCredits, THUMBNAIL_CREDITS } = await import("./steps");
  const base = scriptCredits("60 seconds") + THUMBNAIL_CREDITS;
  assert.equal(totalPipelineCredits({ voiceover: true }), base + voiceoverCredits("gemini", "60 seconds"));
  assert.equal(totalPipelineCredits({ voiceover: true, subtitles: true }), base + voiceoverCredits("gemini", "60 seconds") + subtitlesCredits("60 seconds"));
  assert.equal(totalPipelineCredits({ voiceover: false, subtitles: true }), base, "no voiceover → no subtitles charge");
  assert.equal(voiceoverCredits("gemini", "8 minutes"), 8 * voiceoverCredits("gemini", "60 seconds"), "8 minutes = 8 started minutes");
  assert.ok(voiceoverCredits("elevenlabs", "60 seconds") > 3 * voiceoverCredits("gemini", "60 seconds"), "ElevenLabs costs more");
  assert.ok(totalPipelineCredits({ voiceover: true, subtitles: true, duration: "30 seconds" }) < totalPipelineCredits({ voiceover: true, subtitles: true, duration: "60 seconds" }), "30 s is cheaper than 60 s");
  const steps = initialStepsState({ voiceover: true, subtitles: true });
  assert.equal(steps.voiceover.subtitles, true);
  const o = optionsFromSteps(steps);
  assert.equal(o.voiceover, true);
  assert.equal(o.subtitles, true);
  assert.equal(o.video, false);
  assert.equal(o.fullVideo, false);
  // Prices are recorded on the steps so later refunds use what was paid.
  assert.equal(steps.voiceover.credits, voiceoverCredits("gemini", "60 seconds"));
  assert.equal(steps.voiceover.subtitles_credits, subtitlesCredits("60 seconds"));
  assert.equal(steps.thumbnail.credits, THUMBNAIL_CREDITS);
});

test("pricing: every item keeps ≥ 40% margin at the Business-pack revenue per credit", async () => {
  const s = await import("./steps");
  const margin = (credits: number, usd: number) => 1 - usd / (credits * s.REVENUE_PER_CREDIT_USD);
  const checks: Array<[string, number, number]> = [
    ["research", s.RESEARCH_CREDITS, 0.045],
    ["script 30 s", s.scriptCredits("30 seconds"), 0.03],
    ["script 60 s", s.scriptCredits("60 seconds"), 0.04],
    ["gemini voice / 30 s", s.VOICE_CREDITS_PER_30S.gemini, 0.025],
    ["elevenlabs voice / 30 s", s.VOICE_CREDITS_PER_30S.elevenlabs, 0.1],
    ["script 8 min", s.scriptCredits("8 minutes"), 0.12],
    ["gemini voice / min", s.VOICE_CREDITS_PER_MIN.gemini, 0.05],
    ["elevenlabs voice / min", s.VOICE_CREDITS_PER_MIN.elevenlabs, 0.2],
    ["thumbnail", s.THUMBNAIL_CREDITS, 0.067],
    ["still", s.STILL_SCENE_CREDITS, 0.04],
    ["image→video clip", s.IMAGE_CLIP_CREDITS, 0.17],
    ["kling clip", s.VIDEO_CLIP_CREDITS, 0.42],
    ["render / 30 s", s.RENDER_CREDITS_PER_30S, 0.1],
  ];
  for (const [name, credits, usd] of checks) assert.ok(margin(credits, usd) >= 0.4, `${name}: ${(margin(credits, usd) * 100).toFixed(1)}%`);
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

test("narration: word range tracks the selected duration at the sped-up narration rate", async () => {
  const { wordRange, narrationWordCount } = await import("./narration");
  const r30 = wordRange("30 seconds");
  assert.deepEqual(r30, { min: 79, target: 86, max: 93, seconds: 30 }); // 2.3 w/s × 1.25 tempo
  const r60 = wordRange("60 seconds");
  assert.equal(r60.target, 173);
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
  assert.equal(wordRange("60 seconds", "en").target, 180);
  assert.equal(wordRange("60 seconds", "tr").target, 139);
  assert.equal(wordRange("30 seconds").target, 86); // default rate × tempo
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

test("watermark: free-trial badge is the top layer only when requested; beta users are exempt", async () => {
  const { buildEdit } = await import("./timeline");
  const slots = [{ index: 0, start: 0, length: 5, kind: "still", status: "succeed", url: "https://x/a.jpg", sceneNumber: 1, prompt: "p" }] as never;
  const plain = buildEdit({ slots, voiceoverUrl: "https://x/v.wav", orientation: "vertical", totalSeconds: 5 }) as { timeline: { tracks: Array<{ clips: Array<{ asset: { type: string; src?: string } }> }> } };
  assert.ok(!plain.timeline.tracks.some((t) => t.clips.some((c) => c.asset.src?.includes("watermark"))));
  const marked = buildEdit({ slots, voiceoverUrl: "https://x/v.wav", orientation: "vertical", totalSeconds: 5, watermarkUrl: "https://norveko.app/brand/watermark.png" }) as typeof plain;
  assert.equal(marked.timeline.tracks[0].clips[0].asset.src, "https://norveko.app/brand/watermark.png", "badge is track 0 (drawn on top)");
  assert.equal(marked.timeline.tracks.length, plain.timeline.tracks.length + 1);

  const { isWatermarkExempt } = await import("./watermark-policy");
  const before = { beta: process.env.BETA_USER_IDS, force: process.env.WATERMARK_FORCE_USER_IDS };
  process.env.BETA_USER_IDS = "kadir, other";
  process.env.WATERMARK_FORCE_USER_IDS = "other";
  assert.equal(isWatermarkExempt("kadir"), true);
  assert.equal(isWatermarkExempt("other"), false, "forced back on for testing");
  assert.equal(isWatermarkExempt("stranger"), false);
  for (const [k, v] of [["BETA_USER_IDS", before.beta], ["WATERMARK_FORCE_USER_IDS", before.force]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("free-trial video: 30 s hybrid image→video costs 0 and records 0 everywhere refunds look", async () => {
  const s = await import("./steps");
  const opts = { research: true, fullVideo: true, footage: "hybrid", clipMode: "image", duration: "30 seconds" } as const;
  assert.equal(s.isTrialVideoShape(opts), true);
  assert.equal(s.isTrialVideoShape({ ...opts, duration: "60 seconds" }), false);
  assert.equal(s.isTrialVideoShape({ ...opts, footage: "cinematic" }), false);
  assert.ok(s.totalPipelineCredits(opts) > 0, "same video normally costs credits");
  assert.equal(s.totalPipelineCredits({ ...opts, trialVideo: true }), 0);
  const steps = s.initialStepsState({ ...opts, trialVideo: true }) as Record<string, Record<string, unknown>>;
  assert.equal((steps.video.plan as { clipCredits: number }).clipCredits, 0);
  assert.equal((steps.video.plan as { stillCredits: number }).stillCredits, 0);
  assert.equal(steps.research.credits, 0);
  assert.equal(steps.render.credits, 0);
  assert.equal(s.optionsFromSteps(steps).trialVideo, true);
  assert.equal(s.totalPipelineCredits({ ...opts, fullVideo: false, trialVideo: true }) > 0, true, "trial flag means nothing without a full video");
});

// --- Free-tier abuse protection (lib/pipeline/abuse.ts) ---
import { isDisposableEmail, normalizeEmail, abuseHash, clientIp, freeJobMarkers } from "./abuse";

test("abuse: throwaway inboxes are detected, real providers are not", () => {
  assert.equal(isDisposableEmail("x@mailinator.com"), true);
  assert.equal(isDisposableEmail("x@sub.mailinator.com"), true);
  assert.equal(isDisposableEmail("X@MAILINATOR.COM"), true);
  for (const ok of ["a@gmail.com", "a@outlook.com", "a@icloud.com", "a@yahoo.com", "a@hotmail.com", "a@proton.me", "a@norveko.app", "a@company.com.tr"]) {
    assert.equal(isDisposableEmail(ok), false, ok);
  }
  assert.equal(isDisposableEmail(""), false);
  assert.equal(isDisposableEmail(null), false);
});

test("abuse: e-mail aliases normalise to one person", () => {
  assert.equal(normalizeEmail("Ka.Dir+test1@Gmail.com"), "kadir@gmail.com");
  assert.equal(normalizeEmail("kadir@googlemail.com"), "kadir@gmail.com");
  assert.equal(normalizeEmail("ka.dir+x@outlook.com"), "ka.dir@outlook.com");
  assert.equal(abuseHash("email", normalizeEmail("k.a+1@gmail.com")), abuseHash("email", normalizeEmail("ka@gmail.com")));
  assert.notEqual(abuseHash("ip", "1.2.3.4"), abuseHash("email", "1.2.3.4"));
});

test("abuse: client IP comes from the first forwarded hop and is stored hashed", () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })), "5.6.7.8");
  assert.equal(clientIp(new Headers()), null);
  const m = freeJobMarkers({ email: "a@gmail.com", ip: "5.6.7.8" });
  assert.equal(m.freeIp?.length, 32);
  assert.ok(!JSON.stringify(m).includes("5.6.7.8"));
  assert.ok(!JSON.stringify(m).includes("gmail"));
});

// --- Look presets (lib/pipeline/visual-styles.ts) ---
import { stillPrompt, clipPrompt, captionStyle, visualStyle, VISUAL_STYLES, CAPTION_STYLES } from "./visual-styles";
import { buildEdit } from "./timeline";

test("styles: visual style leads the still prompt and never allows text", () => {
  const anime = stillPrompt("a lighthouse at dusk", "anime", "9:16");
  assert.ok(anime.startsWith(visualStyle("anime").still));
  assert.ok(anime.includes("no text"));
  assert.ok(anime.endsWith("a lighthouse at dusk"));
  assert.ok(stillPrompt("x", "unknown-id", "9:16").startsWith(VISUAL_STYLES[0].still));
  assert.equal(clipPrompt("waves", "cinematic"), "waves");
  assert.equal(clipPrompt("waves", null), "waves");
  assert.ok(clipPrompt("waves", "archive").includes("16mm"));
  assert.equal(new Set(VISUAL_STYLES.map((s) => s.id)).size, VISUAL_STYLES.length);
  assert.equal(new Set(CAPTION_STYLES.map((s) => s.id)).size, CAPTION_STYLES.length);
});

test("styles: caption style shapes the burned-in subtitles", () => {
  const base = { slots: [], voiceoverUrl: "https://x/v.wav", subtitlesUrl: "https://x/c.srt", orientation: "vertical" as const, totalSeconds: 30 };
  const capOf = (edit: EditJson) =>
    edit.timeline.tracks.flatMap((t: EditJson) => t.clips).find((c: EditJson) => c.asset.type === "rich-caption").asset;
  const bold = capOf(buildEdit(base));
  assert.equal(bold.animation.style, "karaoke");
  assert.equal(bold.active.font.color, "#FFD60A");
  const box = capOf(buildEdit({ ...base, captionStyle: "box" }));
  assert.equal(box.active.font.background, "#7C3AED");
  const clean = capOf(buildEdit({ ...base, captionStyle: "clean" }));
  assert.equal(clean.animation.style, "none");
  assert.equal(clean.active, undefined);
  assert.equal(captionStyle("clean").uppercase, false);
  assert.equal(captionStyle(undefined).id, "bold");
});

test("edit video: a regenerated still replaces the slot's clip in the render", () => {
  const slots = [
    { index: 0, sceneNumber: 1, kind: "kling", start: 0, length: 5, prompt: "a", status: "succeed", url: "https://x/clip.mp4", sourceSeconds: 5 },
    { index: 1, sceneNumber: 2, kind: "still", start: 5, length: 5, prompt: "b", status: "succeed", url: "https://x/old.png", editedStillUrl: "https://x/new.png" },
  ] as never;
  const edit = buildEdit({ slots, voiceoverUrl: "https://x/v.wav", orientation: "vertical", totalSeconds: 10 }) as EditJson;
  const srcs = JSON.stringify(edit);
  assert.ok(srcs.includes("https://x/clip.mp4"));
  assert.ok(srcs.includes("https://x/new.png"));
  assert.ok(!srcs.includes("https://x/old.png"));
  const edited = buildEdit({
    slots: [{ ...(slots as unknown as Array<Record<string, unknown>>)[0], editedStillUrl: "https://x/swap.png" }] as never,
    voiceoverUrl: "https://x/v.wav",
    orientation: "vertical",
    totalSeconds: 5,
  }) as EditJson;
  assert.ok(JSON.stringify(edited).includes("https://x/swap.png"));
  assert.ok(!JSON.stringify(edited).includes("clip.mp4"));
});

// --- Series schedule (lib/series/schedule.ts) ---
import { upcomingSlots, nextSlot, zonedToUtc } from "../series/schedule";
import { validateSeries } from "../series/validate";

test("series: post times are computed in the series' own time zone", () => {
  // Istanbul is UTC+3 all year: 18:00 local = 15:00 UTC.
  assert.equal(zonedToUtc(2026, 11, 2, 18, 0, "Europe/Istanbul").toISOString(), "2026-11-02T15:00:00.000Z");
  // New York: EDT (UTC-4) before 1 Nov 2026, EST (UTC-5) after.
  assert.equal(zonedToUtc(2026, 10, 30, 9, 0, "America/New_York").toISOString(), "2026-10-30T13:00:00.000Z");
  assert.equal(zonedToUtc(2026, 11, 2, 9, 0, "America/New_York").toISOString(), "2026-11-02T14:00:00.000Z");

  // Sat 31 Oct 2026 12:00 Istanbul; Mon/Wed/Fri at 18:00 → next is Mon 2 Nov.
  const from = new Date("2026-10-31T09:00:00Z");
  const sched = { days: [1, 3, 5], time: "18:00", timezone: "Europe/Istanbul" };
  assert.equal(nextSlot(sched, from)?.toISOString(), "2026-11-02T15:00:00.000Z");
  assert.deepEqual(upcomingSlots(sched, from, 26), []);
  assert.equal(upcomingSlots(sched, from, 24 * 7).length, 3);
  // Daily at 18:00, looking 26 h ahead from 12:00 → today 18:00 only.
  assert.equal(upcomingSlots({ ...sched, days: [0, 1, 2, 3, 4, 5, 6] }, from, 26).length, 1);
  // A slot exactly now is not "upcoming" (no double-creation on the boundary).
  assert.equal(upcomingSlots({ ...sched, days: [6], time: "12:00" }, from, 1).length, 0);
});

test("series: input validation", () => {
  const good = {
    name: "Mysteries",
    topic: "Unsolved disappearances of the 20th century",
    settings: { platform: "YouTube Shorts", style: "Mystery", duration: "60 seconds", language: "English", voiceId: "gemini:Charon", visualStyle: "dark" },
    days: [5, 1, 1, 9],
    post_time: "18:00",
    timezone: "Europe/Istanbul",
  };
  const ok = validateSeries(good);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.value.days, [1, 5]);
    assert.equal(ok.value.settings.visualStyle, "dark");
  }
  assert.equal(validateSeries({ ...good, settings: { ...good.settings, duration: "8 minutes" } }).ok, false);
  assert.equal(validateSeries({ ...good, timezone: "Mars/Olympus" }).ok, false);
  assert.equal(validateSeries({ ...good, settings: { ...good.settings, voiceId: "someElevenId" } }).ok, false);
});

import { brandSnapshot, readSnapshot, cleanOutro, contrastText, rowToKit } from "../brand/kit";

test("brand kit: snapshot, validation and edit layers", () => {
  assert.equal(cleanOutro("  Follow <b>@me</b>  for more "), "Follow b@me/b for more");
  assert.equal(cleanOutro("x".repeat(80))?.length, 60);
  assert.equal(contrastText("#FFFFFF"), "#000000");
  assert.equal(contrastText("#7C3AED"), "#FFFFFF");
  assert.equal(brandSnapshot(rowToKit({ logo_url: null, color: null, outro_text: "" })), null);
  const snap = brandSnapshot(
    rowToKit({ logo_url: "https://cdn/logo.png", color: "#7C3AED", outro_text: "Follow for more", logo_on_video: true, logo_on_thumbnail: false })
  )!;
  assert.deepEqual(snap, { logoUrl: "https://cdn/logo.png", videoLogo: true, thumbLogo: false, color: "#7C3AED", outroText: "Follow for more" });
  assert.deepEqual(readSnapshot(snap), snap);
  assert.equal(readSnapshot({ logoUrl: "javascript:x", color: "red" }), null);

  const slots = [{ index: 0, start: 0, length: 30, kind: "still" as const, status: "succeed", url: "https://cdn/a.png", sceneIndex: 0 }];
  const edit = buildEdit({
    slots: slots as never,
    voiceoverUrl: "v",
    subtitlesUrl: "s",
    orientation: "vertical",
    totalSeconds: 30,
    hookText: "The lighthouse went dark.",
    captionStyle: "bold",
    brand: snap,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as { timeline: { tracks: Array<{ clips: Array<Record<string, any>> }> } };
  const assets = edit.timeline.tracks.map((t) => t.clips[0].asset);
  assert.ok(assets.some((a) => a.type === "image" && a.src === "https://cdn/logo.png"), "logo layer");
  const outro = edit.timeline.tracks.find((t) => t.clips[0].asset.text === "Follow for more")!.clips[0];
  assert.equal(outro.start, 27.5);
  const hook = assets.find((a) => a.type === "rich-text" && a.text?.startsWith("THE"));
  assert.equal(hook.background.color, "#7C3AED");
  const caption = assets.find((a) => a.type === "rich-caption");
  assert.equal(caption.active.font.color, "#FFD60A"); // subtitles keep the preset colour

  // Logo only on thumbnails → no video layer.
  const noLogo = buildEdit({ slots: slots as never, voiceoverUrl: "v", orientation: "vertical", totalSeconds: 30, brand: { ...snap, videoLogo: false } }) as typeof edit;
  assert.ok(!noLogo.timeline.tracks.some((t) => t.clips[0].asset.src === "https://cdn/logo.png"));
});

import { claimReferral, rewardReferrer, revokeReferralReward, rewardFor, isReferralCode, newCode } from "../referrals/referrals";

/** Tiny in-memory stand-in for the few Supabase calls the referral code makes. */
function fakeReferralDb(seed: Record<string, Array<Record<string, unknown>>>) {
  const tables = seed;
  const rpcCalls: Array<Record<string, unknown>> = [];
  const from = (name: string) => {
    tables[name] ??= [];
    const rows = tables[name];
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> = {};
    let head = false;
    const match = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
    const q: Record<string, unknown> = {
      select: (_c?: string, opts?: { head?: boolean }) => ((head = Boolean(opts?.head)), q),
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      insert: (row: Record<string, unknown>) => {
        const pk = name === "referral_codes" ? "user_id" : name === "referrals" ? "referred_user_id" : "paddle_transaction_id";
        if (rows.some((r) => r[pk] === row[pk])) return Promise.resolve({ error: { code: "23505" } });
        rows.push({ ...row });
        return Promise.resolve({ error: null });
      },
      update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), q),
      delete: () => ((op = "delete"), q),
      maybeSingle: () => {
        const m = match();
        if (op === "update") m.forEach((r) => Object.assign(r, payload));
        return Promise.resolve({ data: m[0] ?? null, error: null });
      },
      then: (resolve: (v: unknown) => void) => {
        const m = match();
        if (op === "update") m.forEach((r) => Object.assign(r, payload));
        if (op === "delete") m.forEach((r) => rows.splice(rows.indexOf(r), 1));
        resolve({ data: head ? null : m, count: m.length, error: null });
      },
    };
    return q;
  };
  const db = { from, rpc: (_fn: string, args: Record<string, unknown>) => (rpcCalls.push(args), Promise.resolve({ error: null })) };
  return { db: db as never, tables, rpcCalls };
}

test("referrals: claim rules, 20% reward once per transaction, refund reversal", async () => {
  assert.ok(isReferralCode(newCode()));
  assert.ok(!isReferralCode("../x"));
  assert.equal(rewardFor(500), 100);
  const now = new Date("2026-11-01T00:00:00Z");
  const { db, tables, rpcCalls } = fakeReferralDb({
    referral_codes: [{ user_id: "alice", code: "abc23456" }],
    credit_purchases: [{ id: 1, user_id: "old-buyer" }],
  });
  assert.equal(await claimReferral(db, { id: "alice", created_at: "2026-10-31T00:00:00Z" }, "abc23456", now), "own_code");
  assert.equal(await claimReferral(db, { id: "bob", created_at: "2026-10-01T00:00:00Z" }, "abc23456", now), "too_old");
  assert.equal(await claimReferral(db, { id: "old-buyer", created_at: "2026-10-31T00:00:00Z" }, "abc23456", now), "has_purchases");
  assert.equal(await claimReferral(db, { id: "bob", created_at: "2026-10-31T00:00:00Z" }, "zzzzzzzz", now), "no_code");
  assert.equal(await claimReferral(db, { id: "bob", created_at: "2026-10-31T00:00:00Z" }, "abc23456", now), "claimed");
  assert.equal(await claimReferral(db, { id: "bob", created_at: "2026-10-31T00:00:00Z" }, "abc23456", now), "already");

  const r = await rewardReferrer(db, { referredUserId: "bob", transactionId: "txn_1", credits: 2000, packName: "Pro" }, now);
  assert.deepEqual(r, { referrer: "alice", credits: 400 });
  assert.equal(await rewardReferrer(db, { referredUserId: "bob", transactionId: "txn_1", credits: 2000, packName: "Pro" }, now), null);
  assert.equal(await rewardReferrer(db, { referredUserId: "carol", transactionId: "txn_2", credits: 500, packName: "Starter" }, now), null);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].p_amount, 400);

  assert.equal(await revokeReferralReward(db, "txn_1"), 400);
  assert.equal(await revokeReferralReward(db, "txn_1"), 0);
  assert.equal(rpcCalls[1].p_amount, -400);
  assert.equal(tables.referral_rewards[0].status, "refunded");

  // Purchases after the 12-month window earn nothing.
  const later = new Date("2027-12-01T00:00:00Z");
  assert.equal(await rewardReferrer(db, { referredUserId: "bob", transactionId: "txn_3", credits: 500, packName: "Starter" }, later), null);
});

import { SUBSCRIPTION_PLANS, addOneMonth, monthlyCredits, getSubscriptionPlan, netPerGrantUsd } from "../subscriptions";

test("subscriptions: plan margins and monthly grant dates", async () => {
  const { REVENUE_PER_CREDIT_USD } = await import("./steps");
  // Net revenue per credit after Paddle (5% + $0.50). Yearly plans grant 12 × credits.
  for (const p of SUBSCRIPTION_PLANS) {
    const net = p.priceUsd * 0.95 - 0.5;
    const credits = p.period === "year" ? p.credits * 12 : p.credits;
    const margin = 1 - (credits * REVENUE_PER_CREDIT_USD * 0.6) / net; // cost share = 60% of baseline revenue
    // Yearly ("1 month free") is the one deliberate discount; everything else keeps 40%.
    const floor = p.period === "year" ? 0.35 : 0.4;
    assert.ok(margin >= floor, `${p.id}: ${(margin * 100).toFixed(1)}%`);
    // …and the inviter's referral reward never pushes it below that.
    const grants = p.period === "year" ? 12 : 1;
    const reward = rewardFor(p.credits, netPerGrantUsd(p)) * grants;
    const withReward = 1 - ((credits + reward) * REVENUE_PER_CREDIT_USD * 0.6) / net;
    assert.ok(withReward >= floor - 1e-9, `${p.id} with referral: ${(withReward * 100).toFixed(1)}%`);
  }
  // Packs: the reward is the full 20% only where the pack has the headroom.
  assert.equal(rewardFor(500, 9 * 0.95 - 0.5), 100);
  assert.equal(rewardFor(5000, 59 * 0.95 - 0.5), 0);
  assert.equal(getSubscriptionPlan("pro-month")?.credits, 4000);
  assert.equal(monthlyCredits(getSubscriptionPlan("creator-week")!), Math.round((380 * 52) / 12));
  assert.equal(addOneMonth(new Date("2026-01-31T10:00:00Z")).toISOString(), "2026-02-28T10:00:00.000Z");
  assert.equal(addOneMonth(new Date("2026-11-15T08:30:00Z")).toISOString(), "2026-12-15T08:30:00.000Z");
  assert.equal(addOneMonth(new Date("2026-12-20T00:00:00Z")).toISOString(), "2027-01-20T00:00:00.000Z");
});

test("pricing: skits, talk and swap keep ≥ 40% margin (13 Nov 2026)", async () => {
  const s = await import("./steps");
  const p = await import("../skit/pricing");
  const margin = (credits: number, usd: number) => 1 - usd / (credits * s.REVENUE_PER_CREDIT_USD);
  // 4 speaking shots as 6 s Veo clips, 2 silent, 3 characters, 2 sfx, 1 crowd (render credits excluded).
  const usd = p.SKIT_PLAN_COST + p.SKIT_IMAGE_COST * 9 + 24 * p.SKIT_TALK_VIDEO_COST_PER_SECOND + 2 * p.SKIT_CLIP_COST + 2 * p.SKIT_SFX_COST + p.SKIT_CROWD_COST;
  const skit = p.skitCreditsFor({ characters: 3, shots: 6, speakingSeconds: 0, talkClipSeconds: 24, silentShots: 2, sfx: 2, crowd: 1, totalSeconds: 30 }) - s.RENDER_CREDITS_PER_30S;
  assert.ok(margin(skit, usd) >= 0.4 - 1e-9, `skit margin ${margin(skit, usd)}`);
  assert.ok(margin(p.talkCreditsFor(10), 10 * s.AVATAR_COST_PER_SECOND + p.SKIT_IMAGE_COST) >= 0.4 - 1e-9);
  assert.ok(margin(p.swapCreditsFor(300, 10) - s.RENDER_CREDITS_PER_30S, (300 / 16) * p.SWAP_COST_PER_16_FRAMES) >= 0.4 - 1e-9);
});

test("skits: long lines split into clip-sized shots of the same speaker, every word kept (5 Nov 2026)", async () => {
  const { splitLongLines, speechSeconds } = await import("../skit/split");
  const base = { setting: "kitchen", camera: "medium" as const, visible: ["c1"], speaker: "c1", tone: "angry", action: "", sfx: "door slam", crowd: "", seconds: 3 };
  const long = "I told you a hundred times not to touch my sofa. You did it anyway, didn't you? Now the remote is gone, the cushions are gone, and I am still hungry.";
  const shots = splitLongLines([{ ...base, id: "s1", line: "Short line." }, { ...base, id: "s2", line: long }], "en", 14);
  const parts = shots.filter((s) => s.id.startsWith("s2"));
  assert.ok(parts.length >= 2, "the long line is split");
  assert.equal(parts.map((p) => p.line).join(" "), long, "every word kept, in order");
  for (const p of parts) assert.ok(speechSeconds(p.line, "en") <= 7.2, `fits a clip: ${p.line}`);
  assert.ok(parts.every((p) => p.speaker === "c1"));
  assert.equal(parts[0].sfx, "door slam");
  assert.ok(parts.slice(1).every((p) => p.sfx === ""), "effects only on the first piece");
  assert.equal(shots[0].line, "Short line.");
  // A shot cap keeps the whole line in the last piece.
  const capped = splitLongLines([{ ...base, id: "s1", line: long }], "en", 2);
  assert.equal(capped.length, 2);
  assert.equal(capped.map((p) => p.line).join(" "), long);
});

test("cost fixes (6 Nov 2026): long videos get one free re-render, retries re-charge the refunded render, dated prices", async () => {
  const { freeRerendersFor, rerenderCredits, retryRenderCredits } = await import("./rerender");
  const { priceFor } = await import("./usage");
  const { STOCK_SLOT_CREDITS, RENDER_CREDITS_PER_30S } = await import("./steps");
  const short = { video: { total_seconds: 60 }, render: { version: 2 } };
  const long = { video: { total_seconds: 600 }, render: { version: 1 } };
  assert.equal(freeRerendersFor(short), 1);
  assert.equal(rerenderCredits(short), RENDER_CREDITS_PER_30S * 2, "third re-render of a Short is charged (one free, 7 Nov)");
  assert.equal(rerenderCredits({ video: { total_seconds: 60 }, render: { version: 0 } }), 0, "first re-render is free");
  assert.equal(freeRerendersFor(long), 1);
  assert.equal(rerenderCredits(long), RENDER_CREDITS_PER_30S * 20, "second re-render of a 10-minute video is charged");
  assert.equal(retryRenderCredits({ render: { credits: 320 } }), 320);
  assert.equal(retryRenderCredits({ render: {} }), 0, "free-trial renders stay free");
  assert.equal(STOCK_SLOT_CREDITS, 2);
  const now = priceFor("gemini", "gemini-3.8-flash", new Date("2026-12-31T12:00:00Z")) as { inputPer1M: number };
  const later = priceFor("gemini", "gemini-3.8-flash", new Date("2027-01-02T00:00:00Z")) as { inputPer1M: number };
  assert.equal(now.inputPer1M, 0.75);
  assert.equal(later.inputPer1M, 1.5);
});
