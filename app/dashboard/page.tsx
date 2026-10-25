import { Suspense } from "react";
import AnalyticsDashboard from "../components/AnalyticsDashboard";
import WelcomeIntro from "../components/WelcomeIntro";

export default function DashboardPage() {
  return (
    <>
      <Suspense fallback={null}>
        <WelcomeIntro />
      </Suspense>
      <AnalyticsDashboard />
    </>
  );
}
