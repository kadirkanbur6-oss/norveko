import {
  CalendarClock,
  CheckCircle,
  DollarSign,
  Image,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

const activities = [
  {
    title: "Video published",
    detail: "The Dancing Plague Mystery",
    time: "2 minutes ago",
    icon: UploadCloud,
    color: "text-green-400",
  },
  {
    title: "AI generated thumbnail",
    detail: "Dyatlov Pass Case",
    time: "14 minutes ago",
    icon: Image,
    color: "text-blue-400",
  },
  {
    title: "Revenue milestone",
    detail: "+$420 earned today",
    time: "32 minutes ago",
    icon: DollarSign,
    color: "text-emerald-400",
  },
  {
    title: "Upload scheduled",
    detail: "Tomorrow at 19:30",
    time: "1 hour ago",
    icon: CalendarClock,
    color: "text-yellow-400",
  },
  {
    title: "Copyright check completed",
    detail: "No issues found",
    time: "2 hours ago",
    icon: ShieldCheck,
    color: "text-purple-400",
  },
];

export default function ActivityTimeline() {
  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Recent Activity</h2>

          <p className="mt-1 text-sm text-gray-400">
            Live workflow updates across your creator workspace.
          </p>
        </div>

        <CheckCircle className="text-blue-400" size={28} />
      </div>

      <div className="space-y-4">
        {activities.map((activity) => {
          const Icon = activity.icon;

          return (
            <div
              key={activity.title}
              className="flex items-center gap-4 rounded-3xl border border-white/10 bg-black/25 p-4 hover:border-blue-400/40"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.05]">
                <Icon className={activity.color} size={24} />
              </div>

              <div className="flex-1">
                <h3 className="font-bold text-white">{activity.title}</h3>
                <p className="mt-1 text-sm text-gray-400">{activity.detail}</p>
              </div>

              <span className="text-sm text-gray-500">{activity.time}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}