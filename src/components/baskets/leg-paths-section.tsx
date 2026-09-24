import { LegPathChart } from "@/components/baskets/leg-path-chart";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { LegPath } from "@/server/services/price-paths";

const pct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(digits)}%`);
const px = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

function outcomeBadge(outcome: LegPath["analysis"]["outcome"]) {
  switch (outcome) {
    case "otm": return <Badge variant="success">Expired worthless</Badge>;
    case "itm": return <Badge variant="default">Expired in the money</Badge>;
    case "exited": return <Badge variant="accent">Exited early</Badge>;
    default: return <Badge variant="accent">Open</Badge>;
  }
}

// One card per leg: the underlying against the strike, the numbers that
// describe the trade's path, and — when it expired in the money — the
// post-mortem of what went wrong and what would have kept it out of the money.
export function LegPathsSection({ legs, title = "Each trade against its strike" }: { legs: LegPath[]; title?: string }) {
  if (legs.length === 0) return null;
  return (
    <section className="space-y-4">
      <div>
        <p className="eyebrow text-[10px] text-muted-foreground">Trade paths</p>
        <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Regular-session bars from two sessions before entry through expiry. The solid line is the strike sold; the dashed lines are the entry price and the breakeven (strike ± credit).</p>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {legs.map((leg) => {
          const a = leg.analysis;
          return (
            <Card key={leg.positionId}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <CardTitle className="text-xl">{leg.ticker} {leg.side} {px(leg.strike)} · {leg.expiry}</CardTitle>
                  {outcomeBadge(a.outcome)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Entered {px(leg.entryPrice)} with a {pct(a.cushionPct)} cushion{a.cushionAtr != null ? ` (${a.cushionAtr.toFixed(1)}× ATR)` : ""} for {px(leg.credit)} × {leg.contracts} contracts.
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <LegPathChart points={leg.points} side={leg.side} lines={leg.lines} />
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <Metric label={a.outcome === "open" ? "Last price" : a.outcome === "exited" ? "Exit price" : "Price at expiry"} value={px(a.outcome === "open" ? a.lastPrice : a.expiryPrice ?? a.lastPrice)} tone={a.expiryPrice != null ? (a.intrinsicAtExpiry && a.intrinsicAtExpiry > 0 ? "bad" : "good") : undefined} />
                  <Metric label="Move since entry" value={pct(a.movePct, 2)} />
                  <Metric label="Closest to strike" value={a.closestPrice != null ? `${px(a.closestPrice)} (${pct(a.closestPct)} of cushion)` : "—"} tone={a.closestPct != null && a.closestPct >= 100 ? "bad" : undefined} />
                  <Metric label="First through strike" value={when(a.firstBreachAt)} />
                  <Metric label="Credit kept" value={pct(a.creditCapturePct)} />
                  <Metric label="Return on margin" value={pct(a.returnOnMarginPct, 2)} />
                </dl>
                {a.postMortem ? (
                  <div className="rounded-2xl border border-red-500/40 bg-red-500/5 p-4 text-sm">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Post-mortem</p>
                    <p className="mt-2 font-medium">{a.postMortem.summary}</p>
                    <div className="mt-3 space-y-2 text-muted-foreground">
                      {a.postMortem.findings.map((f, i) => <p key={i}>{f}</p>)}
                    </div>
                    <p className="mt-4 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">What would have kept it out of the money</p>
                    <div className="mt-2 grid gap-2">
                      {a.postMortem.alternatives.map((alt) => (
                        <div key={alt.label} className="rounded-xl border border-border/60 bg-background/40 p-3">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="font-medium">{alt.label}</p>
                            {alt.pnl != null ? <p className={`text-sm font-semibold ${alt.pnl >= 0 ? "text-emerald-500" : "text-red-400"}`}>{formatCurrency(alt.pnl)}</p> : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{alt.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <p className="text-[11px] text-muted-foreground">{leg.source}{leg.complete ? " · complete" : ` · as of ${when(leg.fetchedAt)} ET`}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-medium ${tone === "good" ? "text-emerald-500" : tone === "bad" ? "text-red-400" : ""}`}>{value}</dd>
    </div>
  );
}
