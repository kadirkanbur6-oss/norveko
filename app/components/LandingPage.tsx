"use client";

import { LANGUAGE_OPTIONS } from "@/lib/pipeline/options";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import HeroDemo from "./HeroDemo";
import ShowcaseGallery from "./ShowcaseGallery";
import ShortsDemo from "./ShortsDemo";
import HeroBackground from "./HeroBackground";
import { NICHE_TEMPLATES } from "@/lib/pipeline/templates";
import ThemeToggle from "./ThemeToggle";
import TutorialButton from "./TutorialButton";
import SignOutButton from "./SignOutButton";
import BrandMark from "./BrandMark";
import { LEGAL_NAME, SUPPORT_EMAIL } from "@/app/lib/legal";
import { FREE_CREDITS_BUY, FREE_TRIAL_CREDITS, TRIAL_VIDEO_PUBLIC, WHY_NORVEKO, planDetails } from "@/lib/plans";
import SubscriptionPlans from "./SubscriptionPlans";
import { CREATIVE_COSTS } from "@/lib/skit/pricing";
import {
  RESEARCH_CREDITS,
  SUBTITLES_CREDITS_PER_MIN,
  THUMBNAIL_CREDITS,
  VOICE_CREDITS_PER_MIN,
  scriptCredits,
} from "@/lib/pipeline/steps";
import { JOB_COSTS } from "@/lib/plans";
import {
  ArrowRight,
  Drama,
  MessageCircle,
  Music,
  Check,
  CheckCircle2,
  CalendarClock,
  ChevronDown,
  Film,
  Globe,
  Languages,
  Scissors,
  SlidersHorizontal,
  UserRound,
  Menu,
  PlayCircle,
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
      { threshold: 0.05, rootMargin: "0px 0px 12% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`min-w-0 transition-all duration-500 ease-out motion-reduce:transition-none ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100"
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
  title,
  subtitle,
}: {
  /** Kept for call sites; not shown (all-caps eyebrow labels read as templated). */
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <h2 className="text-3xl font-bold text-white sm:text-4xl">{title}</h2>
      {subtitle && <p className="mt-3 text-gray-400">{subtitle}</p>}
    </div>
  );
}

/* ---------- Data ---------- */

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
    q: "Does Norveko make the actual video file?",
    a: "Yes. Type the idea and you get a finished MP4 with a researched script, narration, AI visuals or stock footage, music, word-timed subtitles and a thumbnail, as a 30 or 60-second Short or a 3 or 10-minute long-form video. You can also turn a joke into an animated skit or make an invented character say your line. If you only want the script, voiceover and thumbnail, turn the video off and pay less.",
  },
  {
    q: "What do my free credits get me?",
    a: `${FREE_TRIAL_CREDITS} free credits on signup, no card needed: ${FREE_CREDITS_BUY}.${TRIAL_VIDEO_PUBLIC ? " Your first 30-second video is free on top of that." : ""} Free-trial thumbnails and videos carry a small Norveko watermark; any plan or pack removes it, also from what you already made.`,
  },
  {
    q: "How does the credit system work?",
    a: `Everything is priced in credits and the exact total is shown before you click Generate. A 60-second content package with research, narration and subtitles is ${JOB_COSTS.package60} credits; a finished 60-second video is about ${JOB_COSTS.video60} (${JOB_COSTS.video30} for 30 seconds); web research adds ${RESEARCH_CREDITS}, a thumbnail ${THUMBNAIL_CREDITS}, a Norveko narrator ${VOICE_CREDITS_PER_MIN.gemini} per minute (native voice artists ${VOICE_CREDITS_PER_MIN.elevenlabs}), subtitles ${SUBTITLES_CREDITS_PER_MIN} per minute and a 60-second script ${scriptCredits("60 seconds")}. Pack credits don't expire while your account is active; plan credits refresh every period.`,
  },
  {
    q: "What if something fails?",
    a: "You only pay for what was delivered. If a step fails, the credits for everything that didn't finish come back automatically, and the parts that did finish (script, voiceover, thumbnail) are kept in your project. A failed final render can be retried from the project page; the visuals are kept, so you only pay the render price again.",
  },
  {
    q: "How long does a video take?",
    a: "A 30 or 60-second video is usually ready in 5–10 minutes; long-form videos take longer. You can close the tab: the progress is saved and the video waits in Projects.",
  },
  {
    q: "Can I use the videos commercially?",
    a: "Yes, on a paid plan or pack: everything you generate is yours to publish and monetise on YouTube, TikTok, Instagram or anywhere else, and that also covers what you made earlier on free credits. Free accounts are for personal, non-commercial use and carry a small watermark. Background music is licensed; its credit line is added to the description for you.",
  },
  {
    q: "Can I review or edit before publishing?",
    a: "Yes. Turn on \"Review the script first\" and nothing is filmed until you approve the script and scenes. After rendering, the timeline editor lets you replace a scene's picture or clip, re-time cuts, fix subtitle lines and re-render.",
  },
  {
    q: "Who are the characters in my videos?",
    a: "Invented ones. You describe a character, such as a cartoon chick, a talking dog or a grumpy Bigfoot, and Norveko draws it and keeps the same look in every scene. Norveko has no face swap, no voice cloning and no likeness features: characters and voices are created by Norveko, not taken from real individuals.",
  },
  {
    q: "Which languages and voices?",
    a: `Scripts and narration in ${LANGUAGE_OPTIONS.length} languages. Norveko narrators speak all of them; native voice artists are available per language, and every voice is a licensed Norveko or studio voice.`,
  },
  {
    q: "Which AI models does Norveko use?",
    a: "The best model for each step, updated as better ones appear: OpenAI and Google models for research and writing, Google and ElevenLabs voices, Google image models for scenes and thumbnails, Seedance and Veo for motion, Google Lyria for ambient music, and a cloud render farm for the final cut. You never need your own API keys.",
  },
  {
    q: "Can I get a refund?",
    a: "Unused credit packs can be refunded within 14 days of purchase; subscriptions can be cancelled anytime and stop at the end of the period. Failed generations are refunded automatically. See the refund policy for the details.",
  },
];

