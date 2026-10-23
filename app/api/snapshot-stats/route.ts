import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getChannelStats, getRecentVideos } from "../../lib/youtube";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SNAPSHOT_SECRET = process.env.SNAPSHOT_SECRET!;

const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const CRON_SECRET = process.env.CRON_SECRET!;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token || (token !== SNAPSHOT_SECRET && token !== CRON_SECRET)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    // Every channel any user has connected — no hardcoded channel.
    const { data: links, error: linksError } = await supabaseService
      .from("user_channels")
      .select("user_id, channel_id");

    if (linksError) {
      return NextResponse.json(
        { success: false, error: linksError.message },
        { status: 500 }
      );
    }

    const byChannel = new Map<string, string[]>();
    for (const row of links ?? []) {
      if (!row.channel_id || !row.user_id) continue;
      const users = byChannel.get(row.channel_id) ?? [];
      if (!users.includes(row.user_id)) users.push(row.user_id);
      byChannel.set(row.channel_id, users);
    }

    if (byChannel.size === 0) {
      return NextResponse.json({ success: true, skipped: true, channels: 0 });
    }

    const results: Array<{ channel_id: string; users: number; error?: string }> = [];

    for (const [channelId, userIds] of byChannel) {
      try {
        const stats = await getChannelStats(channelId);
        const videos = await getRecentVideos(channelId);

        const statsRows = userIds.map((userId) => ({
          user_id: userId,
          channel_id: channelId,
          subscriber_count: stats.subscriberCount,
          view_count: stats.viewCount,
          video_count: stats.videoCount,
        }));
        const videosRows = userIds.map((userId) => ({
          user_id: userId,
          channel_id: channelId,
          videos,
        }));

        const [{ error: statsError }, { error: videoError }] = await Promise.all([
          supabaseService
            .from("channel_stats_snapshots")
            .upsert(statsRows, { onConflict: "user_id,channel_id", ignoreDuplicates: false }),
          supabaseService
            .from("channel_videos_cache")
            .upsert(videosRows, { onConflict: "user_id,channel_id", ignoreDuplicates: false }),
        ]);

        const message = statsError?.message || videoError?.message;
        results.push({ channel_id: channelId, users: userIds.length, ...(message ? { error: message } : {}) });
      } catch (err) {
        results.push({
          channel_id: channelId,
          users: userIds.length,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const failed = results.filter((r) => r.error).length;
    return NextResponse.json({ success: failed === 0, channels: results.length, failed, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
