import Header from "./Header";
import Sidebar from "./Sidebar";
import StatsCards from "./StatsCards";
import ChannelHealth from "./ChannelHealth";
import AiInsights from "./AiInsights";
import RecentVideos from "./RecentVideos";
import DashboardHighlights from "./DashboardHighlights";

export default function AnalyticsDashboard() {
  return (
    <main className="flex min-h-screen bg-[#070B17] text-white">
      <Sidebar />

      <section className="flex-1 p-10">
        <Header />

        {/* Creator Studio overview: quick action, credits, recent projects */}
        <DashboardHighlights />

        {/* Real YouTube data */}
        <div className="mt-10">
          <StatsCards />
        </div>
        <ChannelHealth />
        <AiInsights />
        <RecentVideos />
      </section>
    </main>
  );
}