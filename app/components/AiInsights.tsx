import { Lightbulb, Sparkles, TrendingUp, Zap } from "lucide-react";

const insights = [
  {
    title: "Best posting window",
    text: "Your strongest engagement window is between 19:00 and 21:00.",
    icon: Zap,
  },
  {
    title: "Shorts outperforming",
    text: "Short-form content is performing 28% better than long-form this month.",
    icon: TrendingUp,
  },
  {
    title: "Improve hooks",
    text: "Videos with a stronger first 3 seconds may increase retention by 12%.",
    icon: Sparkles,
  },
  {
    title: "Topic opportunity",
    text: "Mystery and historical stories are showing the highest repeat watch rate.",
    icon: Lightbulb,
  },
];

export default function AiInsights() {
  return (
    <section className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Insights</h2>
          <p className="mt-1 text-sm text-gray-400">
            Smart recommendations for your next publishing cycle.
          </p>
        </div>

        <Sparkles className="text-blue-300" size={28} />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {insights.map((item) => {
          const Icon = item.icon;

          return (
            <div
              key={item.title}
              className="rounded-3xl border border-white/10 bg-black/25 p-5 hover:border-blue-400/40"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
                <Icon size={22} />
              </div>

              <h3 className="mt-4 text-lg font-bold">{item.title}</h3>

              <p className="mt-2 text-sm leading-6 text-gray-400">
                {item.text}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}