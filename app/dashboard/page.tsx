import { Suspense } from "react";
import AnalyticsDashboard from "../components/AnalyticsDashboard";
import WelcomeIntro from "../components/WelcomeIntro";
import ReferralClaim from "../components/ReferralClaim";

export default function DashboardPage() {
  return (
    <>
      <Suspense fallback={null}>
        <WelcomeIntro />
      </Suspense>
      <ReferralClaim />
      <AnalyticsDashboard />
    </>
  );
}
