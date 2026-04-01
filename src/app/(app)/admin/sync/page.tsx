import { runManualSyncAction } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listSyncJobs } from "@/server/repos/baskets";

export default async function AdminSyncPage() {
  const jobs = await listSyncJobs();

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-[10px] text-muted-foreground">Market sync</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Sync status and logs</h1>
        </div>
        <form action={runManualSyncAction}>
          <Button type="submit">Run manual sync</Button>
        </form>
      </div>
      <div className="grid gap-4">
        {jobs.map((job) => (
          <Card key={job.id}>
            <CardHeader>
              <CardTitle>{job.jobType}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-muted-foreground">
              <p>Status: {job.status}</p>
              <p>Processed: {job.positionsProcessed}</p>
              <p>Errors: {job.errorsCount}</p>
              <p>{job.notes}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
