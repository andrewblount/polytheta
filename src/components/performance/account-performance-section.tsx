import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/dashboard/stat-card";
import { formatCurrency } from "@/lib/format";
import type { AccountPerformanceReport } from "@/server/repos/account-performance";

// The second track: what the IB account did with the model's baskets.
// Model P&L is the model's own (performance.ts); the account row shows what
// was executed, at what slippage, and what it earned or lost. The gap between
// the two is execution quality, not recommendation quality.
export function AccountPerformanceSection({ report }: { report: AccountPerformanceReport | null }) {
  if (!report || !report.accounts.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Account performance (IB)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No IB fills recorded yet. Once the execution service enters a published model basket, each
            week appears here with its execution rate, slippage against the modeled credit, fees and actual P&L,
            separately for the paper and live accounts.
          </p>
        </CardContent>
      </Card>
    );
  }
  const signed = (n: number | null) => (n == null ? "n/a" : `${n >= 0 ? "+" : "−"}${formatCurrency(Math.abs(n))}`);
  return (
    <div className="space-y-8">
      {report.accounts.map((account) => (
        <Card key={account.mode}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle>Account performance · IB {account.mode}</CardTitle>
              <Badge variant={account.mode === "live" ? "success" : "accent"}>{account.mode}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Actual fills and fees from the execution service, compared with the model on the same contracts. Expired
              short contracts without a closing fill settle at the model&apos;s expiry intrinsic value until reconciled at IB.
            </p>
          </CardHeader>
          <CardContent className="grid gap-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard title="Actual P&L (complete weeks)" value={signed(account.totals.actualPnl)} description={`${account.totals.weeks} weeks · fees ${formatCurrency(account.totals.fees)}`} />
              <StatCard title="Model P&L, same contracts" value={signed(account.totals.modeledPnlAtAccountSize)} description={`Full model baskets: ${signed(account.totals.modeledPnl)}`} />
              <StatCard title="Execution rate" value={`${account.totals.executionRatePct}%`} description={`${account.totals.executedLegs} of ${account.totals.modelLegs} model legs entered`} />
              <StatCard title="Slippage vs modeled credit" value={signed(account.totals.slippageTotal)} description={account.totals.avgSlippagePerContract != null ? `${account.totals.avgSlippagePerContract >= 0 ? "+" : ""}${account.totals.avgSlippagePerContract.toFixed(3)} per contract` : undefined} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Week</th>
                    <th className="py-2 pr-4">Executed</th>
                    <th className="py-2 pr-4">Model P&L</th>
                    <th className="py-2 pr-4">Model, account size</th>
                    <th className="py-2 pr-4">Actual P&L</th>
                    <th className="py-2 pr-4">Slippage</th>
                    <th className="py-2 pr-4">Fees</th>
                    <th className="py-2 pr-4">Legs</th>
                  </tr>
                </thead>
                <tbody>
                  {[...account.weeks].reverse().map((week) => (
                    <tr key={week.slug} className="border-t border-border/60 align-top">
                      <td className="py-3 pr-4">
                        <Link href={`/app/baskets/${week.slug}`} className="font-medium hover:underline">{week.weekOf}</Link>
                        {!week.complete ? <span className="ml-2 text-xs text-muted-foreground">in progress</span> : null}
                      </td>
                      <td className="py-3 pr-4">{week.executedLegs}/{week.modelLegs} ({week.executionRatePct}%)</td>
                      <td className="py-3 pr-4">{signed(week.modeledPnl)}</td>
                      <td className="py-3 pr-4">{signed(week.modeledPnlAtAccountSize)}</td>
                      <td className="py-3 pr-4 font-semibold">{signed(week.actualPnl)}</td>
                      <td className="py-3 pr-4">{signed(week.slippageTotal)}</td>
                      <td className="py-3 pr-4">{formatCurrency(week.fees)}</td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">
                        {week.legs.map((leg) => (
                          <div key={leg.positionId}>
                            {leg.ticker} {leg.side} {leg.strike}: {leg.status}
                            {leg.executed ? ` · ${leg.openedContracts}× @ ${leg.avgOpenCredit?.toFixed(2)} vs model ${leg.modeledCredit.toFixed(2)} (${leg.slippagePerContract != null && leg.slippagePerContract >= 0 ? "+" : ""}${leg.slippagePerContract?.toFixed(2)})` : ""}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
