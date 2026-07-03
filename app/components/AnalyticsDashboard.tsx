import RevenueChart from "./RevenueChart";
import Header from "./Header";
import Sidebar from "./Sidebar";
import StatsCards from "./StatsCards";
import ChannelHealth from "./ChannelHealth";
import AiInsights from "./AiInsights";
import RecentVideos from "./RecentVideos";
import PlatformAnalytics from "./PlatformAnalytics";
import ActivityTimeline from "./ActivityTimeline";
import ContentCalendar from "./ContentCalendar";
export default function AnalyticsDashboard() {
  return (
    <main className="min-h-screen bg-[#070B17] text-white flex">
      <Sidebar />

      <section className="flex-1 p-10">
        <div className="flex items-center justify-between">
  <Header />

  <button className="rounded-2xl bg-gradient-to-r from-blue-500 to-red-500 px-6 py-3 font-semibold">
    Export Report
  </button>
</div>

<div className="mt-10">
  <StatsCards />
</div>
<ChannelHealth />
<RevenueChart />
<AiInsights />
<RecentVideos />
<PlatformAnalytics />
<ActivityTimeline />
<ContentCalendar />
      </section>
    </main>
  );
}