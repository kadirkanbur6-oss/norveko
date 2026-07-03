"use client";

import { useEffect, useState } from "react";
import { Eye, MessageCircle, ThumbsUp } from "lucide-react";
import Image from "next/image";
import { getRecentVideos } from "../lib/youtube";

const CHANNEL_ID = "UCs4hJrYzjQ-nNRbS7jVUMiA";

function formatNumber(value: string | undefined) {
  return Number(value ?? 0).toLocaleString("tr-TR");
}

export default function RecentVideos() {
  const [videos, setVideos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function loadVideos() {
      try {
        const data = await getRecentVideos(CHANNEL_ID);
        setVideos(data ?? []);
      } catch (error) {
        console.error("Recent videos error:", error);
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    loadVideos();
  }, []);

  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Recent Videos</h2>
          <p className="mt-1 text-sm text-gray-400">
            Live performance from your latest YouTube uploads.
          </p>
        </div>

        <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-200">
          YouTube Live
        </span>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading videos...</p>
      ) : error ? (
        <p className="text-gray-300">
          Veriler şu anda yüklenemedi, lütfen daha sonra tekrar deneyin.
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
                    {new Date(video.snippet.publishedAt).toLocaleDateString("tr-TR")}
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