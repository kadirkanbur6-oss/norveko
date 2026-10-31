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

test("pricing: every item keeps ≥ 60% margin at the Business-pack revenue per credit", async () => {
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
  for (const [name, credits, usd] of checks) assert.ok(margin(credits, usd) >= 0.6, `${name}: ${(margin(credits, usd) * 100).toFixed(1)}%`);
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

// --- YouTube direct upload (lib/youtube) ---
import { buildVideoResource, youtubeTitle, youtubeDescription, youtubeTags, validPublishAt, categoryForStyle } from "../youtube/metadata";
import { encryptToken, decryptToken, safeReturnTo } from "../youtube/oauth";

test("youtube: metadata is always valid for videos.insert", () => {
  const long = "Dyatlov Geçidi: ".repeat(12);
  const t = youtubeTitle(long);
  assert.ok(t.length <= 100 && t.endsWith("…"));
  assert.equal(youtubeTitle("A <b>bold</b> title"), "A bbold/b title");
  assert.ok(Buffer.byteLength(youtubeDescription("ğüşıöç".repeat(2000)), "utf8") <= 5000);
  const tags = youtubeTags(["#mystery", "Mystery", "cold case", ...Array.from({ length: 80 }, (_, i) => `tag number ${i}`)]);
  assert.equal(tags[0], "mystery");
  assert.ok(!tags.includes("Mystery"));
  const cost = tags.reduce((n, tag, i) => n + tag.length + (tag.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);
  assert.ok(cost <= 500);
  assert.equal(categoryForStyle("Educational"), "27");
  assert.equal(categoryForStyle("Horror"), "24");
});

test("youtube: scheduled uploads stay private until publishAt; AI disclosure is always on", () => {
  const now = Date.now();
  assert.equal(validPublishAt(new Date(now + 5 * 60_000).toISOString(), now), null);
  const later = new Date(now + 2 * 3600_000).toISOString();
  const r = buildVideoResource({ title: "x", privacy: "public", publishAt: later });
  assert.equal(r.status.privacyStatus, "private");
  assert.equal((r.status as { publishAt?: string }).publishAt, later);
  assert.equal(r.status.containsSyntheticMedia, true);
  assert.equal(r.status.selfDeclaredMadeForKids, false);
  assert.equal(buildVideoResource({ title: "x", privacy: "unlisted" }).status.privacyStatus, "unlisted");
});

test("youtube: refresh tokens are encrypted and return paths are same-site only", () => {
  process.env.YOUTUBE_TOKEN_KEY = "test-key";
  const enc = encryptToken("1//refresh-token");
  assert.ok(!enc.includes("refresh"));
  assert.equal(decryptToken(enc), "1//refresh-token");
  assert.notEqual(encryptToken("same"), encryptToken("same"));
  assert.equal(safeReturnTo("/projects/abc"), "/projects/abc");
  assert.equal(safeReturnTo("//evil.com"), "/settings");
  assert.equal(safeReturnTo("https://evil.com"), "/settings");
  assert.equal(safeReturnTo(null), "/settings");
});
