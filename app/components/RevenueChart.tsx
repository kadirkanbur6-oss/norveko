"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const totalViews = 57506;
const rpm = 1.8;
const estimatedRevenue = (totalViews / 1000) * rpm;

const chartData = [
  { name: "Jan", revenue: 4 },
  { name: "Feb", revenue: 7 },
  { name: "Mar", revenue: 6 },
  { name: "Apr", revenue: 11 },
  { name: "May", revenue: 9 },
  { name: "Jun", revenue: 13 },
  { name: "Jul", revenue: 16 },
  { name: "Aug", revenue: 20 },
  { name: "Sep", revenue: 18 },
  { name: "Oct", revenue: 24 },
  { name: "Nov", revenue: 27 },
  { name: "Dec", revenue: Number(estimatedRevenue.toFixed(2)) },
];

export default function RevenueChart() {
  return (
    <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Revenue Overview</h2>
          <p className="mt-1 text-sm text-gray-400">
            Estimated creator revenue based on YouTube views.
          </p>
        </div>

        <span className="rounded-full border border-blue-400/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-200">
          RPM ${rpm}
        </span>
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis dataKey="name" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip
              contentStyle={{
                backgroundColor: "#0f172a",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "16px",
                color: "white",
              }}
            />
            <Bar dataKey="revenue" radius={[12, 12, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl bg-black/25 p-4">
          <p className="text-sm text-gray-400">Total Views</p>
          <h3 className="mt-2 text-3xl font-black">
            {totalViews.toLocaleString("tr-TR")}
          </h3>
        </div>

        <div className="rounded-2xl bg-black/25 p-4">
          <p className="text-sm text-gray-400">Estimated Revenue</p>
          <h3 className="mt-2 text-3xl font-black">
            ${estimatedRevenue.toFixed(2)}
          </h3>
        </div>

        <div className="rounded-2xl bg-black/25 p-4">
          <p className="text-sm text-gray-400">Estimated RPM</p>
          <h3 className="mt-2 text-3xl font-black">${rpm}</h3>
        </div>
      </div>
    </section>
  );
}