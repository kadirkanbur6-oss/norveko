// lib/supabase-admin.ts
// Service-role Supabase client + site URL helper. These used to live in
// lib/youtube/oauth.ts; moved here on 8 Nov 2026 when direct publishing to
// YouTube/TikTok/Instagram was removed from the product.

import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function adminDb(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://norveko.app").replace(/\/$/, "");
}
