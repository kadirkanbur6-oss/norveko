import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getChannelStats } from "../../lib/youtube";

const CHANNEL_ID = "UCs4hJrYzjQ-nNRbS7jVUMiA";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SNAPSHOT_SECRET = process.env.SNAPSHOT_SECRET!;

const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token || token !== SNAPSHOT_SECRET) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const stats = await getChannelStats(CHANNEL_ID);

    const { data, error } = await supabaseService
      .from("channel_stats_snapshots")
      .insert([
        {
          channel_id: CHANNEL_ID,
          subscriber_count: stats.subscriberCount,
          view_count: stats.viewCount,
          video_count: stats.videoCount,
        },
      ]);

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
