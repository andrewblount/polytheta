import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export const metadata = { title: "Trading rules and GSRS" };
export default function TradingRulesPage() {
  const rows = [
    ["VIX", "(VIX − 10) / 4 + 0.5 × max(0, VIX − previous close)", "40%"],
    ["SKEW", "(SKEW − 100) / 10", "20%"],
    ["High-yield spread", "5 × (HY OAS − 1.5) / (3.59 − 1.5)", "20%"],
    ["MOVE", "(MOVE − 50) / 10", "10%"],
    ["Put/call ratio", "7 × (1 − P/C)", "10%"],
  ];
  return <main className="mx-auto max-w-4xl space-y-6 px-5 py-12">
    <div><p className="text-sm text-muted-foreground">September 9, 2026 · Policy v3</p><h1 className="mt-2 text-3xl font-semibold">Trading rules and GSRS</h1></div>
    <Card><CardHeader><CardTitle>Allocate equally. Enter on verified data.</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-7">
      <p>Choose a percentage of account equity, a maximum number of trades and a call/put split. The split determines trade counts; every trade receives an equal share of the available allocation. Whole-contract rounding leaves unused cash. Calls default to 100%, puts to 0%.</p>
      <p>Settings includes an editable exclusion list (TSLA and SPCX / SpaceX by default) and a minimum OTM percentage per ticker, side and expiry. Available strikes must meet or exceed that minimum while still passing delta and ATR rules.</p>
      <p>Entries use current-week data, the exchange calendar and the exact IB option contract. Live IB quotes, qualifying delta and strike distance, clear earnings and news checks, and IB margin approval are required. Entry orders use bounded DAY limits; the margin reserve does not multiply entry size.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Hold to expiry. News exits only. No doubling.</CardTitle></CardHeader><CardContent className="space-y-3 text-sm leading-7">
      <p>Credible acquisition news on a short call or serious downside news on a short put can trigger an early exit. Keyword matches require issuer and source checks. The code cancels working entries, reconciles partial fills, then closes only the owned short quantity.</p>
      <p>Your Exit NOW and Exit all NOW buttons are manual overrides and apply only to PolyTheta trades. Exit all pauses new entries. Actual holdings and P/L are visible on the website, iPhone and paired Watch with sync timestamps and request status.</p>
      <p>Price changes alone do not trigger an exit or an increased position. A limit order may remain unfilled, and overnight events wait for the next session. Broker connectivity, assignment and actual fills require reconciliation.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>How GSRS is calculated</CardTitle></CardHeader><CardContent className="space-y-4 text-sm leading-7">
      <p>Clip each component to 0–10, multiply by its weight, add the results and round to two decimals.</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Input</th><th className="p-2">Component</th><th className="p-2">Weight</th></tr></thead><tbody>{rows.map(([name, formula, weight]) => <tr key={name} className="border-t"><td className="p-2">{name}</td><td className="p-2">{formula}</td><td className="p-2">{weight}</td></tr>)}</tbody></table></div>
      <p>GSRS shown on a basket is its score at entry, so it remains fixed for that basket. The OAS reference of 3.59 is a fixed parameter. Weighted normalization and daily macro publications also limit movement. Failed imports now block publication instead of silently using fixed fallback values.</p>
      <p>GSRS 3–5 reduces entry allocation when puts are included; GSRS ≥5 prohibits new puts. Existing positions still follow the news-only exit policy.</p>
    </CardContent></Card>
    <p className="text-sm text-muted-foreground">Modeled midpoint returns are separate from real fills, commissions and slippage. Saving trading settings does not activate live execution.</p>
    <a href="/trading_rules.md" download className="inline-block rounded-lg border px-4 py-3 text-sm">Download the complete rules</a>
  </main>;
}
