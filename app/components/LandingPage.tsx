"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import HeroDemo from "./HeroDemo";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clapperboard,
  FileText,
  Globe,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  MessageSquare,
  Search,
  Sparkles,
  Wand2,
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
      className={`transition-all duration-700 ease-out ${
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

const LANGUAGES = ["English", "Türkçe", "Español", "Deutsch", "Français", "Português"];

const PRICING = [
  { name: "Starter", desc: "For creators trying things out." },
  { name: "Creator", desc: "For consistent weekly publishing.", featured: true },
  { name: "Pro", desc: "For high-volume channels." },
  { name: "Enterprise", desc: "For teams and agencies." },
];

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
    a: "Not yet. Today, Norveko generates everything around the video: script, scene plan, cinematic video prompts (ready to paste into AI video tools), thumbnail concept and full SEO. Native video and voice generation are on our roadmap.",
  },
  {
    q: "How does the credit system work?",
    a: "You get 50 free credits when you sign up. Each full content generation costs 5 credits. If a generation fails, your credits are automatically refunded.",
  },
];

/* ---------- Page ---------- */

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-[#0a0a12] text-white antialiased">
      {/* NAVBAR */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0a12]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
              <Sparkles size={18} />
            </div>
            <span className="text-lg font-bold tracking-tight">NORVEKO</span>
          </div>

          <nav className="hidden items-center gap-8 text-sm text-gray-400 md:flex">
            <a href="#workflow" className="transition hover:text-white">Workflow</a>
            <a href="#workspace" className="transition hover:text-white">AI Workspace</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-xl px-4 py-2 text-sm text-gray-300 transition hover:text-white"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold transition hover:opacity-90"
            >
              Start Free
            </Link>
          </div>
        </div>
      </header>

      {/* 1. HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-3xl" />

        <div className="mx-auto grid max-w-6xl items-start gap-10 px-6 py-12 lg:grid-cols-2">
          <Reveal>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs text-blue-200">
                <Zap size={14} />
                One Prompt → Complete Content Package
              </span>

              <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
                Your entire content pipeline.{" "}
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  One AI.
                </span>
              </h1>

              <p className="mt-4 max-w-lg text-lg text-gray-400">
                Describe your video idea once. Norveko writes the script, plans
                every scene, generates cinematic video prompts, designs your
                thumbnail concept and handles SEO — in seconds.
              </p>

              <div className="mt-6 flex flex-wrap gap-4">
                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3.5 font-semibold transition hover:opacity-90"
                >
                  Start Free — 50 credits
                  <ArrowRight size={18} />
                </Link>
                <a
                  href="#workflow"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3.5 font-semibold text-gray-300 transition hover:border-white/20 hover:text-white"
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
            <div className="relative">
              <div className="absolute -inset-4 rounded-3xl bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-2xl" />
              <HeroDemo />
            </div>
          </Reveal>
        </div>
      </section>

      {/* 2. PLATFORMS */}
      <section className="border-y border-white/5 py-6">
        <Reveal>
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6">
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

      {/* 3. PROBLEM */}
      <section className="mx-auto max-w-6xl scroll-mt-20 px-6 py-12">
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
      <section id="workflow" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-12">
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
                  <p className="mt-2 text-[10px] font-bold text-gray-600">0{i + 1}</p>
                  <h3 className="mt-0.5 text-sm font-bold">{step.label}</h3>
                </GlassCard>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* 5. AI WORKSPACE */}
      <section id="workspace" className="relative scroll-mt-20 overflow-hidden py-12">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/10 blur-3xl" />

        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 lg:grid-cols-2">
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
      <section className="mx-auto max-w-6xl scroll-mt-20 px-6 py-12">
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
      <section className="mx-auto max-w-6xl scroll-mt-20 px-6 py-12">
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
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-3 px-6">
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-300">
              <Globe size={16} className="text-blue-300" />
              Create in 6 languages:
            </span>
            {LANGUAGES.map((lang) => (
              <span
                key={lang}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-sm text-gray-300"
              >
                {lang}
              </span>
            ))}
            <span className="text-sm text-gray-500">More coming.</span>
          </div>
        </Reveal>
      </section>

      {/* 9. PRICING */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-6 py-12">
        <Reveal>
          <SectionTitle
            eyebrow="Pricing"
            title="Start free. Scale when you're ready."
            subtitle="Every account starts with 50 free credits. Paid plans are launching soon."
          />
        </Reveal>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PRICING.map((plan, i) => (
            <Reveal key={plan.name} delay={i * 60}>
              <GlassCard
                className={`flex h-full flex-col p-5 ${
                  plan.featured ? "border-blue-400/40 bg-blue-500/[0.06]" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-bold">{plan.name}</h3>
                  <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-purple-200">
                    Coming soon
                  </span>
                </div>
                <p className="mt-2 flex-1 text-sm text-gray-400">{plan.desc}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 10. FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-6 py-12">
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
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-blue-600/25 to-purple-600/25 blur-3xl" />
        <Reveal>
          <div className="relative mx-auto max-w-3xl px-6 text-center">
            <h2 className="text-4xl font-black sm:text-5xl">
              Ready to replace all your AI tools?
            </h2>
            <p className="mt-3 text-lg text-gray-400">
              One idea in. A complete content package out.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-8 py-4 text-lg font-bold transition hover:opacity-90"
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
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
              <Sparkles size={15} />
            </div>
            <span className="font-bold">NORVEKO</span>
          </div>
          <nav className="flex gap-6 text-sm text-gray-500">
            <a href="#workflow" className="transition hover:text-gray-300">Workflow</a>
            <a href="#pricing" className="transition hover:text-gray-300">Pricing</a>
            <a href="#faq" className="transition hover:text-gray-300">FAQ</a>
            <Link href="/login" className="transition hover:text-gray-300">Log in</Link>
          </nav>
          <p className="text-xs text-gray-600">
            © {new Date().getFullYear()} Norveko. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}