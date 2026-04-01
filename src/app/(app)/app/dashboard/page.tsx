import Link from "next/link";

import { StatCard } from "@/components/dashboard/stat-card";
import { ResponsivePositionTable } from "@/components/baskets/responsive-position-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTimeLabel } from "@/lib/format";
import { getDashboardData } from "@/server/repos/baskets";

export default async function DashboardPage() {
  const dashboard = await getDashboardData();
  const basket = dashboard.currentBasket;

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Current GSRS" value={String(basket.gsrs)} description={basket.marketConditions.gsrsNote} />
        <StatCard title="Cash needed" value={formatCurrency(basket.cashNeeded)} description="4x leverage assumption" />
        <StatCard title="Estimated credit" value={formatCurrency(basket.portfolioSummary.totalEstimatedCredit)} description="Basket-level entry estimate" />
        <StatCard title="Daily theta" value={formatCurrency(basket.portfolioSummary.dailyTheta)} description={`Last refresh ${formatDateTimeLabel(dashboard.latestRefreshAt)}`} />
      </section>
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <p className="eyebrow text-[10px] text-muted-foreground">Current basket</p>
              <CardTitle className="mt-3 text-2xl">{basket.title}</CardTitle>
            </div>
            <Button asChild>
              <Link href={`/app/baskets/${basket.slug}`}>Open basket</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {basket.quickSummary.map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-border/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{metric.label}</p>
                <p className="mt-3 text-lg font-semibold">{metric.value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Warning watchlist</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {dashboard.warningPositions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No live warnings right now.</p>
            ) : (
              dashboard.warningPositions.map((position) => (
                <Link
                  key={position.id}
                  href={`/app/positions/${position.id}`}
                  className="rounded-2xl border border-border/70 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{position.ticker}</p>
                    <p className="text-sm text-muted-foreground">
                      {position.latestPerformance.state}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{position.thesisSummary}</p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </section>
      <section className="space-y-4">
        <div>
          <p className="eyebrow text-[10px] text-muted-foreground">Live positions</p>
          <h2 className="mt-2 text-2xl font-semibold">What needs attention now</h2>
        </div>
        <ResponsivePositionTable positions={dashboard.livePositions} />
      </section>
    </div>
  );
}
