import { createServerSupabaseClient } from "./supabase-server";

export async function getCachedChannelStats(channelId: string, userId: string) {
  if (!channelId || !userId) {
    return null;
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("channel_stats_snapshots")
    .select("subscriber_count, view_count, video_count, created_at")
    .eq("user_id", userId)
    .eq("channel_id", channelId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getCachedChannelStats error:", error);
    return null;
  }

  if (!data) {
    return null;
  }

  return {
    subscriberCount: data.subscriber_count,
    viewCount: data.view_count,
    videoCount: data.video_count,
    lastUpdated: data.created_at,
  };
}

export async function getCachedVideos(channelId: string, userId: string) {
  if (!channelId || !userId) {
    return [];
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("channel_videos_cache")
    .select("videos")
    .eq("user_id", userId)
    .eq("channel_id", channelId)
    .maybeSingle();

  if (error) {
    console.error("getCachedVideos error:", error);
    return [];
  }

  if (!data?.videos) {
    return [];
  }

  return data.videos as any[];
}
