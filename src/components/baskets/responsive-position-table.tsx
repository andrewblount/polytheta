import Link from "next/link";

import { formatCurrency, formatPercent } from "@/lib/format";
import type { PositionData } from "@/lib/types";

import { PositionStateBadge } from "@/components/baskets/position-state-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ResponsivePositionTable({
  positions,
}: {
  positions: PositionData[];
}) {
  return (
    <>
      <div className="hidden xl:block">
        <ScrollArea className="w-full rounded-[calc(var(--radius)+4px)] border border-border/70">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-background/90 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                {[
                  "Ticker",
                  "Entry",
                  "Strike",
                  "Delta",
                  "Credit",
                  "Contracts",
                  "Margin",
                  "State",
                  "Capture",
                  "Last refresh",
                ].map((column) => (
                  <th key={column} className="px-4 py-3 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.id} className="border-t border-border/60">
                  <td className="sticky left-0 bg-background/95 px-4 py-4">
                    <Link
                      href={`/app/positions/${position.id}`}
                      className="font-semibold hover:text-accent"
                    >
                      {position.ticker}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {position.companyName ?? position.thesisSummary}
                    </p>
                  </td>
                  <td className="px-4 py-4">{formatCurrency(position.entryUnderlyingPrice)}</td>
                  <td className="px-4 py-4">
                    {formatCurrency(position.strike, { maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-4">{formatPercent(position.delta, 0)}</td>
                  <td className="px-4 py-4">
                    {formatCurrency(position.estimatedEntryCredit)}
                  </td>
                  <td className="px-4 py-4">{position.contracts}</td>
                  <td className="px-4 py-4">{formatCurrency(position.margin)}</td>
                  <td className="px-4 py-4">
                    <PositionStateBadge state={position.latestPerformance.state} />
                  </td>
                  <td className="px-4 py-4">
                    {formatPercent(position.latestPerformance.creditCapturePct, 0)}
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {new Date(position.latestPerformance.observedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </div>
      <div className="grid gap-4 xl:hidden">
        {positions.map((position) => (
          <Card key={position.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">
                  <Link href={`/app/positions/${position.id}`}>{position.ticker}</Link>
                </CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  {position.companyName ?? position.thesisSummary}
                </p>
              </div>
              <PositionStateBadge state={position.latestPerformance.state} />
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Entry" value={formatCurrency(position.entryUnderlyingPrice)} />
              <Metric label="Strike" value={formatCurrency(position.strike)} />
              <Metric label="Credit" value={formatCurrency(position.estimatedEntryCredit)} />
              <Metric
                label="Capture"
                value={formatPercent(position.latestPerformance.creditCapturePct, 0)}
              />
              <Metric label="Margin" value={formatCurrency(position.margin)} />
              <Metric label="Contracts" value={String(position.contracts)} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/30 p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-medium">{value}</p>
    </div>
  );
}
