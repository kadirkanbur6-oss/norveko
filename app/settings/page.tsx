"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Loader2,
  Mail,
  Save,
  Settings as SettingsIcon,
  Video,
} from "lucide-react";
import Sidebar from "../components/Sidebar";

interface UserSettings {
  email: string;
  createdAt: string | null;
  channelId: string | null;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [channelInput, setChannelInput] = useState("");
  const [savingChannel, setSavingChannel] = useState(false);
  const [channelMessage, setChannelMessage] = useState("");
  const [channelSaved, setChannelSaved] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || "Failed to load settings.");
        }

        setSettings(data.settings);
        setChannelInput(data.settings.channelId ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    loadSettings();
  }, []);

  async function handleSaveChannel() {
    setSavingChannel(true);
    setChannelMessage("");
    setChannelSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: channelInput }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to save.");
      }

      setChannelSaved(true);
      setChannelMessage(
        "Channel updated ✓ New stats will appear after the next data snapshot."
      );
      setSettings((prev) =>
        prev ? { ...prev, channelId: channelInput.trim() } : prev
      );
    } catch (err) {
      setChannelMessage(
        err instanceof Error ? err.message : "An unknown error occurred."
      );
    } finally {
      setSavingChannel(false);
    }
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }

  return (
    <div className="flex min-h-screen bg-[#0a0a12] text-white">
      <Sidebar />

      <main className="flex-1 p-8">
        <div className="mx-auto max-w-3xl">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/30 bg-blue-500/10">
              <SettingsIcon className="text-blue-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Settings</h1>
              <p className="text-sm text-gray-400">
                Account and channel management
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-16 flex justify-center">
              <Loader2 size={32} className="animate-spin text-blue-300" />
            </div>
          ) : error ? (
            <p className="mt-8 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">
              {error}
            </p>
          ) : settings ? (
            <div className="mt-8 space-y-6">
              {/* Profile card */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-2">
                  <Mail size={18} className="text-blue-300" />
                  <h2 className="font-semibold">Profile</h2>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0d0d16] p-4">
                    <span className="text-gray-400">Email</span>
                    <span>{settings.email}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-[#0d0d16] p-4">
                    <span className="text-gray-400">Member since</span>
                    <span>{formatDate(settings.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* YouTube channel card */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-2">
                  <Video size={18} className="text-red-400" />
                  <h2 className="font-semibold">YouTube Channel</h2>
                </div>

                <p className="mt-2 text-sm text-gray-400">
                  Dashboard stats are pulled from this channel. Channel IDs
                  start with &quot;UC&quot; — find yours in YouTube Studio →
                  Settings → Channel → Advanced settings.
                </p>

                <div className="mt-4">
                  <label className="mb-1 block text-xs uppercase tracking-wider text-gray-500">
                    Channel ID
                  </label>
                  <input
                    type="text"
                    value={channelInput}
                    onChange={(e) => {
                      setChannelInput(e.target.value);
                      setChannelSaved(false);
                      setChannelMessage("");
                    }}
                    placeholder="UCxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full rounded-xl border border-white/10 bg-[#12121c] p-3 text-sm text-white outline-none focus:border-blue-400/50"
                  />
                </div>

                <button
                  onClick={handleSaveChannel}
                  disabled={
                    savingChannel ||
                    channelInput.trim() === (settings.channelId ?? "")
                  }
                  className="mt-4 flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {savingChannel ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : channelSaved ? (
                    <Check size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  {savingChannel
                    ? "Saving..."
                    : channelSaved
                    ? "Saved"
                    : "Update Channel"}
                </button>

                {channelMessage && (
                  <p
                    className={`mt-3 rounded-xl border p-3 text-sm ${
                      channelSaved
                        ? "border-green-400/30 bg-green-500/10 text-green-300"
                        : "border-red-400/30 bg-red-500/10 text-red-300"
                    }`}
                  >
                    {channelMessage}
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}