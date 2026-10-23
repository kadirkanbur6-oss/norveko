// app/api/features/route.ts
// Tells the UI which optional features are available to the current user.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import {
  isGenerationEnabled,
  isVideoGenerationEnabled,
  LAUNCH_LOCK_MESSAGE,
} from "@/lib/pipeline/features";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return NextResponse.json({
    success: true,
    features: {
      generation: isGenerationEnabled(user?.id),
      videoGeneration: isVideoGenerationEnabled(user?.id),
    },
    launchLockMessage: isGenerationEnabled(user?.id) ? null : LAUNCH_LOCK_MESSAGE,
  });
}
