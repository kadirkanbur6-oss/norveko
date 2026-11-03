"use client";

import Sidebar from "../components/Sidebar";
import { PageHeader } from "../components/PageTabs";
import TalkStudio from "../components/studio/TalkStudio";

export default function TalkPage() {
  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0a0a12] text-white">
      <Sidebar />
      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <PageHeader title="Talking character" subtitle="Pick a character, give them a line, and they say it on camera with matching lips." />
          <TalkStudio />
        </div>
      </main>
    </div>
  );
}
