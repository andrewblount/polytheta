import Link from "next/link";

import { StatCard } from "@/components/dashboard/stat-card";
import { ResponsivePositionTable } from "@/components/baskets/responsive-position-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTimeLabel } from "@/lib/format";
import { getDashboardData } from "@/server/repos/baskets";
import { getCurrentAppUser } from "@/server/auth/user";
import { getMemberPerformance } from "@/server/services/member-performance";

export default async function DashboardPage() {
  const dashboard = await getDashboardData();
  const basket = dashboard.currentBasket;
  const user = await getCurrentAppUser();
  const member = user ? await getMemberPerformance(user) : null;

  return (
    <div className="space-y-8">
      {member ? (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-xs text-muted-foreground">Your account</p>
              <h2 className="mt-2 text-2xl font-semibold">
                {formatCurrency(member.currentValue)}
              </h2>
            </div>
            <Link href="/app/settings" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              Adjust tracking
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Starting amount"
              value={formatCurrency(member.startingCapital)}
              description={member.trackingStartDate ? `Tracking since ${member.trackingStartDate}` : "Tracking full history"}
            />
            <StatCard
              title="Total return"
              value={`${member.totalReturn >= 0 ? "+" : "−"}${formatCurrency(Math.abs(member.totalReturn))}`}
              description={`${member.totalReturnPct >= 0 ? "+" : ""}${member.totalReturnPct}% over ${member.weeksTracked} settled weeks`}
            />
            <StatCard
              title="This week (modeled)"
              value={
                member.liveWeekPnl != null
                  ? `${member.liveWeekPnl >= 0 ? "+" : "−"}${formatCurrency(Math.abs(member.liveWeekPnl))}`
                  : "—"
              }
              description="Live basket P&L scaled to your capital"
            />
            <StatCard
              title="Best settled week"
              value={
                member.weeks.length > 0
                  ? `${Math.max(...member.weeks.map((w) => w.returnPct)).toFixed(2)}%`
                  : "—"
              }
              description={
                member.weeks.length > 0
                  ? `Worst ${Math.min(...member.weeks.map((w) => w.returnPct)).toFixed(2)}%`
                  : "No settled weeks in range yet"
              }
            />
          </div>
        </section>
      ) : user && user.role === "member" ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
            <p className="text-sm text-muted-foreground">
              Set your starting amount to see the baskets&apos; returns tracked on your own capital.
            </p>
            <Button asChild>
              <Link href="/app/settings">Set up tracking</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
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
              <p className="eyebrow text-xs text-muted-foreground">Current basket</p>
              <CardTitle className="mt-3 text-2xl">{basket.title}</CardTitle>
            </div>
            <Button asChild>
              <Link href={`/app/baskets/${basket.slug}`}>Open basket</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {basket.quickSummary.map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-border/70 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">{metric.label}</p>
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
          <p className="eyebrow text-xs text-muted-foreground">Live positions</p>
          <h2 className="mt-2 text-2xl font-semibold">What needs attention now</h2>
        </div>
        <ResponsivePositionTable positions={dashboard.livePositions} />
      </section>
    </div>
  );
}
