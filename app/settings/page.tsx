"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Loader2,
  Mail,
  Save,
  Video,
} from "lucide-react";
import Sidebar from "../components/Sidebar";
import SignOutButton from "../components/SignOutButton";
import AccountSecurity from "../components/AccountSecurity";
import YouTubeConnectionCard from "../components/YouTubeConnectionCard";
import TikTokConnectionCard from "../components/TikTokConnectionCard";
import InstagramConnectionCard from "../components/InstagramConnectionCard";
import ApiKeysCard from "../components/ApiKeysCard";
import TeamCard from "../components/TeamCard";
import BrandKitCard from "../components/BrandKitCard";
import VoiceCloneCard from "../components/VoiceCloneCard";
import CharactersCard from "../components/CharactersCard";
import PageTabs, { PageHeader, useTabParam, type PageTab } from "../components/PageTabs";

const SETTINGS_TABS: PageTab[] = [
  { id: "account", label: "Account" },
  { id: "brand", label: "Brand & voice" },
  { id: "characters", label: "Characters" },
  { id: "connections", label: "Connected channels" },
  { id: "team", label: "Team" },
  { id: "api", label: "API" },
];

interface UserSettings {
  email: string;
  createdAt: string | null;
  channelId: string | null;
}

export default function SettingsPage() {
  const [tab, setTab] = useTabParam(SETTINGS_TABS, "account");
  // Coming back from connecting YouTube/TikTok: show the connections tab.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("youtube") || q.has("tiktok")) {
      const t = setTimeout(() => setTab("connections"), 0);
      return () => clearTimeout(t);
    }
  }, [setTab]);
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
    <div className="flex min-h-screen overflow-x-hidden bg-[var(--nv-bg)] text-white">
      <Sidebar />

      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-3xl">
          <PageHeader title="Settings" subtitle="Your account, brand, voice and connected channels." />
          <div className="mt-6">
            <PageTabs tabs={SETTINGS_TABS} active={tab} onChange={setTab} />
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
            <div className="mt-6 space-y-5">
              {tab === "account" && (
              <>
              {/* Profile card */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-2">
                  <Mail size={18} className="text-blue-300" />
                  <h2 className="font-semibold">Profile</h2>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[var(--nv-panel)] p-4">
                    <span className="text-gray-400">Email</span>
                    <span>{settings.email}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[var(--nv-panel)] p-4">
                    <span className="text-gray-400">Member since</span>
                    <span>{formatDate(settings.createdAt)}</span>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <p className="text-xs text-gray-500">
                    Signing out ends your session on this device only.
                  </p>
                  <SignOutButton className="flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/5 px-4 py-2 text-sm text-red-300 transition hover:bg-red-500/15 disabled:opacity-60" />
                </div>
              </div>

              {/* YouTube channel card */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="flex items-center gap-2">
                  <Video size={18} className="text-red-400" />
                  <h2 className="font-semibold">YouTube Channel</h2>
                </div>

                <p className="mt-2 text-sm text-gray-400">
                  Dashboard stats come from this channel. Connecting YouTube under{" "}
                  <button type="button" onClick={() => setTab("connections")} className="text-sky-300 hover:text-sky-200">Connected channels</button> fills it in for you.
                  To track a different channel, paste its ID (starts with &quot;UC&quot;, YouTube Studio → Settings → Channel → Advanced settings).
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
                    className="w-full rounded-xl border border-white/10 bg-[var(--nv-field)] p-3 text-sm text-white outline-none focus:border-blue-400/50"
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

              <AccountSecurity />
              </>
              )}

              {tab === "brand" && (
                <>
                  <BrandKitCard />
                  <VoiceCloneCard />
                </>
              )}

              {tab === "characters" && <CharactersCard />}

              {tab === "connections" && (
                <>
                  <YouTubeConnectionCard />
                  <TikTokConnectionCard />
                  <InstagramConnectionCard />
                </>
              )}


              {tab === "team" && <TeamCard />}

              {tab === "api" && <ApiKeysCard />}
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}