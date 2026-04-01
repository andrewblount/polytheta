import { StatusDistributionChart } from "@/components/charts/status-distribution-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent } from "@/lib/format";
import { getAnalyticsSummary } from "@/server/repos/baskets";

export default async function AnalyticsPage() {
  const analytics = await getAnalyticsSummary();

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Baskets tracked" value={String(analytics.basketsTracked)} />
        <StatCard title="Live positions" value={String(analytics.livePositions)} />
        <StatCard title="Resolved positions" value={String(analytics.resolvedPositions)} />
        <StatCard
          title="Average capture"
          value={formatPercent(analytics.averageCreditCapturePct, 0)}
          description={`Aggregate P/L ${formatCurrency(analytics.estimatedPnl)}`}
        />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Status distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusDistributionChart statusCounts={analytics.statusCounts} />
        </CardContent>
      </Card>
    </div>
  );
}
