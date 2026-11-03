"use client";

import Sidebar from "../components/Sidebar";
import { PageHeader } from "../components/PageTabs";
import SwapStudio from "../components/studio/SwapStudio";

export default function SwapPage() {
  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0a0a12] text-white">
      <Sidebar />
      <main id="main-content" className="min-w-0 flex-1 px-4 pb-10 pt-20 sm:px-6 lg:p-8">
        <div className="mx-auto max-w-4xl space-y-5">
          <PageHeader title="Character swap" subtitle="Put one of your characters into a clip — same moves, expressions and sound." />
          <SwapStudio />
        </div>
      </main>
    </div>
  );
}
