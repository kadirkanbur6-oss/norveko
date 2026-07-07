'use client';

import { Lightbulb, Sparkles, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

interface AiInsightsResponse {
  success: boolean;
  insights?: string[];
  error?: string;
}

export default function AiInsights() {
  const [insights, setInsights] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInsights() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/ai-insights");
        const data: AiInsightsResponse = await response.json();

        if (!response.ok || !data.success) {
          setError(data.error || "Unable to load AI insights.");
          setInsights([]);
          return;
        }

        setInsights(data.insights ?? []);
      } catch (err) {
        console.error("AiInsights fetch error:", err);
        setError("Unable to load AI insights.");
        setInsights([]);
      } finally {
        setLoading(false);
      }
    }

    loadInsights();
  }, []);

  if (!loading && (error || insights.length === 0)) {
    return null;
  }

  return (
    <section className="mt-8 rounded-[28px] border border-white/10 bg-white/[0.04] p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Insights</h2>
          <p className="mt-1 text-sm text-gray-400">
            Smart recommendations for your next publishing cycle.
          </p>
        </div>

        {loading ? (
          <Loader2 className="text-blue-300 animate-spin" size={28} />
        ) : (
          <Sparkles className="text-blue-300" size={28} />
        )}
      </div>

      <div className="mt-6">
        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-black/25 p-6 text-center text-sm text-gray-400">
            Loading AI insights...
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
            {insights.map((insight, index) => (
              <div
                key={`${insight}-${index}`}
                className="rounded-3xl border border-white/10 bg-black/25 p-5 hover:border-blue-400/40"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-300">
                  <Lightbulb size={22} />
                </div>

                <p className="mt-4 text-sm leading-6 text-gray-300">{insight}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}