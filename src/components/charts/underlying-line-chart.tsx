"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { PerformanceSnapshotData } from "@/lib/types";

export function UnderlyingLineChart({
  snapshots,
  strike,
  alert1,
  alert2,
}: {
  snapshots: PerformanceSnapshotData[];
  strike: number;
  alert1?: number | null;
  alert2?: number | null;
}) {
  const data = snapshots.map((snapshot) => ({
    label: new Date(snapshot.observedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    underlyingPrice: snapshot.underlyingPrice,
  }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="4 4" />
          <XAxis dataKey="label" stroke="rgba(148, 163, 184, 0.7)" />
          <YAxis stroke="rgba(148, 163, 184, 0.7)" domain={["dataMin - 1", "dataMax + 1"]} />
          <Tooltip
            contentStyle={{
              backgroundColor: "rgba(7, 17, 30, 0.94)",
              border: "1px solid rgba(148, 163, 184, 0.2)",
              borderRadius: "16px",
            }}
          />
          <ReferenceLine y={strike} stroke="#d05656" strokeDasharray="6 6" />
          {alert1 ? <ReferenceLine y={alert1} stroke="#dbb463" strokeDasharray="4 4" /> : null}
          {alert2 ? <ReferenceLine y={alert2} stroke="#88b4ff" strokeDasharray="4 4" /> : null}
          <Line
            type="monotone"
            dataKey="underlyingPrice"
            stroke="#88b4ff"
            strokeWidth={3}
            dot={{ r: 4, fill: "#88b4ff" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
