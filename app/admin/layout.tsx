import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase-server";
import { isAdmin } from "@/lib/admin";

export const metadata: Metadata = {
  title: "Admin — Norveko",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Owner only: everyone else sees the normal 404 page.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireUser();
  if (!user || !isAdmin(user)) notFound();
  return children;
}
