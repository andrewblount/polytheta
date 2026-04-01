import { UnderlyingLineChart } from "@/components/charts/underlying-line-chart";
import { PositionStateBadge } from "@/components/baskets/position-state-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateTimeLabel, formatPercent } from "@/lib/format";
import type { PositionDetailData } from "@/lib/types";

export function PositionDetailView({ position }: { position: PositionDetailData }) {
  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <PositionStateBadge state={position.latestPerformance.state} />
              <p className="eyebrow text-[10px] text-muted-foreground">
                {position.side} · {position.expiry}
              </p>
            </div>
            <CardTitle className="mt-4 text-4xl">
              {position.ticker} · {formatCurrency(position.strike)} {position.optionType}
            </CardTitle>
            <p className="text-sm leading-7 text-muted-foreground">{position.thesisSummary}</p>
          </CardHeader>
          <CardContent>
            <UnderlyingLineChart
              snapshots={position.performanceHistory}
              strike={position.strike}
              alert1={position.breakAlert1}
              alert2={position.breakAlert2}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Live position state</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {[
              ["Entry underlying", formatCurrency(position.entryUnderlyingPrice)],
              ["Latest underlying", formatCurrency(position.latestPerformance.underlyingPrice)],
              ["Underlying move", formatPercent(position.latestPerformance.underlyingMovePct, 1)],
              ["Safety buffer", formatPercent(position.latestPerformance.safetyBufferPct, 1)],
              ["Credit capture", formatPercent(position.latestPerformance.creditCapturePct, 0)],
              ["P/L", formatCurrency(position.latestPerformance.pnlAmount)],
              ["Confidence", position.latestPerformance.confidence],
              ["Last refresh", formatDateTimeLabel(position.latestPerformance.observedAt)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recommendation details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {[
              ["IV rank", `${position.ivRank}`],
              ["Short interest", `${position.shortInterestPctFloat}%`],
              ["Fan score", `${position.fanScore}`],
              ["Glassdoor", `${position.glassdoorScore}`],
              ["Buyback score", `${position.buybackScore}`],
              ["Estimated entry credit", formatCurrency(position.estimatedEntryCredit)],
              ["Contracts", `${position.contracts}`],
              ["Margin", formatCurrency(position.margin)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Thesis & flags</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {position.thesisBullets.map((bullet) => (
              <p key={bullet} className="rounded-2xl border border-border/70 p-4 text-muted-foreground">
                {bullet}
              </p>
            ))}
            {position.cautionFlags.map((flag) => (
              <p key={flag} className="rounded-2xl border border-warning/20 bg-warning/10 p-4 text-warning">
                {flag}
              </p>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
