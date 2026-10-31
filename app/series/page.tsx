"use client";

// Series autopilot: a topic + look + voice + schedule; Norveko picks a new
// subject for every episode, makes the video and publishes it.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, Pause, Play, Plus, Repeat, Trash2, Zap } from "lucide-react";
import Sidebar from "../components/Sidebar";
import { CaptionStylePicker, VisualStylePicker } from "../components/StylePickers";
import { LANGUAGE_OPTIONS, PLATFORMS, STYLES } from "@/lib/pipeline/options";
import { CADENCE_PRESETS } from "@/lib/series/schedule";

type Privacy = "public" | "unlisted" | "private";

interface Episode {
  id: string;
  scheduled_for: string;
  idea: string | null;
  status: string;
  error: string | null;
  project_id: string | null;
  publish: { youtube?: { url: string; privacy: string }; tiktok?: { status: string } } | null;
}

interface Series {
  id: string;
  name: string;
  topic: string;
  settings: Record<string, string | boolean>;
  days: number[];
  post_time: string;
  timezone: string;
  publish: { youtube?: { enabled: boolean; privacy: string }; tiktok?: { enabled: boolean; privacy: string } };
  active: boolean;
  cost: number;
  nextAt: string | null;
  episodes: Episode[];
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Starting", cls: "text-gray-300" },
  generating: { label: "Making the video", cls: "text-blue-300" },
  publishing: { label: "Publishing", cls: "text-blue-300" },
  published: { label: "Published", cls: "text-green-300" },
  ready: { label: "Ready", cls: "text-green-300" },
  publish_failed: { label: "Made, not published", cls: "text-yellow-300" },
  skipped: { label: "Skipped", cls: "text-yellow-300" },
  failed: { label: "Failed (refunded)", cls: "text-red-300" },
};
const TIKTOK_PRIVACY = [
  { id: "PUBLIC_TO_EVERYONE", label: "Everyone" },
  { id: "FOLLOWER_OF_CREATOR", label: "Followers" },
  { id: "MUTUAL_FOLLOW_FRIENDS", label: "Friends" },
  { id: "SELF_ONLY", label: "Only me" },
];

function emptyForm() {
  return {
    name: "",
    topic: "",
    platform: "YouTube Shorts",
    style: "Mystery",
    duration: "60 seconds",
    language: "English",
    visualStyle: "cinematic",
    captionStyle: "bold",
    voiceId: "gemini:Charon",
    footage: "hybrid",
    research: true,
    days: [1, 3, 5] as number[],
    time: "18:00",
    youtube: true,
    ytPrivacy: "public" as Privacy,
    tiktok: false,
    ttPrivacy: "",
    ttComment: false,
    ttDuet: false,
    ttStitch: false,
    ttConsent: false,
  };
}

