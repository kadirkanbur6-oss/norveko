import { getRecentVideos } from "./youtube";
import { getChannelGrowth } from "./channelGrowth";

const CHANNEL_ID = "UCs4hJrYzjQ-nNRbS7jVUMiA";

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getConsistencyScore(avgDays: number) {
  if (avgDays <= 7) return 40;
  if (avgDays <= 14) return 25;
  if (avgDays <= 30) return 15;
  return 10;
}

function getEngagementScore(ratio: number) {
  if (ratio >= 0.04) return 30;
  if (ratio >= 0.03) return 25;
  if (ratio >= 0.02) return 20;
  if (ratio >= 0.01) return 15;
  return 10;
}

function getGrowthScore(growth: {
  views: number;
  subscribers: number;
  videos: number;
}) {
  const avgGrowth = (growth.views + growth.subscribers + growth.videos) / 3;

  if (avgGrowth >= 10) return 30;
  if (avgGrowth >= 3) return 25;
  if (avgGrowth >= 0) return 20;
  return 10;
}

export async function getChannelHealthScore() {
  try {
    let videos = null;

    try {
      videos = await getRecentVideos(CHANNEL_ID);
    } catch (error) {
      console.error("getChannelHealthScore getRecentVideos error:", error);
      return {
        score: 0,
        breakdown: {
          consistency: 0,
          engagement: 0,
          growth: 0,
        },
        insufficient_data: true,
      };
    }

    if (!videos || !videos.length) {
      return {
        score: 0,
        breakdown: {
          consistency: 0,
          engagement: 0,
          growth: 0,
        },
        insufficient_data: true,
      };
    }

    const publishedDates = videos
      .map((video: any) => new Date(video.snippet?.publishedAt))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    const intervals: number[] = [];

    for (let i = 1; i < publishedDates.length; i += 1) {
      const diff = publishedDates[i].getTime() - publishedDates[i - 1].getTime();
      intervals.push(diff / (1000 * 60 * 60 * 24));
    }

    const avgIntervalDays = intervals.length
      ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
      : 30;

    const consistency = getConsistencyScore(avgIntervalDays);

    const engagementRatio = videos.reduce((sum: number, video: any) => {
      const views = Number(video.statistics?.viewCount ?? 0);
      const likes = Number(video.statistics?.likeCount ?? 0);
      const comments = Number(video.statistics?.commentCount ?? 0);

      if (!views) return sum;
      return sum + (likes + comments) / views;
    }, 0) / videos.length;

    const engagement = getEngagementScore(engagementRatio);

    let growthScore = 0;
    let hasGrowth = false;
    let insufficientGrowthData = false;

    try {
      const growthResult = await getChannelGrowth();
      if (
        growthResult?.success &&
        !growthResult?.insufficient_data &&
        growthResult?.growth
      ) {
        hasGrowth = true;
        growthScore = getGrowthScore(growthResult.growth);
      } else {
        insufficientGrowthData = true;
      }
    } catch (error) {
      console.error("getChannelHealthScore growth error:", error);
      insufficientGrowthData = true;
    }

    if (!hasGrowth && insufficientGrowthData) {
      const rawScore = consistency + engagement;
      const normalizedScore = round((rawScore / 70) * 100, 0);

      return {
        score: Math.min(Math.max(normalizedScore, 0), 100),
        breakdown: {
          consistency,
          engagement,
          growth: 0,
        },
        insufficient_data: false,
      };
    }

    const score = round(consistency + engagement + growthScore, 0);
    return {
      score: Math.min(Math.max(score, 0), 100),
      breakdown: {
        consistency,
        engagement,
        growth: growthScore,
      },
      insufficient_data: false,
    };
  } catch (error) {
    console.error("getChannelHealthScore error:", error);
    return {
      score: 0,
      breakdown: {
        consistency: 0,
        engagement: 0,
        growth: 0,
      },
      insufficient_data: true,
    };
  }
}
