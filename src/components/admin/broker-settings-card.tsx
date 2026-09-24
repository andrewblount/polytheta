import { updateBrokerSettingsAction } from "@/app/(app)/app/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBrokerSettings, getBrokerStatus, getExecutionHosts } from "@/server/services/broker-settings";
import { StrikeSettingsEditor } from "./strike-settings-editor";
import { BrokerAccountFields } from "./broker-account-fields";
import { PercentSlider } from "@/components/ui/percent-slider";
export async function BrokerSettingsCard() {
  const [s, status, hosts] = await Promise.all([getBrokerSettings(), getBrokerStatus(), getExecutionHosts()]);
  const fields = [
    ["maxAccountLossPct", "Maximum loss per ticker (% of account)", 0.1, 100, 0.1],
    ["maxTrades", "Maximum trades per basket", 1, 20, 1],
    ["callAllocationPct", "Calls (%)", 0, 100, 1],
    ["putAllocationPct", "Puts (%)", 0, 100, 1],
    ["reserveLeverageCeiling", "Gross exposure / equity ceiling (×)", 1, 4, 0.25],
    ["minimumCreditRatio", "Minimum credit / adjusted modeled credit", 0.5, 1, 0.01],
    ["entryTimeoutSeconds", "Cancel unfilled entry after (seconds)", 30, 900, 30],
    ["maxExitPremiumMultiple", "Exit debit ceiling / initial ask", 1, 3, 0.1],
    ["preparationLeadMinutes", "Start full screening before close (minutes)", 30, 240, 1],
    ["finalizeLeadMinutes", "Final refresh before entry window (minutes)", 5, 20, 1],
    ["vixIvSensitivity", "VIX-to-option-IV sensitivity", 0, 3, 0.1],
    ["modelRiskFreeRatePct", "Model annual risk-free rate (%)", 0, 20, 0.1],
    ["twsClientId", "Dedicated TWS client ID", 1, 999999, 1],
    ["twsRestartGraceMinutes", "Expected restart recovery window (minutes)", 1, 60, 1],
  ] as const;
  return <Card><CardHeader><CardTitle>Interactive Brokers · {s.accountMode === 'paper' ? 'Paper account' : 'Live account'}</CardTitle>
    <p className="text-sm text-muted-foreground">Equal allocation per trade. No doubling. Automatic exits follow news and configured ticker-loss rules.</p>
  </CardHeader><CardContent className="space-y-5">
    <p role="status" className="rounded-xl border p-3 text-sm">{status && !status.stale ? String(status.message ?? "Connection status unavailable") : "IB connection has not been verified recently. Sign in to your selected gateway on the trading Mac."}</p>
    <form action={updateBrokerSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <BrokerAccountFields key={`${s.accountMode}:${s.twsPort}`} accountMode={s.accountMode} twsPort={s.twsPort} />
      <label className="grid gap-2 text-sm">Execution computer<select name="executionHostId" defaultValue={s.executionHostId} className="rounded-lg border bg-background p-3"><option value="">Choose a registered computer</option>{hosts.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}</select><span className="text-xs text-muted-foreground">Register another computer with the IB worker. Selection transfers control on the next reconciled cycle; only one worker runs at a time.</span></label>
      <label className="grid gap-2 text-sm">Entry timing<select name="entryTiming" defaultValue={s.entryTiming} className="rounded-lg border bg-background p-3"><option value="monday-morning">Monday morning</option><option value="friday-close">Friday: final five minutes</option></select><span className="text-xs text-muted-foreground">Friday mode targets next week’s expiry. Friday holidays use the preceding session; Monday holidays use the first session. Early closes are automatic.</span></label>
      <label className="grid gap-2 text-sm">Monday entry starts (New York)<Input name="mondayEntryStart" type="time" required defaultValue={s.mondayEntryStart} /></label>
      <label className="grid gap-2 text-sm">Monday entry ends (New York)<Input name="mondayEntryEnd" type="time" required defaultValue={s.mondayEntryEnd} /></label>
      <label className="grid gap-2 text-sm">Connection
        <select name="connection" defaultValue={s.connection} className="rounded-lg border bg-background p-3">
          <option value="tws">TWS / IB Gateway</option><option value="web-api">IB Web API / Client Portal Gateway</option>
        </select>
      </label>
      <label className="grid gap-2 text-sm">TWS / Gateway host or IP<Input name="twsHost" required defaultValue={s.twsHost} /></label>
      <label className="grid gap-2 text-sm sm:col-span-2">IB Web API endpoint<Input name="webApiUrl" type="url" required defaultValue={s.webApiUrl} /></label>
      <label className="grid gap-2 text-sm">Expected TWS daily restart<Input name="twsRestartTime" type="time" required defaultValue={s.twsRestartTime} /></label>
      <label className="grid gap-2 text-sm">TWS restart time zone<Input name="twsRestartTimezone" required defaultValue={s.twsRestartTimezone} /></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Set the same auto-restart time in TWS → Lock and Exit. These fields describe its expected recovery window; they do not change TWS itself. The worker reconnects automatically. IB normally requires weekly authentication after Sunday 01:00 ET.</p>
      <div className="text-sm text-muted-foreground">Execution quotes: IB real-time bid/ask for the exact contract. Yahoo remains available for research. Delayed or unavailable IB quotes block entries.</div>
      <PercentSlider name="entryCapitalPct" label="Percentage of account traded (% of IB equity)" defaultValue={s.entryCapitalPct} min={0} max={100} step={1} />
      <PercentSlider name="marginAvailablePct" label="Margin available (% of committed capital backed as notional)" defaultValue={s.marginAvailablePct} min={100} max={1000} step={25} />
      {fields.map(([key, label, min, max, step]) => <label key={key} className="grid gap-2 text-sm">{label}<Input name={key} type="number" required min={min} max={max} step={step} defaultValue={s[key]} />{key === "maxAccountLossPct" && <span className="text-xs text-muted-foreground">Defaults to 20% of account equity recorded before entry. The worker monitors each ticker and closes only its PolyTheta contracts if triggered; no standing stop order at entry.</span>}</label>)}
      <label className="grid gap-2 text-sm sm:col-span-2">Do not trade these tickers
        <textarea name="excludedTickers" rows={3} defaultValue={s.excludedTickers.join(", ")} className="rounded-lg border bg-background p-3" />
        <span className="text-xs text-muted-foreground">Add or remove symbols separated by commas. SPCX is SpaceX. Entering SPACEX is accepted as an alias. Exclusions block new entries and cancel unfilled entries; they do not force an exit from existing trades.</span>
      </label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="sellCalls" defaultChecked={s.sellCalls} />Sell calls</label>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" name="sellPuts" defaultChecked={s.sellPuts} />Sell puts</label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Side toggles decide which legs of the published model basket the account executes; a skipped leg’s equal share stays unallocated. Margin available scales contracts per trade: 400% backs four dollars of strike or spot per committed dollar under portfolio margin. IB’s margin preview must still approve every order.</p>
      <label className="flex items-center gap-3 text-sm sm:col-span-2"><input type="checkbox" name="pauseEntries" defaultChecked={s.pauseEntries} />Pause new entries (continue monitoring existing positions)</label>
      <StrikeSettingsEditor initial={s.strikeOverrides} />
      <p className="text-xs text-muted-foreground sm:col-span-2">Calls and puts must total 100%. Whole-contract rounding can leave cash unused. Entry capacity is capped by equity, available cash and IB’s margin preview. The reserve never increases entry size. Exceeding the IB gross-exposure/equity ceiling blocks new entries and flags review; it does not cause a price-based exit. Live execution also requires activation on the trading Mac.</p>
      <Button type="submit">Save trading settings</Button>
    </form>
    <a className="text-sm underline" href="/trading-rules">Read the entry and exit rules</a>
    <a className="block text-sm underline" href="/entry_timing_and_pricing.md">Read the timing and weekend pricing calculation</a>
  </CardContent></Card>;
}
