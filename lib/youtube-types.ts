// lib/youtube-types.ts
// Minimal shape of a YouTube Data API v3 video resource as cached by
// /api/snapshot-stats and read by the dashboard.

export interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    publishedAt: string;
    thumbnails?: {
      default?: { url: string };
      medium?: { url: string };
      high?: { url: string };
    };
  };
  statistics: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
}
