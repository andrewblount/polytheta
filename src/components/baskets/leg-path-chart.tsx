"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { PricePoint } from "@/lib/leg-analysis";

// The underlying's price path for one short option, with the strike drawn as
// the alert line, the entry price and the breakeven (strike ± credit).
export function LegPathChart({ points, side, lines }: { points: PricePoint[]; side: "call" | "put"; lines: { strike: number; entry: number; breakeven: number } }) {
  if (points.length === 0) {
    return <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">Price history unavailable for this leg.</div>;
  }
  const data = points.map((p) => ({ t: p.t, price: p.p, label: new Date(p.t).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric" }) }));
  const values = [...points.map((p) => p.p), lines.strike, lines.entry, lines.breakeven];
  const min = Math.min(...values), max = Math.max(...values);
  const pad = Math.max((max - min) * 0.08, 0.05);
  const through = side === "call" ? Math.max(...points.map((p) => p.h ?? p.p)) > lines.strike : Math.min(...points.map((p) => p.l ?? p.p)) < lines.strike;
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 56, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" strokeDasharray="4 4" />
          <XAxis dataKey="label" stroke="rgba(148, 163, 184, 0.7)" minTickGap={48} tick={{ fontSize: 11 }} />
          <YAxis domain={[+(min - pad).toFixed(2), +(max + pad).toFixed(2)]} stroke="rgba(148, 163, 184, 0.7)" tick={{ fontSize: 11 }} width={48} tickFormatter={(v: number) => v.toFixed(v >= 100 ? 0 : 2)} />
          <Tooltip formatter={(value) => [`$${Number(value).toFixed(2)}`, "Price"]} labelFormatter={(label) => `${label} ET`}
            contentStyle={{ backgroundColor: "rgba(7, 17, 30, 0.94)", border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: "12px", fontSize: 12 }} />
          <ReferenceLine y={lines.strike} stroke={through ? "#ef4444" : "#f59e0b"} strokeWidth={2} label={{ value: `Strike ${lines.strike.toFixed(2)}`, position: "right", fill: through ? "#ef4444" : "#f59e0b", fontSize: 11 }} />
          <ReferenceLine y={lines.breakeven} stroke="rgba(239, 68, 68, 0.6)" strokeDasharray="3 3" label={{ value: `B/E ${lines.breakeven.toFixed(2)}`, position: "right", fill: "rgba(239, 68, 68, 0.8)", fontSize: 10 }} />
          <ReferenceLine y={lines.entry} stroke="rgba(148, 163, 184, 0.7)" strokeDasharray="6 3" label={{ value: `Entry ${lines.entry.toFixed(2)}`, position: "right", fill: "rgba(148, 163, 184, 0.9)", fontSize: 10 }} />
          <Line type="monotone" dataKey="price" stroke="#88b4ff" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
