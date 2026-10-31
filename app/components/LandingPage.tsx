"use client";

import { LANGUAGE_OPTIONS } from "@/lib/pipeline/options";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import HeroDemo from "./HeroDemo";
import ShowcaseGallery from "./ShowcaseGallery";
import HeroBackground from "./HeroBackground";
import { NICHE_TEMPLATES } from "@/lib/pipeline/templates";
import SignOutButton from "./SignOutButton";
import BrandMark from "./BrandMark";
import { COMPARISON, FREE_TRIAL_CREDITS, PAID_INCLUDES, planDetails } from "@/lib/plans";
import {
  RESEARCH_CREDITS,
  SUBTITLES_CREDITS_PER_MIN,
  THUMBNAIL_CREDITS,
  VOICE_CREDITS_PER_MIN,
  scriptCredits,
} from "@/lib/pipeline/steps";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Crown,
  Minus,
  ChevronDown,
  Clapperboard,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  Menu,
  PlayCircle,
  MessageSquare,
  Search,
  Wand2,
  X,
  Zap,
} from "lucide-react";

/* ---------- Scroll reveal ---------- */

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`min-w-0 transition-all duration-700 ease-out ${
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ---------- UI helpers ---------- */

function GlassCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.05] ${className}`}
    >
      {children}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[3px] text-blue-300">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-gray-400">{subtitle}</p>}
    </div>
  );
}

/* ---------- Data ---------- */

const WORKFLOW_STEPS = [
  { icon: Lightbulb, label: "Idea" },
  { icon: FileText, label: "Script" },
  { icon: Layers, label: "Scene Plan" },
  { icon: Clapperboard, label: "Video Prompts" },
  { icon: ImageIcon, label: "Thumbnail" },
  { icon: Search, label: "SEO" },
];

const FORMATS = [
  "YouTube Shorts",
  "YouTube Long Form",
  "TikTok",
  "Instagram Reels",
  "Podcast",
  "Blog Post",
  "X / Twitter Thread",
  "LinkedIn",
];

const LANGUAGES = LANGUAGE_OPTIONS.map((l) => l.label);

// What a pack buys, from the single source of credit prices (steps.ts).

const PRICING = planDetails().map(({ pack, tagline, buys, featured }) => ({
  ...pack,
  buys,
  desc: tagline,
  featured,
}));

const FAQS = [
  {
    q: "Do I need my own API keys?",
    a: "No. Norveko runs on its own AI infrastructure. You sign up, get free credits and start generating immediately — no API keys, no setup.",
  },
  {
    q: "Which AI models does Norveko use?",
    a: "Norveko is powered by state-of-the-art large language models, tuned with production-grade prompts for content creation. You get the output — we handle the model layer.",
  },
  {
    q: "Does Norveko generate the video files?",
    a: "Every generation gives you the script, scene plan, cinematic video prompts, a generated thumbnail image and full SEO metadata. Add AI voiceover and word-timed subtitles (.srt/.vtt) with one toggle. Full MP4 rendering — AI visuals, voice and subtitles cut to a 30 or 60 second video like the examples above — is rolling out in beta.",
  },
  {
    q: "How does the credit system work?",
    a: `You get 50 free credits on signup. A 60-second content package with thumbnail costs ${scriptCredits("60 seconds") + THUMBNAIL_CREDITS} credits; web research adds ${RESEARCH_CREDITS}, a Norveko narrator ${VOICE_CREDITS_PER_MIN.gemini} per minute (ElevenLabs voices ${VOICE_CREDITS_PER_MIN.elevenlabs} per minute) and subtitles ${SUBTITLES_CREDITS_PER_MIN} per minute. The exact total is shown before you click Generate. Credits never expire, and if a step fails, the unfinished steps are refunded automatically while everything already produced is kept in your project.`,
  },
];

/* ---------- Page ---------- */

