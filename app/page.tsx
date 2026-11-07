import { requireUser } from "@/lib/supabase-server";
import type { Metadata } from "next";
import LandingPage from "./components/LandingPage";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  const { user } = await requireUser();
  return <LandingPage isLoggedIn={Boolean(user)} />;
}
