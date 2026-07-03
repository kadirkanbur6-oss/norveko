import { Bell, Search } from "lucide-react";

export default function Header() {
  return (
    <header className="flex items-center justify-between mb-10">
      <div>
        <h1 className="text-5xl font-bold">Analytics Dashboard</h1>

        <p className="mt-2 text-gray-400">
          Monitor your AI creator business in one place.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <Search size={18} className="text-gray-400" />

          <input
            placeholder="Search..."
            className="bg-transparent outline-none text-sm w-52"
          />
        </div>

        <button className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Bell size={18} />

          <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-red-500"></span>
        </button>

        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2">
          <img
            src="https://i.pravatar.cc/100"
            className="h-10 w-10 rounded-xl"
          />

          <div>
            <p className="font-semibold">Kadir</p>

            <p className="text-xs text-gray-400">
              Premium
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}