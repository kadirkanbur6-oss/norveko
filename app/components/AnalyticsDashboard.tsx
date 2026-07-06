import Link from "next/link";
import { Settings } from "lucide-react";
import Header from "./Header";
import Sidebar from "./Sidebar";
import StatsCards from "./StatsCards";
import ChannelHealth from "./ChannelHealth";
import AiInsights from "./AiInsights";
import RecentVideos from "./RecentVideos";
import DashboardHighlights from "./DashboardHighlights";
import { getUserChannelContext } from "../../lib/supabase-server";

export default async function AnalyticsDashboard() {
  const { channelId } = await getUserChannelContext();

  return (
    <main className="flex min-h-screen bg-[#070B17] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <Header />

        {/* Creator Studio overview: quick action, credits, recent projects */}
        <DashboardHighlights />

        {/* YouTube analytics — only shown if channel is connected */}
        {channelId ? (
          <>
            <div className="mt-10">
              <StatsCards />
            </div>
            <ChannelHealth />
            <AiInsights />
            <RecentVideos />
          </>
        ) : (
          <div className="mt-10 rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[2px] text-violet-300/80">
                  Optional
                </p>
                <h3 className="mt-1 text-lg font-bold text-white">
                  Connect your YouTube channel
                </h3>
                <p className="mt-1.5 max-w-md text-sm text-gray-400">
                  Track your channel stats right here — you can always do this later in Settings.
                </p>
              </div>
              <Link
                href="/settings"
                className="flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-white/[0.08] hover:text-white"
              >
                <Settings size={15} />
                Go to Settings
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}