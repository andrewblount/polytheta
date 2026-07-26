import Link from "next/link";

import { WeeklyPnlChart } from "@/components/charts/weekly-pnl-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { getPerformanceReport } from "@/server/repos/performance";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const report = await getPerformanceReport();

  if (!report || report.stats.completeWeeks === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No settled baskets yet. Performance appears here once a basket reaches expiry.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { weeks, cumulative, stats } = report;
  const settledWeeks = [...weeks].filter((w) => w.complete).reverse();

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Modeled P&L (all settled weeks)"
          value={formatCurrency(stats.totalPnl)}
          description={`${stats.completeWeeks} settled weeks · avg ${formatCurrency(stats.avgWeeklyPnl)}/week`}
        />
        <StatCard
          title="Weekly hit rate"
          value={`${stats.winningWeeks}/${stats.completeWeeks}`}
          description={`Legs expiring worthless: ${stats.legWinRatePct}% of ${stats.settledLegs}`}
        />
        <StatCard
          title="Avg win vs avg loss"
          value={`${formatCurrency(stats.avgWinningWeek)} / ${formatCurrency(stats.avgLosingWeek)}`}
          description={`Best ${formatCurrency(stats.bestWeek)} · worst ${formatCurrency(stats.worstWeek)}`}
        />
        <StatCard
          title="Max drawdown (cumulative)"
          value={formatCurrency(stats.maxDrawdown)}
          description={
            stats.worstLeg
              ? `Worst leg: ${stats.worstLeg.ticker} ${stats.worstLeg.side} ${formatCurrency(stats.worstLeg.pnl)}`
              : undefined
          }
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Weekly P&L and cumulative curve</CardTitle>
          <p className="text-xs text-muted-foreground">
            Modeled from recommended entries held to expiry — no doubles, no stops, no early
            profit-taking. This measures recommendation quality, not executed trades.
          </p>
        </CardHeader>
        <CardContent>
          <WeeklyPnlChart data={cumulative} />
        </CardContent>
      </Card>

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
                      <Link className="underline-offset-4 hover:underline" href={`/app/baskets/${week.slug}`}>
                        {week.weekOf}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{week.gsrs.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">
                      {week.wins}/{week.settledLegs}
                    </td>
                    <td className={`py-2 pr-4 text-right font-medium ${week.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {formatCurrency(week.pnl)}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {week.romPct != null ? `${week.romPct.toFixed(2)}%` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {week.worstLeg ? (
                        <span className="inline-flex items-center gap-2">
                          <Badge variant="accent">
                            {week.worstLeg.ticker} {week.worstLeg.side}
                          </Badge>
                          <span className={week.worstLeg.pnl >= 0 ? "text-muted-foreground" : "text-red-400"}>
                            {formatCurrency(week.worstLeg.pnl)}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
