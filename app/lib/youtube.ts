const API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY!;

export async function getChannelStats(channelId: string) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.error?.message || "YouTube API Error");
  }

  return data.items[0].statistics;
}

export async function getRecentVideos(channelId: string) {
  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${API_KEY}`
  );

  const channelData = await channelRes.json();

  const uploadsPlaylistId =
    channelData.items[0].contentDetails.relatedPlaylists.uploads;

  const playlistRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=4&key=${API_KEY}`
  );

  const playlistData = await playlistRes.json();

  const videoIds = playlistData.items
    .map((item: any) => item.snippet.resourceId.videoId)
    .join(",");

  const videosRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${API_KEY}`
  );

  const videosData = await videosRes.json();

  return videosData.items;
}