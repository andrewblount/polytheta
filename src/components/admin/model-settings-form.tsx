"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PercentSlider } from "@/components/ui/percent-slider";
import { formatCurrency } from "@/lib/format";
import { computeModelPerformance, SLIDER_RANGES, type PerformanceWeekSource, type SizingSettings } from "@/lib/model-sizing";

// The model sizing form with a live preview: the settled track record is
// recalculated from the published legs as the sliders move, before anything
// is saved.
export function ModelSettingsForm({ initial, source, action }: { initial: SizingSettings; source: PerformanceWeekSource[]; action: (formData: FormData) => Promise<void> }) {
  const [settings, setSettings] = useState<SizingSettings>(initial);
  const preview = useMemo(() => computeModelPerformance(source, settings), [source, settings]);
  const update = (patch: Partial<SizingSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const { stats } = preview;

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm">Model equity ($)
        <Input name="modelEquity" type="number" required min={1000} max={1000000000} step={1000} value={settings.modelEquity} onChange={(e) => update({ modelEquity: Number(e.target.value) })} />
      </label>
      <div className="rounded-2xl border border-border/60 bg-background/40 p-4 text-sm">
        <p className="eyebrow text-[10px] text-muted-foreground">Track record under these settings</p>
        <p className={`mt-2 text-2xl font-semibold ${stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(stats.totalPnl)}</p>
        <p className="text-xs text-muted-foreground">
          {stats.completeWeeks} settled weeks · {stats.winningWeeks} winning · avg {formatCurrency(stats.avgWeeklyPnl)}/week · max drawdown {formatCurrency(stats.maxDrawdown)}
        </p>
      </div>
      <PercentSlider name="accountTradedPct" label="Percentage of account traded" defaultValue={initial.accountTradedPct} {...SLIDER_RANGES.accountTradedPct} onChange={(v) => update({ accountTradedPct: v })} />
      <PercentSlider name="marginAvailablePct" label="Margin available" defaultValue={initial.marginAvailablePct} {...SLIDER_RANGES.marginAvailablePct} onChange={(v) => update({ marginAvailablePct: v })}
        hint="400% backs four dollars of strike or spot notional per committed dollar. 100% reproduces the cash-backed sizing of the original track record." />
      <div className="grid gap-3 text-sm sm:col-span-2">
        <label className="flex items-center gap-3"><input type="checkbox" name="sellCalls" checked={settings.sellCalls} onChange={(e) => update({ sellCalls: e.target.checked })} />Sell calls</label>
        <label className="flex items-center gap-3"><input type="checkbox" name="sellPuts" checked={settings.sellPuts} onChange={(e) => update({ sellPuts: e.target.checked })} />Sell puts</label>
        <span className="text-xs text-muted-foreground">With both on, the call/put split in the IB settings sets the counts. One off routes the whole basket to the other side; GSRS 5+ still blocks new puts.</span>
      </div>
      <Button type="submit" className="sm:col-span-2">Save model settings</Button>
    </form>
  );
}
