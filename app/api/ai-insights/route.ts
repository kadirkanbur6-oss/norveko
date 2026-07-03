import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getCachedChannelStats, getCachedVideos } from "../../../lib/dashboardData";
import { getChannelGrowth } from "../../lib/channelGrowth";
import { generateChannelInsights } from "../../../lib/gemini";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

export async function GET() {
  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: async () => {
          const requestCookies = await cookies();
          return requestCookies.getAll().map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
          }));
        },
      },
    });

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const { data: channelData, error: channelError } = await supabase
      .from("user_channels")
      .select("channel_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (channelError || !channelData?.channel_id) {
      return NextResponse.json(
        { success: false, error: "No connected YouTube channel found." },
        { status: 400 }
      );
    }

    const channelId = channelData.channel_id;

    const stats = await getCachedChannelStats(channelId);
    const videos = await getCachedVideos(channelId);
    const growthResult = await getChannelGrowth(channelId);

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
      .map((video: any) => ({
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