export default function LandingPage({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#0a0a12] text-white antialiased">
      {/* NAVBAR */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0a12]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" aria-label="Norveko home" className="flex items-center gap-2.5">
            <BrandMark size={36} />
            <span className="text-lg font-bold tracking-tight">NORVEKO</span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm text-gray-400 md:flex">
            <a href="#examples" className="transition hover:text-white">Examples</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#workflow" className="transition hover:text-white">Workflow</a>
            <a href="#templates" className="transition hover:text-white">Templates</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {isLoggedIn ? (
              <>
                <SignOutButton
                  className="hidden items-center gap-2 rounded-xl px-3 py-2 text-sm text-gray-400 transition hover:text-white sm:flex"
                />
                <Link
                  href="/dashboard"
                  className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold transition hover:opacity-90"
                >
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden rounded-xl px-4 py-2 text-sm text-gray-300 transition hover:text-white sm:inline-block"
                >
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold transition hover:opacity-90"
                >
                  Start Free
                </Link>
              </>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gray-300 transition hover:text-white md:hidden"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav className="border-t border-white/5 bg-[#0a0a12]/95 px-4 py-3 md:hidden">
            <div className="flex flex-col gap-1 text-sm text-gray-300">
              {[
                ["#examples", "Examples"],
                ["#pricing", "Pricing"],
                ["#workflow", "Workflow"],
                ["#templates", "Templates"],
                ["#faq", "FAQ"],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 transition hover:bg-white/5 hover:text-white"
                >
                  {label}
                </a>
              ))}
              {!isLoggedIn && (
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-2.5 transition hover:bg-white/5 hover:text-white sm:hidden"
                >
                  Log in
                </Link>
              )}
              {isLoggedIn && (
                <SignOutButton
                  onDone={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/5 hover:text-white sm:hidden"
                />
              )}
            </div>
          </nav>
        )}
      </header>

      {/* 1. HERO */}
      <section id="main-content" className="relative overflow-hidden">
        <HeroBackground />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[min(800px,120vw)] -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-start gap-10 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-2">
          <Reveal>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs text-blue-200">
                <Zap size={14} />
                One Prompt → Complete Content Package
              </span>

              <h1 className="mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                Your entire content pipeline.{" "}
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  One AI.
                </span>
              </h1>

              <p className="mt-4 max-w-lg text-base text-gray-400 sm:text-lg">
                Describe your video idea once. Norveko writes the script, plans
                every scene, generates cinematic video prompts, designs your
                thumbnail concept and handles SEO — in seconds.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3.5 font-semibold transition hover:opacity-90"
                >
                  Start Free — 50 credits
                  <ArrowRight size={18} />
                </Link>
                <a
                  href="#workflow"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3.5 font-semibold text-gray-300 transition hover:border-white/20 hover:text-white"
                >
                  See how it works
                </a>
              </div>

              <p className="mt-3 text-xs text-gray-500">
                No credit card required · 50 free credits on signup
              </p>
            </div>
          </Reveal>

          <Reveal delay={150}>
            <div className="relative mx-auto w-full max-w-[560px]">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-2xl" />
              <HeroDemo />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 2. TRUST STRIP + PLATFORMS */}
      <section className="border-y border-white/5 py-6">
        <Reveal>
          <div className="mx-auto grid max-w-6xl gap-3 px-4 sm:grid-cols-3 sm:px-6">
            {[
              ["Credits never expire", "Buy once, use whenever. No monthly reset."],
              ["Failed = refunded", "If a step fails, its credits come back automatically and the finished parts are kept."],
              ["See the cost first", "The exact credit price is shown before you click Generate."],
            ].map(([title, desc]) => (
              <div key={title} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <Check size={16} className="mt-0.5 shrink-0 text-green-400" />
                <div>
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mx-auto mt-6 flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 sm:px-6">
            <span className="text-xs uppercase tracking-[3px] text-gray-500">
              Built for creators on
            </span>
            {["YouTube", "TikTok", "Instagram", "LinkedIn", "X"].map((p) => (
              <span
                key={p}
                className="text-base font-semibold text-gray-500 transition hover:text-gray-300"
              >
                {p}
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* 2b. EXAMPLES — real outputs, untouched */}
      <section id="examples" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="Made with Norveko"
            title="One sentence in. A finished video out."
            subtitle="Real renders straight from the pipeline — AI visuals, voiceover and word-timed subtitles, no manual editing. Press play."
          />
        </Reveal>
        <Reveal delay={100} className="mt-8">
          <ShowcaseGallery />
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-gray-500">
            <PlayCircle size={14} className="text-blue-300" />
            Full video rendering is rolling out in beta. Every account already gets the script, scene plan, thumbnail, voiceover and subtitles.
          </p>
        </Reveal>
      </section>

      {/* 2c. PRICING — kept high: visitors look for the price right after the examples */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="Pricing"
            title="Start free. Scale when you're ready."
            subtitle={`Every account starts with ${FREE_TRIAL_CREDITS} free credits. One-time packs, no subscription — credits never expire.`}
          />
        </Reveal>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRICING.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 60}>
              <GlassCard
                className={`flex h-full flex-col p-5 ${
                  plan.featured ? "border-blue-400/40 bg-blue-500/[0.06]" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-bold">{plan.name}</h3>
                    <p className="mt-1 text-sm text-gray-400">{plan.desc}</p>
                  </div>
                  {plan.featured && (
                    <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-blue-200">
                      Popular
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-end gap-2">
                  <span className="text-3xl font-black tracking-tight text-white">
                    ${plan.priceUsd}
                  </span>
                  <span className="pb-1 text-sm text-gray-500">one-time</span>
                </div>

                <p className="mt-2 text-sm font-medium text-gray-300">
                  {plan.credits.toLocaleString()} credits
                </p>
                <ul className="mt-3 space-y-1.5 text-xs text-gray-300">
                  {plan.buys.map((line) => (
                    <li key={line} className="flex gap-1.5">
                      <Check size={13} className="mt-0.5 shrink-0 text-blue-300" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/signup"
                  className={`mt-5 inline-flex items-center justify-center rounded-xl px-4 py-3 text-sm font-semibold transition hover:opacity-90 ${
                    plan.featured
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                      : "border border-white/10 bg-white/[0.03] text-gray-200 hover:border-white/20 hover:text-white"
                  }`}
                >
                  Get started
                </Link>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 2d. WHY NORVEKO — premium comparison (ticks only for what we actually ship) */}
      <section id="compare" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-12 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#14142a] via-[#0e0e1c] to-[#0a0a12] p-5 shadow-[0_30px_80px_-30px_rgba(99,102,241,0.45)] sm:p-8">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-purple-600/20 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-blue-600/15 blur-3xl" />

            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-400/30 bg-yellow-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-yellow-200">
                  <Crown size={12} /> Why Norveko
                </span>
                <h2 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl">
                  Built for videos people trust — and finish.
                </h2>
                <p className="mt-2 max-w-xl text-sm text-gray-400">
                  Most AI video generators stop at &ldquo;a script and some stock clips&rdquo;. Norveko researches, checks and edits the story before a single frame is made.
                </p>
              </div>
            </div>

            <div className="relative mt-6 overflow-hidden rounded-2xl border border-white/10">
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-b border-white/10 bg-white/[0.04] px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 sm:gap-x-6 sm:px-6">
                <span>Feature</span>
                <span className="flex w-16 items-center justify-center gap-1 text-white sm:w-24">
                  <BrandMark size={16} /> Norveko
                </span>
                <span className="w-16 text-center sm:w-28">Typical AI tool</span>
              </div>
              {COMPARISON.map((row, i) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-[1fr_auto_auto] items-center gap-x-3 px-4 py-3 sm:gap-x-6 sm:px-6 ${
                    i % 2 ? "bg-white/[0.015]" : ""
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{row.feature}</span>
                    <span className="block text-xs text-gray-500">{row.detail}</span>
                  </span>
                  <span className="flex w-16 justify-center sm:w-24">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-400/40">
                      <CheckCircle2 size={18} className="text-emerald-400" aria-label="Included in Norveko" />
                    </span>
                  </span>
                  <span className="flex w-16 justify-center sm:w-28">
                    <Minus size={16} className="text-gray-600" aria-label="Usually not included" />
                  </span>
                </div>
              ))}
            </div>

            <div className="relative mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PAID_INCLUDES.slice(0, 3).map((line) => (
                <p key={line} className="flex gap-2 text-xs text-gray-300">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-400" />
                  {line}
                </p>
              ))}
            </div>
            <p className="relative mt-4 text-[11px] text-gray-500">
              &ldquo;Typical AI tool&rdquo; reflects what is commonly offered by script-to-video generators; individual tools vary.
            </p>
          </div>
        </Reveal>
      </section>

      {/* 3. PROBLEM */}
      <section className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="The Problem"
            title="Creating content shouldn't require 10 subscriptions."
            subtitle="A script tool here, a prompt tool there, an SEO tool somewhere else. Your ideas die in the tab chaos."
          />
        </Reveal>

        <div className="mt-8 grid items-center gap-6 lg:grid-cols-[1fr_auto_1fr]">
          <Reveal>
            <GlassCard className="p-5">
              <p className="text-sm font-semibold text-gray-400">The scattered way</p>
              <ul className="mt-3 space-y-2 text-sm text-gray-500">
                {[
                  "One tool for scripts",
                  "Another for video prompts",
                  "Another for thumbnail ideas",
                  "Another for titles & SEO",
                  "Copy-paste between 5+ tabs",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400/60" />
                    {item}
                  </li>
                ))}
              </ul>
            </GlassCard>
          </Reveal>

          <Reveal delay={100}>
            <div className="flex justify-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600">
                <ArrowRight size={20} className="rotate-90 lg:rotate-0" />
              </div>
            </div>
          </Reveal>

          <Reveal delay={200}>
            <GlassCard className="border-blue-400/30 p-5">
              <p className="text-sm font-semibold text-blue-200">The Norveko way</p>
              <ul className="mt-3 space-y-2 text-sm text-gray-300">
                {[
                  "One idea in",
                  "Script, scenes, prompts out",
                  "Thumbnail concept included",
                  "SEO title, description & tags",
                  "One workspace. One flow.",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3">
                    <Check size={15} className="shrink-0 text-green-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* 4. WORKFLOW */}
      <section id="workflow" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="Workflow"
            title="From idea to publish-ready. In one flow."
          />
        </Reveal>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {WORKFLOW_STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal key={step.label} delay={i * 60}>
                <GlassCard className="group h-full p-4 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-600/20 text-blue-300 transition group-hover:scale-110">
                    <Icon size={18} />
                  </div>
                  <p className="mt-2 text-[10px] font-bold text-gray-500">0{i + 1}</p>
                  <h3 className="mt-0.5 text-sm font-bold">{step.label}</h3>
                </GlassCard>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* 4b. NICHE TEMPLATES */}
      <section id="templates" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="Templates"
            title="Start from a niche that already works."
            subtitle="Each template pre-fills the platform, style and length and tunes the script to the genre's conventions."
          />
        </Reveal>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {NICHE_TEMPLATES.map((t, i) => (
            <Reveal key={t.id} delay={i * 50}>
              <Link
                href={isLoggedIn ? `/chat?template=${t.id}` : "/signup"}
                className="block h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-blue-400/40 hover:bg-blue-500/[0.06]"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-white">{t.name}</h3>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-gray-400">
                    {t.duration}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-400">{t.tagline}</p>
                <p className="mt-3 text-xs text-gray-500">
                  {t.platform} · {t.style}
                </p>
                <p className="mt-3 line-clamp-2 text-xs italic text-gray-500">e.g. “{t.examples[0]}”</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 5. AI WORKSPACE */}
      <section id="workspace" className="relative scroll-mt-20 overflow-hidden py-12">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[min(700px,120vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/10 blur-3xl" />

        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <Reveal>
            <div>
              <SectionTitle eyebrow="AI Workspace" title="Your creator command center." />
              <ul className="mx-auto mt-6 max-w-md space-y-3">
                {[
                  [MessageSquare, "AI Chat", "Generate full content packages conversationally."],
                  [Wand2, "Multi-language output", "English, Türkçe, Español, Deutsch, Français, Português."],
                  [Layers, "Projects", "Every generation saved, editable and organized."],
                  [Globe, "Cinematic video prompts", "Ready to paste into any AI video tool."],
                ].map(([Icon, title, desc]) => {
                  const IconComp = Icon as React.ElementType;
                  return (
                    <li key={title as string} className="flex gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-blue-300">
                        <IconComp size={18} />
                      </div>
                      <div>
                        <p className="font-semibold">{title as string}</p>
                        <p className="text-sm text-gray-400">{desc as string}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <GlassCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold">AI Workspace</span>
                <span className="rounded-full border border-green-400/30 bg-green-500/10 px-3 py-1 text-xs text-green-300">
                  Live
                </span>
              </div>
              <div className="space-y-2">
                {[
                  ["Script", "Full voice-over, hook-first structure"],
                  ["Scene Plan", "6 scenes · shot descriptions"],
                  ["Video Prompts", "Cinematic English prompts per scene"],
                  ["Titles", "5 click-optimized options"],
                  ["Tags & Description", "SEO-ready metadata"],
                ].map(([t, d]) => (
                  <div
                    key={t}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0d0d16] p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold">{t}</p>
                      <p className="text-xs text-gray-500">{d}</p>
                    </div>
                    <Check size={16} className="text-green-400" />
                  </div>
                ))}
              </div>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* 6. HOW IT WORKS */}
      <section className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle eyebrow="How it works" title="Three steps. That's it." />
        </Reveal>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["1", "Describe your idea", "One sentence is enough. Pick platform, style and duration."],
            ["2", "Norveko creates everything", "Script, scene plan, video prompts, thumbnail concept, SEO."],
            ["3", "Copy & publish", "Take your package to your editor and AI video tools."],
          ].map(([num, title, desc], i) => (
            <Reveal key={num} delay={i * 100}>
              <div className="relative">
                <span className="absolute -top-5 left-5 bg-gradient-to-br from-blue-400 to-purple-500 bg-clip-text text-6xl font-black text-transparent opacity-30">
                  {num}
                </span>
                <GlassCard className="relative h-full p-5 pt-8">
                  <h3 className="font-bold">{title}</h3>
                  <p className="mt-1.5 text-sm text-gray-400">{desc}</p>
                </GlassCard>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 7. FORMATS */}
      <section className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle eyebrow="Formats" title="Every format. Every platform." />
        </Reveal>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {FORMATS.map((f, i) => (
            <Reveal key={f} delay={i * 40}>
              <GlassCard className="p-3.5 text-center">
                <p className="text-sm font-semibold">{f}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 8. LANGUAGES (compact strip) */}
      <section className="border-y border-white/5 py-6">
        <Reveal>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-3 px-4 sm:px-6">
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <Globe size={16} className="text-blue-300" />
              Create in {LANGUAGES.length} languages:
            </span>
            {LANGUAGES.map((lang) => (
              <span
                key={lang}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-gray-300 sm:text-sm"
              >
                {lang}
              </span>
            ))}
          </div>
        </Reveal>
      </section>

      {/* 10. FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle eyebrow="FAQ" title="Questions, answered." />
        </Reveal>

        <div className="mt-8 space-y-2.5">
          {FAQS.map((faq, i) => (
            <Reveal key={faq.q} delay={i * 50}>
              <GlassCard className="overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="flex w-full items-center justify-between p-4 text-left"
                >
                  <span className="font-semibold">{faq.q}</span>
                  <ChevronDown
                    size={18}
                    className={`shrink-0 text-gray-500 transition-transform ${
                      openFaq === i ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {openFaq === i && (
                  <p className="px-4 pb-4 text-sm leading-relaxed text-gray-400">
                    {faq.a}
                  </p>
                )}
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 11. FINAL CTA */}
      <section className="relative overflow-hidden py-16">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[min(600px,120vw)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-blue-600/25 to-purple-600/25 blur-3xl" />
        <Reveal>
          <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-black sm:text-4xl lg:text-5xl">
              Ready to replace all your AI tools?
            </h2>
            <p className="mt-3 text-lg text-gray-400">
              One idea in. A complete content package out.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3.5 text-base font-bold sm:px-8 sm:py-4 sm:text-lg transition hover:opacity-90"
            >
              Start Free — 50 credits
              <ArrowRight size={20} />
            </Link>
            <p className="mt-3 text-xs text-gray-500">No credit card required</p>
          </div>
        </Reveal>
      </section>

      {/* 12. FOOTER */}
      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <Link href="/" aria-label="Norveko home" className="flex items-center gap-2">
            <BrandMark size={32} />
            <span className="font-bold">NORVEKO</span>
          </Link>
          <nav className="flex flex-wrap justify-center gap-6 gap-y-2 text-sm text-gray-500">
            <a href="#examples" className="transition hover:text-gray-300">Examples</a>
            <a href="#workflow" className="transition hover:text-gray-300">Workflow</a>
            <a href="#pricing" className="transition hover:text-gray-300">Pricing</a>
            <a href="#faq" className="transition hover:text-gray-300">FAQ</a>
            <Link href="/terms" className="transition hover:text-gray-300">Terms</Link>
            <Link href="/privacy" className="transition hover:text-gray-300">Privacy</Link>
            <Link href="/refund" className="transition hover:text-gray-300">Refunds</Link>
            <Link href="/login" className="transition hover:text-gray-300">Log in</Link>
          </nav>
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} Norveko. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}