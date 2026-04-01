import { StatCard } from "@/components/dashboard/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { getAnalyticsSummary, listBaskets, listSyncJobs } from "@/server/repos/baskets";

export default async function AdminDashboardPage() {
  const [analytics, baskets, syncJobs] = await Promise.all([
    getAnalyticsSummary(),
    listBaskets(),
    listSyncJobs(),
  ]);

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Tracked baskets" value={String(baskets.length)} />
        <StatCard title="Live positions" value={String(analytics.livePositions)} />
        <StatCard title="Resolved positions" value={String(analytics.resolvedPositions)} />
        <StatCard title="Aggregate P/L" value={formatCurrency(analytics.estimatedPnl)} />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Recent sync jobs</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {syncJobs.slice(0, 5).map((job) => (
            <div key={job.id} className="rounded-2xl border border-border/70 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{job.jobType}</p>
                <p className="text-muted-foreground">{job.status}</p>
              </div>
              <p className="mt-2 text-muted-foreground">{job.notes}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