/* ---------- Page ---------- */

export default function LandingPage({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[var(--nv-bg)] text-white antialiased">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "Norveko",
              url: "https://norveko.app",
              applicationCategory: "MultimediaApplication",
              operatingSystem: "Web",
              description:
                "AI content workspace for creators: turn one idea into a researched, narrated video, an animated skit or a talking character, rendered as a finished MP4 for YouTube, TikTok and Instagram.",
              offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: "12", highPrice: "89" },
            },
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: FAQS.map((f) => ({
                "@type": "Question",
                name: f.q,
                acceptedAnswer: { "@type": "Answer", text: f.a },
              })),
            },
          ]).replace(/</g, "\\u003c"),
        }}
      />
      {/* NAVBAR */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[var(--nv-bg)]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" aria-label="Norveko home" className="flex items-center gap-2.5">
            <BrandMark size={36} />
            <span className="text-lg font-bold tracking-tight">NORVEKO</span>
          </Link>

          <nav className="hidden items-center gap-6 whitespace-nowrap text-sm text-gray-400 lg:flex xl:gap-8">
            <a href="#examples" className="transition hover:text-white">Examples</a>
            <a href="#pricing" className="transition hover:text-white">Pricing</a>
            <a href="#workflow" className="transition hover:text-white">How it works</a>
            <a href="#templates" className="transition hover:text-white">Templates</a>
            <a href="#faq" className="transition hover:text-white">FAQ</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle labelClass="hidden sm:inline" />
            {isLoggedIn ? (
              <>
                <SignOutButton
                  className="hidden items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm text-gray-400 transition hover:text-white sm:flex"
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
                  className="hidden whitespace-nowrap rounded-xl px-4 py-2 text-sm text-gray-300 transition hover:text-white sm:inline-block"
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
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-gray-300 transition hover:text-white lg:hidden"
            >
              {menuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav className="border-t border-white/5 bg-[var(--nv-bg)]/95 px-4 py-3 lg:hidden">
            <div className="flex flex-col gap-1 text-sm text-gray-300">
              {[
                ["#examples", "Examples"],
                ["#pricing", "Pricing"],
                ["#workflow", "How it works"],
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
              <ThemeToggle className="justify-start rounded-lg px-3 py-2.5 text-gray-300" />
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
      <section id="main-content" className="nv-dark relative overflow-hidden">
        <HeroBackground />
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[min(800px,120vw)] -translate-x-1/2 rounded-full bg-gradient-to-r from-blue-600/20 to-purple-600/20 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-start gap-10 px-4 py-10 sm:px-6 sm:py-12 lg:grid-cols-2">
          <Reveal>
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs text-blue-200">
                <Zap size={14} />
                One idea → a finished video
              </span>

              <h1 className="mt-5 text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                Write the idea.{" "}
                <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                  Get the video.
                </span>
              </h1>

              <p className="mt-4 max-w-lg text-base text-gray-400 sm:text-lg">
                Norveko researches your topic, writes the script, voices it, adds
                visuals, music and a thumbnail, and renders the MP4. It also turns
                a joke into an animated skit or makes a character talk. You get
                a finished MP4 and thumbnail, ready to post on YouTube, TikTok or Instagram.
              </p>

              <ul className="mt-5 flex max-w-lg flex-wrap gap-2 text-xs text-gray-300" aria-label="What Norveko can make">
                {["Narrated videos up to 10 min", "Animated skits", "Talking characters", "You as a character", "29 languages"].map((t) => (
                  <li key={t} className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                    {t}
                  </li>
                ))}
              </ul>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3.5 font-semibold transition hover:opacity-90"
                >
                  Start free with {FREE_TRIAL_CREDITS} credits
                  <ArrowRight size={18} />
                </Link>
              </div>

              <TutorialButton variant="card" label="Watch how Norveko works" className="mt-4 max-w-md" />

              <p className="mt-3 text-xs text-gray-400">
                No credit card required · {FREE_TRIAL_CREDITS} free credits{TRIAL_VIDEO_PUBLIC ? " + a free video" : ""} on signup (≈ {FREE_CREDITS_BUY.split(", or ")[0]})
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
              ["Pack credits don't reset", "Buy once, use whenever while your account is active. No monthly reset."],
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
            <span className="text-sm text-gray-400">
              Built for creators on
            </span>
            {["YouTube", "TikTok", "Instagram", "LinkedIn", "X"].map((p) => (
              <span
                key={p}
                className="text-base font-semibold text-gray-400 transition hover:text-gray-300"
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
            subtitle="Real renders straight from Norveko: a narrated story, an animated skit and two talking characters, one of them made from a single selfie. No manual editing. Press play."
          />
        </Reveal>
        <Reveal delay={100} className="mt-8">
          <ShowcaseGallery />
        </Reveal>
        <Reveal delay={200}>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-gray-400">
            <PlayCircle size={14} className="text-blue-300" />
            {TRIAL_VIDEO_PUBLIC
              ? `Your first 30-second video is on us, no credits needed. Then ${FREE_TRIAL_CREDITS} free credits for ${FREE_CREDITS_BUY}.`
              : `Every account starts with ${FREE_TRIAL_CREDITS} free credits: ${FREE_CREDITS_BUY}.${process.env.NEXT_PUBLIC_FULL_VIDEO_ENABLED === "true" ? "" : " Finished-video rendering is being switched on account by account."}`}
          </p>
        </Reveal>
      </section>

      {/* 2b''. LONG VIDEO TO SHORTS — a real 3-minute video and the Short cut from it (7 Nov 2026) */}
      <section id="shorts" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="One video, many Shorts"
            title="Cut your long video into Shorts in one click"
            subtitle="Norveko reads the timed narration, picks the moments that stand on their own, writes a hook for each and renders them as vertical Shorts. This is a real run."
          />
        </Reveal>
        <Reveal delay={100} className="mt-8">
          <ShortsDemo />
        </Reveal>
      </section>

      {/* 2b. MORE THAN NARRATION — skits, talking characters, ambient music (swap removed 13 Nov 2026) */}
      <section id="studios" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="Beyond narration"
            title="Skits, talking characters and more"
            subtitle="The formats behind today's viral Shorts. Write it once and Norveko casts, voices and animates it."
          />
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Drama,
              title: "Skits with dialogue",
              body: "Paste a joke or a scene with its lines and say how it should look: talking cockroaches, cats, anime. Every character gets a voice, lip-synced shots, crowd shouts and music.",
              cost: `≈ ${CREATIVE_COSTS.skit20} credits for a 20 s skit`,
              href: "/chat?mode=skit",
            },
            {
              icon: MessageCircle,
              title: "Talking characters",
              body: "An invented character, like a cartoon chick or a grumpy Bigfoot, says your line to the camera in a Norveko character voice.",
              cost: `≈ ${CREATIVE_COSTS.talk10} credits for 10 s`,
              href: "/chat?mode=talk",
            },
            {
              icon: Music,
              title: "Ambient music videos",
              body: "Describe a mood and a place. Norveko composes original music, paints the scenes and renders a calm video from 10 minutes to 2 hours.",
              cost: `≈ ${CREATIVE_COSTS.ambient60} credits for 60 min`,
              href: "/chat?mode=ambient",
            },
          ].map((c, i) => (
            <Reveal key={c.title} delay={100 + i * 80}>
              <Link href={c.href} className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-blue-400/40">
                <c.icon size={22} className="text-blue-300" aria-hidden />
                <h3 className="mt-4 text-lg font-semibold text-white">{c.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-gray-400">{c.body}</p>
                <p className="mt-4 text-xs text-gray-400">{c.cost}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 2b'. BEYOND ONE VIDEO — what Norveko does beyond one video (7 Nov 2026) */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="Built for creators"
            title="Everything after the first video, too"
            subtitle="Keep the same characters, make it in other languages, cut Shorts, make new episodes on a schedule. All in the same place."
          />
        </Reveal>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: UserRound,
              title: "Recurring characters",
              body: "Describe an invented character once, like a cartoon fox or a robot host. It keeps the same look in every scene, as a presenter or in a skit.",
            },
            {
              icon: Film,
              title: "Documentaries up to 10 minutes",
              body: "Long stories with cited research, real archive photos from Wikimedia Commons (public domain and CC BY only), stock footage and animated maps.",
            },
            {
              icon: Languages,
              title: "One click into another language",
              body: `Translate a finished video: new script, voice and subtitles in any of ${LANGUAGE_OPTIONS.length} languages, with the visuals reused so it costs a fraction of a new video.`,
            },
            {
              icon: Scissors,
              title: "Long video to Shorts",
              body: "Norveko picks the strongest 25–58 second moments of a long video and turns each into a vertical Short with its own hook and cover.",
            },
            {
              icon: CalendarClock,
              title: "Series on autopilot",
              body: "Set a topic and a schedule. Norveko writes each new episode, makes it and saves it to your projects, ready to download and post. Available on paid plans.",
            },
            {
              icon: SlidersHorizontal,
              title: "Edit after it renders",
              body: "A timeline lets you re-time scenes, replace a picture, upload your own clip or fix a subtitle without starting over, and your brand kit keeps logo and colors consistent.",
            },
          ].map((f, i) => (
            <Reveal key={f.title} delay={80 + (i % 3) * 80}>
              <div className="h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <f.icon size={22} className="text-purple-300" aria-hidden />
                <h3 className="mt-4 text-lg font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 2c. PRICING — kept high: visitors look for the price right after the examples */}
      <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle
            eyebrow="Pricing"
            title="Start free. Scale when you're ready."
            subtitle={`Every account starts with ${FREE_TRIAL_CREDITS} free credits (≈ ${FREE_CREDITS_BUY})${TRIAL_VIDEO_PUBLIC ? " plus one free 30-second video" : ""}. Then pick a weekly, monthly or yearly plan, or pay as you go with packs that don't expire while your account is active.`}
          />
        </Reveal>

        <Reveal>
          <div className="mt-8">
            <SubscriptionPlans mode="landing" />
          </div>
        </Reveal>

        <Reveal>
          <h3 className="mt-12 text-center text-lg font-bold text-white">Or pay as you go</h3>
          <p className="mt-1 text-center text-sm text-gray-400">One-time credit packs, no subscription. Prices are in USD, excluding tax.</p>
        </Reveal>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                  <span className="pb-1 text-sm text-gray-400">one-time</span>
                </div>

                <p className="mt-2 text-sm font-medium text-gray-300">
                  {plan.credits.toLocaleString("en-US")} credits
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

      {/* 2d. WHY NORVEKO: only what we ship, no claims about other tools */}
      <section id="compare" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-12 sm:px-6">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[var(--nv-panel)] via-[var(--nv-panel)] to-[var(--nv-bg)] p-5 shadow-[0_30px_80px_-30px_rgba(99,102,241,0.45)] sm:p-8">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-purple-600/20 blur-3xl" />
            <div aria-hidden className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-blue-600/15 blur-3xl" />

            <div className="relative">
              <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Why Norveko</h2>
              <p className="mt-2 max-w-xl text-sm text-gray-400">
                Norveko researches, checks and edits the story before a single frame is made, and you approve it first.
              </p>
            </div>

            <div className="relative mt-6 grid gap-4 lg:grid-cols-3">
              {WHY_NORVEKO.map((group) => (
                <div key={group.title} className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                  <h3 className="text-sm font-semibold text-white">{group.title}</h3>
                  <ul className="mt-3 space-y-3">
                    {group.items.map((row) => (
                      <li key={row.feature} className="flex gap-2.5">
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
                        <span className="min-w-0">
                          <span className="block text-sm text-gray-100">{row.feature}</span>
                          <span className="block text-xs text-gray-400">{row.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </section>

      {/* 3. PROBLEM */}
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
                <p className="mt-3 text-xs text-gray-400">
                  {t.platform} · {t.style}
                </p>
                <p className="mt-3 line-clamp-2 text-xs italic text-gray-400">e.g. “{t.examples[0]}”</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 6. HOW IT WORKS (5 Nov 2026: one story — idea → video → publish; the old
          "content package" sections (problem / 6-step workflow / workspace / formats) were
          cut: the page told two different products) */}
      <section id="workflow" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-12 sm:px-6">
        <Reveal>
          <SectionTitle eyebrow="How it works" title="Three steps. That's it." subtitle="No editor, no prompt-juggling, no stock-clip hunting." />
        </Reveal>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["1", "Describe your idea", "One sentence, a link to an article, or a joke with its lines. Pick the platform, length and language, or start from a template."],
            ["2", "Norveko makes the video", "It researches the topic, writes and fact-checks the script, records the narration, makes the visuals, adds music, subtitles and a thumbnail, then renders the MP4. Want a say? Review the script before anything is filmed."],
            ["3", "Download and post", "Download the MP4 and thumbnail, ready for YouTube, TikTok or Instagram. Translate it into another language or cut Shorts from a long video with one click."],
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

        <Reveal>
          <TutorialButton variant="card" label="Watch the 1-minute tour" className="mx-auto mt-8 max-w-xl" />
        </Reveal>
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
                    className={`shrink-0 text-gray-400 transition-transform ${
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
              Ready to make your first video?
            </h2>
            <p className="mt-3 text-lg text-gray-400">
              One idea in. A finished video out, on your channel today.
            </p>
            <Link
              href="/signup"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-6 py-3.5 text-base font-bold sm:px-8 sm:py-4 sm:text-lg transition hover:opacity-90"
            >
              Start free with {FREE_TRIAL_CREDITS} credits
              <ArrowRight size={20} />
            </Link>
            <p className="mt-3 text-xs text-gray-400">No credit card required</p>
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
          <nav className="flex flex-wrap justify-center gap-6 gap-y-2 text-sm text-gray-400">
            <a href="#examples" className="transition hover:text-gray-300">Examples</a>
            <a href="#workflow" className="transition hover:text-gray-300">How it works</a>
            <a href="#pricing" className="transition hover:text-gray-300">Pricing</a>
            <a href="#faq" className="transition hover:text-gray-300">FAQ</a>
            <Link href="/terms" className="transition hover:text-gray-300">Terms</Link>
            <Link href="/privacy" className="transition hover:text-gray-300">Privacy</Link>
            <Link href="/refund" className="transition hover:text-gray-300">Refunds</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="transition hover:text-gray-300">Contact</a>
            <Link href="/login" className="transition hover:text-gray-300">Log in</Link>
          </nav>
          <p className="text-xs text-gray-400">
            © {new Date().getFullYear()} {LEGAL_NAME}. All rights reserved. · <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-gray-300">{SUPPORT_EMAIL}</a>
          </p>
        </div>
      </footer>
    </div>
  );
}