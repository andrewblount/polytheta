import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateLabel } from "@/lib/format";
import { listBaskets } from "@/server/repos/baskets";

export default async function BasketArchivePage() {
  const baskets = await listBaskets();

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow text-[10px] text-muted-foreground">Archive</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Historical weekly baskets</h1>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {baskets.map((basket) => (
          <Card key={basket.id}>
            <CardHeader>
              <p className="eyebrow text-[10px] text-muted-foreground">{basket.status}</p>
              <CardTitle className="mt-3 text-2xl">
                <Link href={`/app/baskets/${basket.slug}`}>{basket.title}</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <ArchiveMetric label="Week of" value={formatDateLabel(basket.weekOf)} />
              <ArchiveMetric label="GSRS" value={String(basket.gsrs)} />
              <ArchiveMetric label="Cash needed" value={formatCurrency(basket.cashNeeded)} />
              <ArchiveMetric
                label="Estimated credit"
                value={formatCurrency(basket.portfolioSummary.totalEstimatedCredit)}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ArchiveMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 p-4">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-3 font-medium">{value}</p>
    </div>
  );
}
