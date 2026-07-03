import { getChannelHealthScore } from "../lib/channelHealth";

export default async function ChannelHealth() {
  let health;

  try {
    health = await getChannelHealthScore();
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
          <h2 className="text-2xl font-bold text-white">Kanal Sağlığı</h2>
        </div>
        <p className="mt-4 text-gray-300">
          Henüz yeterli veri yok.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Kanal Sağlığı</h2>
          <p className="mt-1 text-sm text-gray-400">
            Kanalınızın toplam sağlık skorunu izleyin.
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-white">{health.score}%</div>
          <div className="text-sm text-gray-400">0-100 Sağlık Puanı</div>
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
          <p className="text-sm text-gray-400">Yayın Tutarlılığı</p>
          <p className="mt-1 text-xl font-semibold text-white">{health.breakdown.consistency}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-gray-400">Etkileşim Oranı</p>
          <p className="mt-1 text-xl font-semibold text-white">{health.breakdown.engagement}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-sm text-gray-400">Büyüme Trendi</p>
          <p className="mt-1 text-xl font-semibold text-white">{health.breakdown.growth}</p>
        </div>
      </div>
    </section>
  );
}
