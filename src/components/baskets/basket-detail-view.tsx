import { formatCurrency, formatDateLabel, formatDateTimeLabel } from "@/lib/format";
import type { BasketData } from "@/lib/types";

import { OrderBlockCard } from "@/components/baskets/order-block-card";
import { ResponsivePositionTable } from "@/components/baskets/responsive-position-table";
import { resolvedSnapshot } from "@/components/baskets/settled-outcome";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function BasketDetailView({ basket }: { basket: BasketData }) {
  // The archive reads best when the week's verdict sits next to its
  // reasoning. Only spoken once every leg has actually settled.
  const allPositions = [...basket.callPositions, ...basket.putPositions];
  const settledLegs = allPositions
    .map((position) => ({ position, snapshot: resolvedSnapshot(position) }))
    .filter((entry) => entry.snapshot !== null);
  const fullySettled =
    allPositions.length > 0 && settledLegs.length === allPositions.length;
  const settledPnl = settledLegs.reduce(
    (sum, entry) => sum + (entry.snapshot?.pnlAmount ?? 0),
    0,
  );
  const settledWinners = settledLegs.filter(
    (entry) => (entry.snapshot?.pnlAmount ?? 0) >= 0,
  ).length;
  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <Card className="data-grid overflow-hidden">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="accent">{basket.status}</Badge>
              <Badge variant="default">GSRS {basket.gsrs}</Badge>
              <Badge variant="success">{basket.radarStatus}</Badge>
            </div>
            <CardTitle className="mt-4 text-4xl">{basket.title}</CardTitle>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
              Published {formatDateTimeLabel(basket.publicationDate)}. Last refresh{" "}
              {formatDateTimeLabel(basket.lastRefreshAt)}.
            </p>
            {fullySettled ? (
              <p
                className={`mt-2 text-sm font-semibold ${
                  settledPnl >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                Settled. {settledWinners} of {settledLegs.length} legs kept their
                credit, {settledPnl >= 0 ? "+" : "\u2212"}
                {formatCurrency(Math.abs(settledPnl))} modeled for the week.
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {basket.quickSummary.map((metric) => (
              <div
                key={metric.label}
                className="rounded-3xl border border-border/70 bg-background/50 p-4"
              >
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {metric.label}
                </p>
                <p className="mt-3 text-2xl font-semibold">{metric.value}</p>
                {metric.hint ? (
                  <p className="mt-2 text-xs text-muted-foreground">{metric.hint}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <p className="eyebrow text-[10px] text-muted-foreground">Risk disclosure</p>
            <CardTitle className="mt-3">Read before execution</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm leading-7 text-muted-foreground">
            {basket.disclaimer}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Market conditions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm leading-7 text-muted-foreground">
              {basket.marketConditions.narrative}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[
                ["VIX", basket.marketConditions.vix.toFixed(2)],
                ["SKEW", basket.marketConditions.skew.toFixed(0)],
                ["HY OAS", `${basket.marketConditions.hyOas.toFixed(2)}%`],
                ["MOVE", basket.marketConditions.move.toFixed(0)],
                ["P/C Ratio", basket.marketConditions.putCallRatio.toFixed(2)],
                ["GSRS note", basket.marketConditions.gsrsNote],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-border/70 p-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="mt-3 text-sm font-medium leading-6">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Portfolio summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {[
              ["Week of", formatDateLabel(basket.weekOf)],
              ["Total names", String(basket.portfolioSummary.totalNames)],
              ["Call / put split", `${basket.portfolioSummary.callCount} / ${basket.portfolioSummary.putCount}`],
              ["Total margin", formatCurrency(basket.portfolioSummary.totalMargin)],
              ["Cash needed", formatCurrency(basket.portfolioSummary.cashNeeded)],
              ["Est. credit", formatCurrency(basket.portfolioSummary.totalEstimatedCredit)],
              ["Daily theta", formatCurrency(basket.portfolioSummary.dailyTheta)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium text-right">{value}</span>
              </div>
            ))}
            <Separator />
            <p className="text-muted-foreground">{basket.portfolioSummary.concentrationNote}</p>
            <p className="text-muted-foreground">{basket.portfolioSummary.gsrsConstraintNote}</p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow text-[10px] text-muted-foreground">Call side</p>
            <h2 className="mt-2 text-2xl font-semibold">Short premium against weak or hyped names</h2>
          </div>
        </div>
        <ResponsivePositionTable positions={basket.callPositions} />
      </section>

      <section className="space-y-4">
        <div>
          <p className="eyebrow text-[10px] text-muted-foreground">Put side</p>
          <h2 className="mt-2 text-2xl font-semibold">Supported names with stronger dip-buy behavior</h2>
        </div>
        <ResponsivePositionTable positions={basket.putPositions} />
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mean-reversion buffer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {basket.meanReversionBuffer.map((item) => (
              <div key={item.label} className="rounded-2xl border border-border/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{item.label}</p>
                  <p className="text-sm">{item.value}</p>
                </div>
                {item.hint ? (
                  <p className="mt-2 text-sm text-muted-foreground">{item.hint}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Rules & targets</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            {basket.hardStops.concat(basket.profitTargets).map((rule) => (
              <div key={rule.id} className="rounded-2xl border border-border/70 p-4">
                <p className="font-medium">{rule.title}</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">{rule.body}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {basket.orderBlocks.length > 0 ? (
        <section className="space-y-4">
          <div>
            <p className="eyebrow text-[10px] text-muted-foreground">Execution</p>
            <h2 className="mt-2 text-2xl font-semibold">Broker order blocks</h2>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            {basket.orderBlocks.map((orderBlock) => (
              <OrderBlockCard key={orderBlock.id} orderBlock={orderBlock} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Price alerts</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {basket.priceAlerts.map((alert) => (
              <div key={alert.id} className="rounded-2xl border border-border/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">
                    {alert.ticker} · {alert.label}
                  </p>
                  <p className="text-sm">{formatCurrency(alert.thresholdValue)}</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{alert.protocolNote}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {basket.freeformNotes.map((note) => (
              <p key={note} className="rounded-2xl border border-border/70 p-4 text-sm leading-7 text-muted-foreground">
                {note}
              </p>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
