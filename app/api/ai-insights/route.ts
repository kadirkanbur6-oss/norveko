import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase-server";
import type { YouTubeVideo } from "@/lib/youtube-types";
import { getCachedChannelStats, getCachedVideos } from "../../../lib/dashboardData";
import { getChannelGrowth } from "../../lib/channelGrowth";
import { generateChannelInsights } from "../../../lib/gemini";


export async function GET() {
  try {
    const { supabase, user } = await requireUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: channelData, error: channelError } = await supabase
      .from("user_channels")
      .select("channel_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (channelError || !channelData?.channel_id) {
      return NextResponse.json(
        { success: false, error: "No connected YouTube channel found." },
        { status: 400 }
      );
    }

    const channelId = channelData.channel_id;

    const stats = await getCachedChannelStats(channelId, user.id);
    const videos = await getCachedVideos(channelId, user.id);
    const growthResult = await getChannelGrowth(channelId, user.id);

    if (!stats) {
      return NextResponse.json(
        {
          success: false,
          error: "No cached channel stats available yet. Please wait for the daily snapshot.",
        },
        { status: 404 }
      );
    }

    const recentVideos = (videos ?? [])
      .slice(0, 4)
      .map((video: YouTubeVideo) => ({
        title: video.snippet?.title ?? "Untitled",
        viewCount: video.statistics?.viewCount ?? "0",
        likeCount: video.statistics?.likeCount ?? "0",
        commentCount: video.statistics?.commentCount ?? "0",
        publishedAt: video.snippet?.publishedAt,
      }));

    const insights = await generateChannelInsights({
      subscriberCount: stats.subscriberCount ?? "0",
      viewCount: stats.viewCount ?? "0",
      videoCount: stats.videoCount ?? "0",
      growth: growthResult.growth ?? { views: 0, subscribers: 0, videos: 0 },
      insufficientGrowthData: growthResult?.insufficient_data ?? false,
      recentVideos,
    });

    return NextResponse.json({ success: true, insights });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
