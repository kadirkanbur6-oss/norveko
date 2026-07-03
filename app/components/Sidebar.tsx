import {
  BarChart3,
  FileText,
  Layers,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

const reports = [
  { label: "Overview", icon: BarChart3, active: true },
  { label: "Content", icon: FileText },
  { label: "Audience", icon: Users },
  { label: "Growth", icon: TrendingUp },
  { label: "AI Insights", icon: Sparkles },
];

export default function Sidebar() {
  return (
    <aside className="w-72 border-r border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10">
          <Layers className="text-blue-300" />
        </div>

        <div>
          <h1 className="text-2xl font-bold">NORVEKO</h1>
          <p className="text-xs text-gray-400">Analytics</p>
        </div>
      </div>

      <div className="mt-10">
        <p className="mb-4 text-sm uppercase tracking-[4px] text-gray-500">
          Reports
        </p>

        <div className="space-y-3">
          {reports.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.label}
                className={`w-full rounded-2xl border px-4 py-4 text-left ${
                  item.active
                    ? "border-blue-400/40 bg-blue-500/10 text-white"
                    : "border-white/10 bg-white/[0.03] text-gray-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon size={18} className="text-blue-300" />
                  {item.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}