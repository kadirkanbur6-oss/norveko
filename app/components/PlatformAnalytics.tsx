import { BarChart3, PlayCircle, TrendingUp } from "lucide-react";

const platforms = [
  {
    name: "YouTube",
    icon: PlayCircle,
    main: "124K",
    label: "Views",
    stats: [
      { label: "Subscribers", value: "+4.2K" },
      { label: "Watch Time", value: "842h" },
      { label: "Revenue", value: "$18.4K" },
    ],
  },
  {
    name: "TikTok",
    icon: PlayCircle,
    main: "86K",
    label: "Views",
    stats: [
      { label: "Followers", value: "+8.1K" },
      { label: "Engagement", value: "14.2%" },
      { label: "Viral Rate", value: "High" },
    ],
  },
  {
    name: "Instagram",
    icon: BarChart3,
    main: "31K",
    label: "Reach",
    stats: [
      { label: "Followers", value: "+2.6K" },
      { label: "Reels Views", value: "44K" },
      { label: "Engagement", value: "9.8%" },
    ],
  },
];

export default function PlatformAnalytics() {
  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Platform Analytics
          </h2>

          <p className="mt-1 text-sm text-gray-400">
            Compare your performance across all platforms.
          </p>
        </div>

        <TrendingUp className="text-blue-400" size={28} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {platforms.map((platform) => {
          const Icon = platform.icon;

          return (
            <div
              key={platform.name}
              className="rounded-3xl border border-white/10 bg-[#111827] p-6"
            >
              <div className="flex items-center justify-between">
                <div className="rounded-2xl bg-blue-500/10 p-3">
                  <Icon className="text-blue-400" size={26} />
                </div>

                <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-400">
                  Active
                </span>
              </div>

              <h3 className="mt-6 text-xl font-bold">
                {platform.name}
              </h3>

              <p className="mt-4 text-4xl font-black">
                {platform.main}
              </p>

              <p className="mt-1 text-sm uppercase tracking-widest text-gray-500">
                {platform.label}
              </p>

              <div className="mt-6 space-y-3">
                {platform.stats.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3"
                  >
                    <span className="text-gray-400">
                      {item.label}
                    </span>

                    <span className="font-semibold text-blue-400">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}