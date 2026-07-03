import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const DEFAULT_CHANNEL_ID = "UCs4hJrYzjQ-nNRbS7jVUMiA";

const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function computeGrowth(
  current: string | number | null,
  previous: string | number | null
) {
  const currentValue = Number(current ?? 0);
  const previousValue = Number(previous ?? 0);

  if (!previousValue) {
    return 0;
  }

  return roundPercent(((currentValue - previousValue) / previousValue) * 100);
}

export async function getChannelGrowth(channelId = DEFAULT_CHANNEL_ID, userId?: string | null) {
  let latestQuery = supabaseService
    .from("channel_stats_snapshots")
    .select("subscriber_count, view_count, video_count, created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (channelId) {
    latestQuery = latestQuery.eq("channel_id", channelId);
  }

  if (userId) {
    latestQuery = latestQuery.eq("user_id", userId);
  }

  const { data: latestData, error: latestError } = await latestQuery.maybeSingle();

  if (latestError) {
    throw latestError;
  }

  if (!latestData) {
    return {
      success: false,
      error: "No snapshots found",
    };
  }

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let oldQuery = supabaseService
    .from("channel_stats_snapshots")
    .select("subscriber_count, view_count, video_count, created_at")
    .lte("created_at", sevenDaysAgo.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);

  if (channelId) {
    oldQuery = oldQuery.eq("channel_id", channelId);
  }

  if (userId) {
    oldQuery = oldQuery.eq("user_id", userId);
  }

  const { data: oldData, error: oldError } = await oldQuery.maybeSingle();

  if (oldError) {
    throw oldError;
  }

  if (!oldData) {
    return {
      success: true,
      growth: {
        views: 0,
        subscribers: 0,
        videos: 0,
      },
      insufficient_data: true,
    };
  }

  const growth = {
    views: computeGrowth(latestData.view_count, oldData.view_count),
    subscribers: computeGrowth(latestData.subscriber_count, oldData.subscriber_count),
    videos: computeGrowth(latestData.video_count, oldData.video_count),
  };

  return {
    success: true,
    growth,
    insufficient_data: false,
  };
}
