import { getChannelHealthScore } from "../lib/channelHealth";
import { getUserChannelContext } from "../../lib/supabase-server";

export default async function ChannelHealth() {
  const { channelId, userId } = await getUserChannelContext();
  let health;

  if (!channelId || !userId) {
    return (
      <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Channel Health</h2>
        </div>
        <p className="mt-4 text-gray-300">You have not connected a YouTube channel yet.</p>
      </section>
    );
  }

  try {
    health = await getChannelHealthScore(channelId, userId);
  } catch (error) {
    console.error("ChannelHealth error:", error);
    health = {
      score: 0,
      breakdown: {
        consistency: 0,
        engagement: 0,
        growth: 0,
      },
      insufficient_data: true,
    };
  }

  if (health.insufficient_data) {
    return (
      <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Channel Health</h2>
        </div>
        <p className="mt-4 text-gray-300">
          Not enough data yet.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Channel Health</h2>
          <p className="mt-1 text-sm text-gray-400">
            Track your channel's overall health score.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-white">{health.score}%</div>
          <div className="text-sm text-gray-400">0-100 health score</div>
        </div>
      </div>

      <div className="flex items-center justify-center py-6">
        <div className="relative h-40 w-40 rounded-full bg-white/5 p-8">
          <div className="absolute inset-0 rounded-full border border-white/10"></div>
          <div className="absolute inset-8 rounded-full bg-gradient-to-br from-blue-500/30 to-cyan-500/30"></div>
          <div className="relative flex h-full w-full items-center justify-center rounded-full bg-[#070B17] text-4xl font-bold text-white">
            {health.score}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-gray-400">Publishing Consistency</p>
          <p className="mt-1 text-xl font-semibold text-white">{health.breakdown.consistency}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-gray-400">Engagement Rate</p>
          <p className="mt-1 text-xl font-semibold text-white">{health.breakdown.engagement}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-gray-400">Growth Trend</p>
          <p className="mt-1 text-xl font-semibold text-white">{health.breakdown.growth}</p>
        </div>
      </div>
    </section>
  );
}
