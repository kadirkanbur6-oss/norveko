import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Clapperboard,
  FolderOpen,
  Layers,
  Lightbulb,
  Rocket,
  Sparkles,
  Wand2,
} from "lucide-react";

const features = [
  {
    icon: Wand2,
    title: "AI Content Engine",
    description:
      "Turn a single idea into a complete production package: script, scene-by-scene plan, AI video prompts, titles, description, tags and thumbnail concept.",
  },
  {
    icon: BarChart3,
    title: "Channel Analytics",
    description:
      "Connect your YouTube channel and track real growth, engagement and channel health — no fake numbers, only honest data.",
  },
  {
    icon: FolderOpen,
    title: "Project Workspace",
    description:
      "Save every generation as a project. Edit scripts, refine prompts and come back anytime — your content library, organized.",
  },
  {
    icon: Clapperboard,
    title: "Built for Video Tools",
    description:
      "Cinematic English prompts ready to paste into Kling, Runway or PixVerse. Native AI video generation is coming soon.",
  },
];

const steps = [
  {
    icon: Lightbulb,
    title: "Drop your idea",
    description:
      "Type a video concept, pick your platform, style and duration.",
  },
  {
    icon: Sparkles,
    title: "AI builds the package",
    description:
      "Hook, full voice-over script, scene plan, video prompts, titles, tags — generated in under a minute.",
  },
  {
    icon: Rocket,
    title: "Copy and publish",
    description:
      "Paste the prompts into your favorite AI video tool, record the voice-over and ship your video.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a12] text-white">
      {/* Navbar */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10">
            <Layers size={20} className="text-blue-300" />
          </div>
          <span className="text-xl font-bold tracking-wide">NORVEKO</span>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-xl px-4 py-2 text-sm text-gray-300 transition hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-4 py-2 text-sm font-semibold transition hover:opacity-90"
          >
            Get started
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-24 pt-20 text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-1.5 text-xs text-blue-200">
          <Sparkles size={14} />
          AI video production workspace for creators
        </div>

        <h1 className="mt-8 text-5xl font-bold leading-tight sm:text-6xl">
          From idea to video,
          <br />
          <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
            in one panel.
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400">
          Norveko turns your video idea into a full production package — script,
          scene plan, AI video prompts, titles, tags and thumbnail concept.
          Built for YouTube, Shorts, TikTok and Reels creators.
        </p>

        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-8 py-4 font-semibold transition hover:opacity-90"
          >
            Start creating for free
            <ArrowRight size={18} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-8 py-4 font-semibold text-gray-300 transition hover:border-white/20 hover:text-white"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-center text-3xl font-bold">How it works</h2>
        <p className="mt-3 text-center text-gray-400">
          Three steps from blank page to publish-ready.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-6"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/30 bg-blue-500/10">
                    <Icon size={18} className="text-blue-300" />
                  </div>
                  <span className="text-sm font-semibold text-gray-500">
                    Step {index + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-400">
                  {step.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-center text-3xl font-bold">
          Everything a creator needs
        </h2>
        <p className="mt-3 text-center text-gray-400">
          One workspace for ideation, production and channel growth.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 transition hover:border-blue-400/30"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
                  <Icon size={20} className="text-blue-300" />
                </div>
                <h3 className="mt-5 text-xl font-semibold">{feature.title}</h3>
                <p className="mt-3 leading-relaxed text-gray-400">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="rounded-3xl border border-blue-400/20 bg-gradient-to-br from-blue-500/10 to-purple-600/10 p-12 text-center">
          <h2 className="text-3xl font-bold">
            Your next video starts with one idea.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-gray-400">
            Join Norveko and turn ideas into publish-ready content packages in
            minutes — free to start.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-8 py-4 font-semibold transition hover:opacity-90"
          >
            Get started free
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8 text-sm text-gray-500">
          <span>© {new Date().getFullYear()} Norveko</span>
          <span>AI video production workspace</span>
        </div>
      </footer>
    </div>
  );
}