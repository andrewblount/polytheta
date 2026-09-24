"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";

import { WeeklyPnlChart } from "@/components/charts/weekly-pnl-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { computeModelPerformance, SLIDER_RANGES, type PerformanceWeekSource, type SizingSettings } from "@/lib/model-sizing";

interface Props {
  source: PerformanceWeekSource[];
  initial: SizingSettings;
  // Admins' slider releases are saved as the model settings; members explore
  // sizing locally without changing the model.
  canSave: boolean;
  save?: (settings: SizingSettings) => Promise<SizingSettings>;
}

// The model track record, recalculated in the browser from the published legs
// as the sizing sliders move. Saving happens on release (and on toggle), so
// dragging never hits the server; the model settings page shows the same values.
export function ModelSizingExplorer({ source, initial, canSave, save }: Props) {
  const [settings, setSettings] = useState<SizingSettings>(initial);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const lastSaved = useRef<SizingSettings>(initial);
  const pending = useRef<SizingSettings | null>(null);

  const report = useMemo(() => computeModelPerformance(source, settings), [source, settings]);
  const settledWeeks = useMemo(() => [...report.weeks].filter((w) => w.complete).reverse(), [report]);

  function commit(next: SizingSettings) {
    if (!canSave || !save) return;
    const changed = (Object.keys(next) as (keyof SizingSettings)[]).some((k) => next[k] !== lastSaved.current[k]);
    if (!changed) return;
    pending.current = next;
    setSaveState("saving");
    startTransition(async () => {
      try {
        const saved = await save(next);
        // A later release supersedes this one; only the latest result lands.
        if (pending.current === next) { lastSaved.current = saved; setSettings(saved); setSaveState("saved"); setSaveError(null); }
      } catch (error) {
        if (pending.current === next) { setSaveState("error"); setSaveError(error instanceof Error ? error.message : "Could not save model settings"); }
      }
    });
  }

  const update = (patch: Partial<SizingSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const toggle = (key: "sellCalls" | "sellPuts", value: boolean) => { const next = { ...settings, [key]: value }; setSettings(next); commit(next); };
  const { stats, cumulative, basis } = report;

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Model sizing</CardTitle>
          <p className="text-xs text-muted-foreground">
            Drag to re-size every historical leg from the model settings. The track record below recalculates as you move
            {canSave ? "; the setting is saved when you let go and sizes the next published basket." : ". Sign in as an admin to change the model itself."}
          </p>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <SliderField
            label="Percentage of account traded"
            value={settings.accountTradedPct}
            display={`${settings.accountTradedPct}%`}
            range={SLIDER_RANGES.accountTradedPct}
            onChange={(v) => update({ accountTradedPct: v })}
            onRelease={(v) => commit({ ...settings, accountTradedPct: v })}
            hint={`${formatCurrency(settings.modelEquity)} model equity × ${settings.accountTradedPct}% = ${formatCurrency((settings.modelEquity * settings.accountTradedPct) / 100)} committed`}
          />
          <SliderField
            label="Margin available"
            value={settings.marginAvailablePct}
            display={`${settings.marginAvailablePct}%`}
            range={SLIDER_RANGES.marginAvailablePct}
            onChange={(v) => update({ marginAvailablePct: v })}
            onRelease={(v) => commit({ ...settings, marginAvailablePct: v })}
            hint={`Backs ${formatCurrency(basis.backing ?? 0)} of strike-or-spot notional per basket. 100% is the original cash-backed sizing.`}
          />
          <div className="flex flex-wrap items-center gap-6 text-sm lg:col-span-2">
            <label className="flex items-center gap-3"><input type="checkbox" checked={settings.sellCalls} onChange={(e) => toggle("sellCalls", e.target.checked)} />Sell calls</label>
            <label className="flex items-center gap-3"><input type="checkbox" checked={settings.sellPuts} onChange={(e) => toggle("sellPuts", e.target.checked)} />Sell puts</label>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {saveState === "saving" ? "Saving model settings…" : saveState === "saved" ? "Saved — the model uses these settings." : saveState === "error" ? `Not saved: ${saveError}` : canSave ? (
                <>Model equity {formatCurrency(settings.modelEquity)} is set under <Link href="/app/settings" className="underline">Settings</Link>.</>
              ) : null}
            </span>
          </div>
        </CardContent>
      </Card>

      {stats.completeWeeks === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No settled weeks under these settings. With one side off, or the backing too small to buy a single contract, every basket drops out; move the sliders back up.
          </CardContent>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title="Modeled P&L (all settled weeks)" value={formatCurrency(stats.totalPnl)} description={`${stats.completeWeeks} settled weeks · avg ${formatCurrency(stats.avgWeeklyPnl)}/week`} />
            <StatCard title="Weekly hit rate" value={`${stats.winningWeeks}/${stats.completeWeeks}`} description={`Legs expiring worthless: ${stats.legWinRatePct}% of ${stats.settledLegs}`} />
            <StatCard title="Avg win vs avg loss" value={`${formatCurrency(stats.avgWinningWeek)} / ${formatCurrency(stats.avgLosingWeek)}`} description={`Best ${formatCurrency(stats.bestWeek)} · worst ${formatCurrency(stats.worstWeek)}`} />
            <StatCard title="Max drawdown (cumulative)" value={formatCurrency(stats.maxDrawdown)} description={stats.worstLeg ? `Worst leg: ${stats.worstLeg.ticker} ${stats.worstLeg.side} ${formatCurrency(stats.worstLeg.pnl)}` : undefined} />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Weekly P&L and cumulative curve</CardTitle>
              <p className="text-xs text-muted-foreground">
                Modeled from recommended entries held to expiry or exited on a radar signal — no doubles, no early profit-taking. This measures recommendation quality, not executed trades.
                {" "}Every leg is sized at equity {formatCurrency(basis.modelEquity ?? 0)}, {basis.accountTradedPct}% traded, {basis.marginAvailablePct}% margin available{!basis.sellCalls ? ", calls off" : ""}{!basis.sellPuts ? ", puts off" : ""}.
              </p>
            </CardHeader>
            <CardContent>
              <WeeklyPnlChart data={cumulative} />
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Settled weeks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-4">Week</th>
                  <th className="py-2 pr-4">GSRS</th>
                  <th className="py-2 pr-4 text-right">Legs OTM</th>
                  <th className="py-2 pr-4 text-right">P&L</th>
                  <th className="py-2 pr-4 text-right">RoM</th>
                  <th className="py-2 pr-4">Worst leg</th>
                </tr>
              </thead>
              <tbody>
                {settledWeeks.map((week) => (
                  <tr key={week.slug} className="border-b border-border/40">
                    <td className="py-2 pr-4">
                      <Link className="underline-offset-4 hover:underline" href={`/app/baskets/${week.slug}`}>{week.weekOf}</Link>
                    </td>
                    <td className="py-2 pr-4">{week.gsrs.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">{week.wins}/{week.settledLegs}</td>
                    <td className={`py-2 pr-4 text-right font-medium ${week.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatCurrency(week.pnl)}</td>
                    <td className="py-2 pr-4 text-right">{week.romPct != null ? `${week.romPct.toFixed(2)}%` : "—"}</td>
                    <td className="py-2 pr-4">
                      {week.worstLeg ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge variant="accent">{week.worstLeg.ticker} {week.worstLeg.side}</Badge>
                          <span className={week.worstLeg.pnl >= 0 ? "text-muted-foreground" : "text-red-400"}>{formatCurrency(week.worstLeg.pnl)}</span>
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
                {settledWeeks.length === 0 ? (
                  <tr><td colSpan={6} className="py-3 text-muted-foreground">No settled weeks under these settings.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SliderField({ label, value, display, range, hint, onChange, onRelease }: {
  label: string; value: number; display: string; range: { min: number; max: number; step: number }; hint?: string;
  onChange: (value: number) => void; onRelease: (value: number) => void;
}) {
  const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id}>{label}</label>
        <span className="font-mono text-base font-semibold tabular-nums">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        className="w-full accent-[var(--accent)]"
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onRelease(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onRelease(Number((e.target as HTMLInputElement).value))}
        onBlur={(e) => onRelease(Number(e.target.value))}
        aria-valuetext={display}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground"><span>{range.min}%</span><span>{range.max}%</span></div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
