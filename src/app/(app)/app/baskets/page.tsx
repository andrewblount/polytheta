import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDateLabel } from "@/lib/format";
import { listBaskets } from "@/server/repos/baskets";
import { getPerformanceReport } from "@/server/repos/performance";

export default async function BasketArchivePage() {
  const [baskets, report] = await Promise.all([listBaskets(), getPerformanceReport()]);
  const outcomeBySlug = new Map(
    (report?.weeks ?? []).map((week) => [week.slug, week] as const),
  );

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow text-[10px] text-muted-foreground">Archive</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Historical weekly baskets</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          Open any week to read it back in full — the recommended positions, the thesis
          behind each one, the market conditions at entry, and the trades executed
          against it.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {baskets.map((basket) => {
          const outcome = outcomeBySlug.get(basket.slug);
          return (
            <Link key={basket.id} href={`/app/baskets/${basket.slug}`} className="group">
              <Card className="h-full transition-colors group-hover:border-foreground/30">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="eyebrow text-[10px] text-muted-foreground">{basket.status}</p>
                    {outcome?.complete ? (
                      <p
                        className={`text-sm font-semibold ${
                          outcome.pnl >= 0 ? "text-emerald-500" : "text-red-500"
                        }`}
                      >
                        Settled {outcome.pnl >= 0 ? "+" : "−"}
                        {formatCurrency(Math.abs(outcome.pnl))} · {outcome.wins}/{outcome.legs} legs
                      </p>
                    ) : outcome && outcome.settledLegs > 0 ? (
                      <p className="text-sm font-medium text-muted-foreground">Settling…</p>
                    ) : (
                      <p className="text-sm font-medium text-muted-foreground">In progress</p>
                    )}
                  </div>
                  <CardTitle className="mt-3 text-2xl">{basket.title}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <ArchiveMetric label="Week of" value={formatDateLabel(basket.weekOf)} />
                  <ArchiveMetric label="GSRS" value={String(basket.gsrs)} />
                  <ArchiveMetric label="Cash needed" value={formatCurrency(basket.cashNeeded)} />
                  <ArchiveMetric
                    label={outcome?.complete ? "Return on cash" : "Estimated credit"}
                    value={
                      outcome?.complete && basket.cashNeeded > 0
                        ? `${((outcome.pnl / basket.cashNeeded) * 100).toFixed(2)}%`
                        : formatCurrency(basket.portfolioSummary.totalEstimatedCredit)
                    }
                  />
                </CardContent>
              </Card>
            </Link>
          );
        })}
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
