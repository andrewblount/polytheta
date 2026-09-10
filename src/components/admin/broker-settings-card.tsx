import { updateBrokerSettingsAction } from "@/app/(app)/app/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBrokerSettings, getBrokerStatus } from "@/server/services/broker-settings";
import { StrikeSettingsEditor } from "./strike-settings-editor";
export async function BrokerSettingsCard() {
  const [s, status] = await Promise.all([getBrokerSettings(), getBrokerStatus()]);
  const fields = [
    ["entryCapitalPct", "Total trade allocation (% of account equity)", 0, 100, 1],
    ["maxTrades", "Maximum trades per basket", 1, 20, 1],
    ["callAllocationPct", "Calls (%)", 0, 100, 1],
    ["putAllocationPct", "Puts (%)", 0, 100, 1],
    ["reserveLeverageCeiling", "Gross exposure / equity ceiling (×)", 1, 4, 0.25],
    ["minimumCreditRatio", "Minimum credit / modeled credit", 0.5, 1, 0.01],
    ["entryTimeoutSeconds", "Cancel unfilled entry after (seconds)", 30, 900, 30],
    ["maxExitPremiumMultiple", "Exit debit ceiling / initial ask", 1, 3, 0.1],
  ] as const;
  return <Card><CardHeader><CardTitle>Interactive Brokers · Live account</CardTitle>
    <p className="text-sm text-muted-foreground">Equal allocation per trade. No doubling. Early exits only for verified news events.</p>
  </CardHeader><CardContent className="space-y-5">
    <p role="status" className="rounded-xl border p-3 text-sm">{status && !status.stale ? String(status.message ?? "Connection status unavailable") : "IB connection has not been verified recently. Sign in to your selected gateway on the trading Mac."}</p>
    <form action={updateBrokerSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <label className="grid gap-2 text-sm">Connection
        <select name="connection" defaultValue={s.connection} className="rounded-lg border bg-background p-3">
          <option value="tws">TWS / IB Gateway</option><option value="web-api">IB Web API / Client Portal Gateway</option>
        </select>
      </label>
      <div className="text-sm text-muted-foreground">Execution quotes: IB real-time bid/ask for the exact contract. Yahoo remains available for research. Delayed or unavailable IB quotes block entries.</div>
      {fields.map(([key, label, min, max, step]) => <label key={key} className="grid gap-2 text-sm">{label}<Input name={key} type="number" required min={min} max={max} step={step} defaultValue={s[key]} /></label>)}
      <label className="grid gap-2 text-sm sm:col-span-2">Do not trade these tickers
        <textarea name="excludedTickers" rows={3} defaultValue={s.excludedTickers.join(", ")} className="rounded-lg border bg-background p-3" />
        <span className="text-xs text-muted-foreground">Add or remove symbols separated by commas. SPCX is SpaceX. Entering SPACEX is accepted as an alias. Exclusions block new entries and cancel unfilled entries; they do not force an exit from existing trades.</span>
      </label>
      <label className="flex items-center gap-3 text-sm sm:col-span-2"><input type="checkbox" name="pauseEntries" defaultChecked={s.pauseEntries} />Pause new entries (continue monitoring existing positions)</label>
      <StrikeSettingsEditor initial={s.strikeOverrides} />
      <p className="text-xs text-muted-foreground sm:col-span-2">Calls and puts must total 100%. Whole-contract rounding can leave cash unused. Entry capacity is capped by equity, available cash and IB’s margin preview. The reserve never increases entry size. Exceeding the IB gross-exposure/equity ceiling blocks new entries and flags review; it does not cause a price-based exit. Live execution also requires activation on the trading Mac.</p>
      <Button type="submit">Save trading settings</Button>
    </form>
    <a className="text-sm underline" href="/trading-rules">Read the entry and exit rules</a>
  </CardContent></Card>;
}
