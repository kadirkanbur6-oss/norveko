import { Clock, Eye, MousePointerClick, Rocket } from "lucide-react";
import { getChannelStats } from "../lib/youtube";
import { getChannelGrowth } from "../lib/channelGrowth";

const CHANNEL_ID = "UCs4hJrYzjQ-nNRbS7jVUMiA";

function formatNumber(value: string) {
  return Number(value).toLocaleString("tr-TR");
}

function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export default async function StatsCards() {
  let stats = null;
  let growth = null;
  let insufficientData = true;
  let statsError = false;

  try {
    stats = await getChannelStats(CHANNEL_ID);
  } catch (error) {
    console.error("StatsCards getChannelStats error:", error);
    statsError = true;
  }

  if (!statsError) {
    try {
      const growthPayload = await getChannelGrowth();
      insufficientData = growthPayload?.insufficient_data === true;
      growth = growthPayload?.success ? growthPayload.growth : null;
    } catch (error) {
      console.error("StatsCards growth computation error:", error);
      insufficientData = true;
      growth = null;
    }
  }

  if (statsError || !stats) {
    return (
      <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
        <p className="text-gray-300">
          Veriler şu anda yüklenemedi, lütfen daha sonra tekrar deneyin.
        </p>
      </div>
    );
  }

  const cards = [
    {
      title: "Total Views",
      value: formatNumber(stats.viewCount),
      icon: Eye,
      metric: "views",
    },
    {
      title: "Subscribers",
      value: formatNumber(stats.subscriberCount ?? "0"),
      icon: Clock,
      metric: "subscribers",
    },
    {
      title: "Videos",
      value: formatNumber(stats.videoCount),
      icon: MousePointerClick,
      metric: "videos",
    },
    {
      title: "Published Assets",
      value: formatNumber(stats.videoCount),
      icon: Rocket,
      metric: "videos",
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((item) => {
        const Icon = item.icon;
        const changeValue = growth?.[item.metric as keyof typeof growth];
        const showNote = insufficientData || changeValue == null;

        return (
          <div
            key={item.title}
            className="rounded-[28px] border border-white/10 bg-white/[0.04] p-6"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
                <Icon size={24} />
              </div>
              <div>
                {showNote ? (
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-400">
                    henüz yeterli veri yok
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-3 py-1 text-xs ${
                      changeValue! >= 0
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-400/20"
                        : "bg-red-500/15 text-red-300 border border-red-400/20"
                    }`}
                  >
                    {formatPercent(changeValue!)}
                  </span>
                )}
              </div>
            </div>

            <p className="mt-6 text-sm uppercase tracking-[4px] text-gray-500">
              {item.title}
            </p>

            <h3 className="mt-2 text-4xl font-black">{item.value}</h3>
          </div>
        );
      })}
    </div>
  );
}