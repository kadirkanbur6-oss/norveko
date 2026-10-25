// app/api/features/route.ts
// Tells the UI which optional features are available to the current user.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import {
  isGenerationEnabled,
  isVideoGenerationEnabled,
  LAUNCH_LOCK_MESSAGE,
} from "@/lib/pipeline/features";

export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await requireUser();

  return NextResponse.json({
    success: true,
    features: {
      generation: isGenerationEnabled(user?.id),
      videoGeneration: isVideoGenerationEnabled(user?.id),
    },
    launchLockMessage: isGenerationEnabled(user?.id) ? null : LAUNCH_LOCK_MESSAGE,
  });
}
