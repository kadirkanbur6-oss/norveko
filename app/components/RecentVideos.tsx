import { Eye, MessageCircle, ThumbsUp } from "lucide-react";
import Image from "next/image";
import { getCachedVideos } from "../../lib/dashboardData";
import { getUserChannelContext } from "../../lib/supabase-server";

function formatNumber(value: string | undefined) {
  return Number(value ?? 0).toLocaleString("en-US");
}

export default async function RecentVideos() {
  const { channelId, userId } = await getUserChannelContext();
  let videos: any[] = [];
  let error = false;

  if (!channelId || !userId) {
    return null;
  }

  try {
    videos = (await getCachedVideos(channelId, userId)) ?? [];
  } catch (err) {
    console.error("Recent videos error:", err);
    error = true;
  }

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Recent Videos</h2>
          <p className="mt-1 text-sm text-gray-400">
            Daily cached performance from your latest YouTube uploads.
          </p>
        </div>

        <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-200">
          Daily Cache
        </span>
      </div>

      {error ? (
        <p className="text-gray-300">
          Unable to load data right now, please try again later.
        </p>
      ) : videos.length === 0 ? (
        <p className="text-gray-300">
          No cached videos yet. Your latest uploads will appear here after the
          next daily snapshot.
        </p>
      ) : (
        <div className="space-y-4">
          {videos.map((video) => {
            const thumbnail =
              video.snippet.thumbnails?.medium?.url ||
              video.snippet.thumbnails?.default?.url;

            return (
              <div
                key={video.id}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 p-4"
              >
                <div className="relative h-20 w-32 overflow-hidden rounded-xl bg-white/5">
                  <Image
                    src={thumbnail}
                    alt={video.snippet.title}
                    fill
                    className="object-cover"
                  />
                </div>

                <div className="flex-1">
                  <h3 className="line-clamp-1 font-bold text-white">
                    {video.snippet.title}
                  </h3>

                  <p className="mt-1 text-sm text-gray-400">
                    {new Date(video.snippet.publishedAt).toLocaleDateString("en-US")}
                  </p>
                </div>

                <div className="flex gap-6 text-sm text-blue-200">
                  <span className="flex items-center gap-2">
                    <Eye size={16} />
                    {formatNumber(video.statistics.viewCount)}
                  </span>

                  <span className="flex items-center gap-2">
                    <ThumbsUp size={16} />
                    {formatNumber(video.statistics.likeCount)}
                  </span>

                  <span className="flex items-center gap-2">
                    <MessageCircle size={16} />
                    {formatNumber(video.statistics.commentCount)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}