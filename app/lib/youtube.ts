const API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY;

function getApiKey() {
  if (!API_KEY) {
    throw new Error("Missing YouTube API key. Set NEXT_PUBLIC_YOUTUBE_API_KEY.");
  }

  return API_KEY;
}

async function parseJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    throw new Error("YouTube API returned invalid JSON.");
  }
}

export async function getChannelStats(channelId: string) {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${getApiKey()}`;

  const res = await fetch(url);
  const data = await parseJson(res);

  if (!res.ok) {
    throw new Error(data?.error?.message || `YouTube API Error (${res.status})`);
  }

  if (!data?.items?.[0]?.statistics) {
    throw new Error("YouTube API returned no channel statistics.");
  }

  return data.items[0].statistics;
}

export async function getRecentVideos(channelId: string) {
  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${getApiKey()}`
  );

  const channelData = await parseJson(channelRes);

  if (!channelRes.ok) {
    throw new Error(channelData?.error?.message || `YouTube API channel query failed (${channelRes.status})`);
  }

  const uploadsPlaylistId =
    channelData?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylistId) {
    throw new Error("Unable to resolve uploads playlist for YouTube channel.");
  }

  const playlistRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=4&key=${getApiKey()}`
  );

  const playlistData = await parseJson(playlistRes);

  if (!playlistRes.ok) {
    throw new Error(playlistData?.error?.message || `YouTube API playlist query failed (${playlistRes.status})`);
  }

  const videoIds = playlistData?.items
    .map((item: any) => item.snippet?.resourceId?.videoId)
    .filter(Boolean)
    .join(",");

  if (!videoIds) {
    throw new Error("No recent video IDs found for the uploads playlist.");
  }

  const videosRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${getApiKey()}`
  );

  const videosData = await videosRes.json();

  if (!videosRes.ok) {
    throw new Error(videosData?.error?.message || `YouTube API videos query failed (${videosRes.status})`);
  }

  return videosData.items ?? [];
}