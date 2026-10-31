// app/api/features/route.ts
// Tells the UI which optional features are available to the current user.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import {
  isFullVideoEnabled,
  isGenerationEnabled,
  isVideoGenerationEnabled,
  LAUNCH_LOCK_MESSAGE,
} from "@/lib/pipeline/features";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { user } = await requireUser();
  // One free 30 s video for accounts that haven't bought a pack (full-video access required).
  let trialVideo = false;
  if (user && isFullVideoEnabled(user.id)) {
    const { createClient } = await import("@supabase/supabase-js");
    const { trialVideoAvailable } = await import("@/lib/pipeline/trial");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { clientIp } = await import("@/lib/pipeline/abuse");
    trialVideo = await trialVideoAvailable(admin, user.id, { email: user.email, ip: clientIp(req.headers) });
  }

  return NextResponse.json({
    success: true,
    features: {
      generation: isGenerationEnabled(user?.id),
      videoGeneration: isVideoGenerationEnabled(user?.id),
      fullVideo: isFullVideoEnabled(user?.id),
      trialVideo,
    },
    launchLockMessage: isGenerationEnabled(user?.id) ? null : LAUNCH_LOCK_MESSAGE,
  });
}