export default function SeriesPage() {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [series, setSeries] = useState<Series[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [voices, setVoices] = useState<Array<{ voice_id: string; name: string }>>([]);
  const [connections, setConnections] = useState<{ youtube: boolean; tiktok: boolean }>({ youtube: false, tiktok: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);

  const load = useCallback(async () => {
    const d = await fetch("/api/series").then((r) => r.json()).catch(() => null);
    setLoading(false);
    if (!d?.success) return;
    setAvailable(d.available);
    setBlocked(d.blocked ?? null);
    setSeries(d.series ?? []);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    Promise.all([
      fetch("/api/youtube").then((r) => r.json()).catch(() => null),
      fetch("/api/tiktok").then((r) => r.json()).catch(() => null),
    ]).then(([yt, tt]) => setConnections({ youtube: Boolean(yt?.connection), tiktok: Boolean(tt?.connection) }));
  }, [load]);

  useEffect(() => {
    fetch(`/api/voices?language=${encodeURIComponent(form.language)}`)
      .then((r) => r.json())
      .then((d) => setVoices(d?.gemini ?? []))
      .catch(() => setVoices([]));
  }, [form.language]);

  // Refresh while an episode is in progress.
  useEffect(() => {
    const running = series.some((s) => s.episodes.some((e) => ["pending", "generating", "publishing"].includes(e.status)));
    if (!running) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [series, load]);

  const set = <K extends keyof ReturnType<typeof emptyForm>>(k: K, v: ReturnType<typeof emptyForm>[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function create() {
    setBusy("create");
    setError("");
    try {
      const res = await fetch("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          topic: form.topic,
          settings: {
            platform: form.platform,
            style: form.style,
            duration: form.duration,
            language: form.language,
            orientation: form.platform === "YouTube Long-form" ? "horizontal" : "vertical",
            visualStyle: form.visualStyle,
            captionStyle: form.captionStyle,
            voiceId: form.voiceId,
            footage: form.footage,
            research: form.research,
          },
          days: form.days,
          post_time: form.time,
          timezone,
          publish: {
            youtube: { enabled: form.youtube && connections.youtube, privacy: form.ytPrivacy },
            tiktok: {
              enabled: form.tiktok && connections.tiktok,
              privacy: form.ttPrivacy,
              allowComment: form.ttComment,
              allowDuet: form.ttDuet,
              allowStitch: form.ttStitch,
              consent: form.ttConsent,
            },
          },
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Could not save.");
      setShowForm(false);
      setForm(emptyForm());
      setNotice("Series created. The first episode is made before its next posting time.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  async function act(id: string, action: "pause" | "resume" | "run" | "delete") {
    setBusy(`${action}-${id}`);
    setError("");
    setNotice("");
    try {
      const res =
        action === "run"
          ? await fetch(`/api/series/${id}/run`, { method: "POST" })
          : action === "delete"
            ? await fetch(`/api/series/${id}`, { method: "DELETE" })
            : await fetch(`/api/series/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ active: action === "resume" }),
              });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Something went wrong.");
      if (action === "run") setNotice("Episode started — it takes about 10 minutes and is published as soon as it's ready.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const input = "w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-blue-400/50";

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0a0a12] text-white">
      <Sidebar />
      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
                <Repeat className="text-blue-300" aria-hidden />
              </div>
              <div>
                <h1 className="text-2xl font-bold">Series</h1>
                <p className="text-sm text-gray-400">Autopilot: a new video on your schedule, made and published for you.</p>
              </div>
            </div>
            {available && !blocked && !showForm && (
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2.5 text-sm font-semibold text-white"
              >
                <Plus size={16} aria-hidden /> New series
              </button>
            )}
          </div>

          {loading ? (
            <div className="mt-16 flex justify-center">
              <Loader2 size={32} className="animate-spin text-blue-300" />
            </div>
          ) : !available ? (
            <p className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-400">Series are coming soon.</p>
          ) : (
            <>
              {blocked && (
                <div className="mt-8 rounded-xl border border-purple-400/30 bg-purple-500/10 p-4 text-sm text-gray-200">
                  {blocked}{" "}
                  {blocked.includes("pack") && (
                    <Link href="/billing" className="font-semibold text-purple-200 hover:text-white">
                      See packs →
                    </Link>
                  )}
                </div>
              )}
              {notice && <p className="mt-6 rounded-xl border border-green-400/30 bg-green-500/10 p-3 text-sm text-green-300">{notice}</p>}
              {error && <p className="mt-6 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

              {showForm && (
                <div className="mt-8 space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <h2 className="font-semibold">New series</h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="s-name" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Name</label>
                      <input id="s-name" value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Unsolved mysteries" className={input} />
                    </div>
                    <div>
                      <label htmlFor="s-lang" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Language</label>
                      <select id="s-lang" value={form.language} onChange={(e) => set("language", e.target.value)} className={input}>
                        {LANGUAGE_OPTIONS.map((l) => (
                          <option key={l.label} value={l.label}>
                            {l.flag} {l.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="s-topic" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">What is the series about?</label>
                    <textarea
                      id="s-topic"
                      rows={3}
                      maxLength={1000}
                      value={form.topic}
                      onChange={(e) => set("topic", e.target.value)}
                      placeholder="Real unsolved disappearances and mysteries from the 20th century — one case per episode."
                      className={input}
                    />
                    <p className="mt-1 text-xs text-gray-500">Norveko picks a new, specific subject for every episode and never repeats one.</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div>
                      <label htmlFor="s-platform" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Platform</label>
                      <select id="s-platform" value={form.platform} onChange={(e) => set("platform", e.target.value)} className={input}>
                        {PLATFORMS.map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="s-style" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Style</label>
                      <select id="s-style" value={form.style} onChange={(e) => set("style", e.target.value)} className={input}>
                        {STYLES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="s-duration" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Length</label>
                      <select id="s-duration" value={form.duration} onChange={(e) => set("duration", e.target.value)} className={input}>
                        <option>30 seconds</option>
                        <option>60 seconds</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="s-voice" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Narrator</label>
                      <select id="s-voice" value={form.voiceId} onChange={(e) => set("voiceId", e.target.value)} className={input}>
                        {voices.map((v) => (
                          <option key={v.voice_id} value={v.voice_id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <VisualStylePicker value={form.visualStyle} onChange={(v) => set("visualStyle", v)} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="s-footage" className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Footage</label>
                      <select id="s-footage" value={form.footage} onChange={(e) => set("footage", e.target.value)} className={input}>
                        <option value="hybrid">Hybrid — AI clips + stills</option>
                        <option value="stills">Stills with camera motion</option>
                        <option value="cinematic">Cinematic — every scene a clip</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 self-end pb-3 text-sm text-gray-300">
                      <input type="checkbox" checked={form.research} onChange={(e) => set("research", e.target.checked)} className="h-4 w-4 accent-blue-500" />
                      Research every topic on the web first
                    </label>
                  </div>
                  <CaptionStylePicker value={form.captionStyle} onChange={(v) => set("captionStyle", v)} />

                  {/* Schedule */}
                  <div className="rounded-xl border border-white/10 bg-[#0d0d16] p-4">
                    <p className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
                      <CalendarClock size={13} aria-hidden /> Schedule
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {CADENCE_PRESETS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => set("days", [...c.days])}
                          className="rounded-full border border-white/10 px-3 py-1 text-xs text-gray-300 hover:border-white/30"
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Days">
                      {DAY.map((d, i) => {
                        const on = form.days.includes(i);
                        return (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={on}
                            onClick={() => set("days", on ? form.days.filter((x) => x !== i) : [...form.days, i])}
                            className={`h-9 w-12 rounded-lg border text-sm ${on ? "border-blue-400/60 bg-blue-500/15 text-white" : "border-white/10 text-gray-400"}`}
                          >
                            {d}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-300">
                      Post at
                      <input
                        type="time"
                        value={form.time}
                        onChange={(e) => set("time", e.target.value)}
                        aria-label="Posting time"
                        className="rounded-lg border border-white/10 bg-[#12121c] px-2 py-1 text-white [color-scheme:dark]"
                      />
                      <span className="text-xs text-gray-500">{timezone}</span>
                    </div>
                  </div>

                  {/* Publishing */}
                  <div className="rounded-xl border border-white/10 bg-[#0d0d16] p-4 space-y-3">
                    <p className="text-xs uppercase tracking-wider text-gray-500">Publish to</p>
                    {connections.youtube ? (
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        <label className="flex items-center gap-2 text-gray-300">
                          <input type="checkbox" checked={form.youtube} onChange={(e) => set("youtube", e.target.checked)} className="h-4 w-4 accent-red-500" />
                          YouTube (scheduled for the posting time)
                        </label>
                        {form.youtube && (
                          <select value={form.ytPrivacy} onChange={(e) => set("ytPrivacy", e.target.value as Privacy)} aria-label="YouTube visibility" className="rounded-lg border border-white/10 bg-[#12121c] px-2 py-1 text-white">
                            <option value="public">Public</option>
                            <option value="unlisted">Unlisted</option>
                            <option value="private">Private</option>
                          </select>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">
                        YouTube not connected — <Link href="/settings" className="text-blue-300">connect it in Settings</Link>.
                      </p>
                    )}
                    {connections.tiktok ? (
                      <div className="space-y-2 text-sm">
                        <label className="flex items-center gap-2 text-gray-300">
                          <input type="checkbox" checked={form.tiktok} onChange={(e) => set("tiktok", e.target.checked)} className="h-4 w-4 accent-pink-500" />
                          TikTok (posted as soon as each video is ready)
                        </label>
                        {form.tiktok && (
                          <div className="ml-6 space-y-2">
                            <select value={form.ttPrivacy} onChange={(e) => set("ttPrivacy", e.target.value)} aria-label="Who can view the TikTok posts" className="rounded-lg border border-white/10 bg-[#12121c] px-2 py-1 text-white">
                              <option value="" disabled>
                                Who can view…
                              </option>
                              {TIKTOK_PRIVACY.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.label}
                                </option>
                              ))}
                            </select>
                            <div className="flex flex-wrap gap-4 text-gray-300">
                              <label className="flex items-center gap-2"><input type="checkbox" checked={form.ttComment} onChange={(e) => set("ttComment", e.target.checked)} className="h-4 w-4 accent-pink-500" />Comments</label>
                              <label className="flex items-center gap-2"><input type="checkbox" checked={form.ttDuet} onChange={(e) => set("ttDuet", e.target.checked)} className="h-4 w-4 accent-pink-500" />Duet</label>
                              <label className="flex items-center gap-2"><input type="checkbox" checked={form.ttStitch} onChange={(e) => set("ttStitch", e.target.checked)} className="h-4 w-4 accent-pink-500" />Stitch</label>
                            </div>
                            <label className="flex items-start gap-2 text-xs text-gray-300">
                              <input type="checkbox" checked={form.ttConsent} onChange={(e) => set("ttConsent", e.target.checked)} className="mt-0.5 h-4 w-4 accent-pink-500" />
                              <span>
                                By posting, you agree to TikTok&apos;s{" "}
                                <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="text-pink-300 underline">
                                  Music Usage Confirmation
                                </a>
                                . Posts are labelled as AI-generated.
                              </span>
                            </label>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-500">
                        TikTok not connected — <Link href="/settings" className="text-blue-300">connect it in Settings</Link>.
                      </p>
                    )}
                    <p className="text-xs text-gray-500">Nothing selected? Episodes are saved to Projects for you to post yourself.</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={create}
                      disabled={busy === "create"}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy === "create" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Repeat size={16} aria-hidden />}
                      Start series
                    </button>
                    <button type="button" onClick={() => setShowForm(false)} className="text-sm text-gray-400 hover:text-white">
                      Cancel
                    </button>
                    <span className="text-xs text-gray-500">Each episode is charged like a normal full video when it is made.</span>
                  </div>
                </div>
              )}

              {!series.length && !showForm && !blocked && (
                <div className="mt-8 rounded-2xl border border-dashed border-white/15 p-8 text-center text-sm text-gray-400">
                  No series yet. Create one and Norveko will make and post a new video on your schedule.
                </div>
              )}

              <div className="mt-8 space-y-4">
                {series.map((s) => (
                  <div key={s.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="font-semibold">
                          {s.name}{" "}
                          <span className={`ml-1 rounded-full px-2 py-0.5 text-[11px] ${s.active ? "bg-green-500/15 text-green-300" : "bg-white/10 text-gray-400"}`}>
                            {s.active ? "Active" : "Paused"}
                          </span>
                        </h2>
                        <p className="mt-1 line-clamp-2 text-sm text-gray-400">{s.topic}</p>
                        <p className="mt-2 text-xs text-gray-500">
                          {s.days.map((d) => DAY[d]).join(", ")} at {s.post_time} ({s.timezone}) · {String(s.settings.duration)} · {s.cost} credits / episode
                          {s.publish.youtube?.enabled ? " · YouTube" : ""}
                          {s.publish.tiktok?.enabled ? " · TikTok" : ""}
                        </p>
                        {s.nextAt && <p className="mt-1 text-xs text-blue-300">Next episode: {new Date(s.nextAt).toLocaleString()}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => act(s.id, "run")}
                          disabled={busy !== null || Boolean(blocked)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 hover:border-blue-400/50 disabled:opacity-40"
                        >
                          {busy === `run-${s.id}` ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Zap size={13} aria-hidden />} Make one now
                        </button>
                        <button
                          type="button"
                          onClick={() => act(s.id, s.active ? "pause" : "resume")}
                          disabled={busy !== null}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-200 hover:border-white/30 disabled:opacity-40"
                        >
                          {s.active ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />} {s.active ? "Pause" : "Resume"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete the series "${s.name}"? Videos already made stay in Projects.`)) void act(s.id, "delete");
                          }}
                          disabled={busy !== null}
                          aria-label={`Delete ${s.name}`}
                          className="inline-flex items-center rounded-lg border border-white/10 px-2 py-1.5 text-xs text-gray-400 hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </div>
                    </div>
                    {s.episodes.length > 0 && (
                      <ul className="mt-4 divide-y divide-white/5 rounded-xl border border-white/10 bg-[#0d0d16] text-sm">
                        {s.episodes.map((e) => {
                          const st = STATUS[e.status] ?? { label: e.status, cls: "text-gray-300" };
                          return (
                            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-gray-200">{e.idea ?? "Picking a subject…"}</p>
                                <p className="text-xs text-gray-500">
                                  {new Date(e.scheduled_for).toLocaleString()} · <span className={st.cls}>{st.label}</span>
                                  {e.error ? ` — ${e.error}` : ""}
                                </p>
                              </div>
                              <div className="flex gap-3 text-xs">
                                {e.project_id && (
                                  <Link href={`/projects/${e.project_id}`} className="text-blue-300 hover:text-blue-200">
                                    Project
                                  </Link>
                                )}
                                {e.publish?.youtube?.url && (
                                  <a href={e.publish.youtube.url} target="_blank" rel="noreferrer" className="text-red-300 hover:text-red-200">
                                    YouTube
                                  </a>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
