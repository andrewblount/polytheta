"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { AnalyticsSummary } from "@/lib/types";

export function StatusDistributionChart({
  statusCounts,
}: Pick<AnalyticsSummary, "statusCounts">) {
  const data = statusCounts.map((item) => ({
    name: item.state.replace(/-/g, " "),
    value: item.count,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="4 4" />
          <XAxis dataKey="name" stroke="rgba(148, 163, 184, 0.7)" />
          <YAxis stroke="rgba(148, 163, 184, 0.7)" allowDecimals={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(7, 17, 30, 0.94)",
              border: "1px solid rgba(148, 163, 184, 0.2)",
              borderRadius: "16px",
            }}
          />
          <Bar dataKey="value" fill="#88b4ff" radius={[12, 12, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
