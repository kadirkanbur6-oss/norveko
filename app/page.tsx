import { requireUser } from "@/lib/supabase-server";
import LandingPage from "./components/LandingPage";

export default async function Home() {
  const { user } = await requireUser();
  return <LandingPage isLoggedIn={Boolean(user)} />;
}
