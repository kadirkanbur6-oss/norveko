import { CalendarDays, Clock, PlayCircle } from "lucide-react";

const days = [
  {
    day: "Mon",
    title: "Shorts Pack",
    time: "19:00",
    status: "Ready",
  },
  {
    day: "Tue",
    title: "YouTube Long Video",
    time: "20:30",
    status: "Draft",
  },
  {
    day: "Wed",
    title: "TikTok Growth Clip",
    time: "18:45",
    status: "Ready",
  },
  {
    day: "Thu",
    title: "Research Day",
    time: "14:00",
    status: "Planned",
  },
  {
    day: "Fri",
    title: "Mystery Shorts",
    time: "21:00",
    status: "Ready",
  },
  {
    day: "Sat",
    title: "Publish Campaign",
    time: "19:30",
    status: "Scheduled",
  },
  {
    day: "Sun",
    title: "Analytics Review",
    time: "12:00",
    status: "Review",
  },
];

export default function ContentCalendar() {
  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Content Calendar</h2>

          <p className="mt-1 text-sm text-gray-400">
            Plan your weekly publishing schedule.
          </p>
        </div>

        <CalendarDays className="text-blue-400" size={28} />
      </div>

      <div className="grid gap-4 lg:grid-cols-7">
        {days.map((item) => (
          <div
            key={item.day}
            className="rounded-3xl border border-white/10 bg-black/25 p-5 hover:border-blue-400/40"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm uppercase tracking-[3px] text-gray-500">
                {item.day}
              </span>

              <PlayCircle className="text-blue-400" size={20} />
            </div>

            <h3 className="mt-5 min-h-[56px] text-lg font-bold text-white">
              {item.title}
            </h3>

            <div className="mt-5 flex items-center gap-2 text-sm text-gray-400">
              <Clock size={16} className="text-blue-400" />
              {item.time}
            </div>

            <span className="mt-4 inline-flex rounded-full bg-blue-500/10 px-3 py-1 text-xs text-blue-300">
              {item.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}