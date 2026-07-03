'use client';

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import { getChannelStats } from "../lib/youtube";

export default function ConnectChannelPage() {
  const router = useRouter();
  const [channelId, setChannelId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsLoading(true);

    try {
      await getChannelStats(channelId);
    } catch (error) {
      console.error("ConnectChannelPage getChannelStats error:", error);
      const message = error instanceof Error ? error.message : String(error);

      if (message.toLowerCase().includes("quota")) {
        setErrorMessage(
          "We're experiencing high demand right now. Please try again in a few minutes."
        );
      } else {
        setErrorMessage("Channel not found. Please verify the Channel ID.");
      }

      setIsLoading(false);
      return;
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session?.user?.id) {
      setErrorMessage("Unable to verify user session.");
      setIsLoading(false);
      return;
    }

    const { error } = await supabase.from("user_channels").upsert({
      user_id: session.user.id,
      channel_id: channelId,
    });

    setIsLoading(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push("/");
  }

  return (
    <div className="min-h-screen bg-[#090b16] px-4 py-12 text-white">
      <div className="mx-auto w-full max-w-md rounded-[32px] border border-white/10 bg-white/5 p-10 shadow-[0_25px_100px_rgba(0,0,0,0.25)] backdrop-blur-xl">
        <div className="mb-8 space-y-3">
          <p className="text-sm uppercase tracking-[0.24em] text-violet-300/80">
            Connect Your Channel
          </p>
          <h1 className="text-4xl font-semibold">YouTube Channel ID</h1>
          <p className="text-sm text-gray-400">
            Enter your YouTube Channel ID to connect your channel to the dashboard.
          </p>
        </div>

        <form className="space-y-6" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-gray-300">
            YouTube Channel ID
            <input
              type="text"
              value={channelId}
              onChange={(event) => setChannelId(event.target.value)}
              required
              className="mt-2 w-full rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
              placeholder="UCs4hJrYzjQ-nNRbS7jVUMiA"
            />
          </label>

          {errorMessage ? (
            <div className="rounded-3xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              {errorMessage}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-3xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "Connecting..." : "Connect Channel"}
          </button>
        </form>
      </div>
    </div>
  );
}
