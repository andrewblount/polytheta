"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface WeeklyPnlChartProps {
  data: { weekOf: string; pnl: number; cumulative: number }[];
}

const fmt = (v: number) =>
  `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;

export function WeeklyPnlChart({ data }: WeeklyPnlChartProps) {
  const chartData = data.map((d) => ({
    ...d,
    label: d.weekOf.slice(5), // MM-DD
  }));

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="4 4" />
          <XAxis dataKey="label" stroke="rgba(148, 163, 184, 0.7)" />
          <YAxis
            yAxisId="left"
            stroke="rgba(148, 163, 184, 0.7)"
            tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="rgba(136, 180, 255, 0.8)"
            tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
          />
          <Tooltip
            formatter={(value, name) => [
              fmt(Number(value)),
              String(name) === "pnl" ? "Week P&L" : "Cumulative",
            ]}
            labelFormatter={(label) => `Week of ${label}`}
            contentStyle={{
              backgroundColor: "rgba(7, 17, 30, 0.94)",
              border: "1px solid rgba(148, 163, 184, 0.2)",
              borderRadius: "16px",
            }}
          />
          <Bar yAxisId="left" dataKey="pnl" radius={[8, 8, 0, 0]}>
            {chartData.map((entry) => (
              <Cell
                key={entry.weekOf}
                fill={entry.pnl >= 0 ? "rgba(94, 190, 131, 0.85)" : "rgba(208, 86, 86, 0.9)"}
              />
            ))}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cumulative"
            stroke="#88b4ff"
            strokeWidth={2}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
