"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";

export function BrokerAccountFields({ accountMode, twsPort }: { accountMode: 'live' | 'paper'; twsPort: number }) {
  const [mode, setMode] = useState(accountMode);
  const [port, setPort] = useState(String(twsPort));
  return <>
    <label className="grid gap-2 text-sm">Account mode
      <select name="accountMode" value={mode} className="rounded-lg border bg-background p-3" onChange={event => {
        const next = event.target.value as 'live' | 'paper';
        const ports: Record<string, string> = next === 'paper' ? { '4001': '4002', '7496': '7497' } : { '4002': '4001', '7497': '7496' };
        setPort(ports[port] ?? port); setMode(next);
      }}>
        <option value="paper">Paper trading · simulated money</option>
        <option value="live">Live trading · real money</option>
      </select>
      <span className="text-xs text-muted-foreground">Changing mode pauses new entries. Only the selected account is monitored.</span>
    </label>
    <label className="grid gap-2 text-sm">TWS / Gateway API port
      <Input name="twsPort" type="number" required min={1} max={65535} step={1} value={port} onChange={event => setPort(event.target.value)} />
      <span className="text-xs text-muted-foreground">{mode === 'paper' ? 'Paper defaults: IB Gateway 4002 · TWS 7497.' : 'Live defaults: IB Gateway 4001 · TWS 7496.'} Match the port shown in IB’s API settings.</span>
    </label>
    <div className="space-y-2 rounded-xl border p-4 text-sm sm:col-span-2">
      <p className="font-semibold">{mode === 'paper' ? 'Connect your IB paper account' : 'Connect your live IB account'}</p>
      <p>On the execution computer, open IB Gateway and select {mode === 'paper' ? 'Paper Trading' : 'Live Trading'} before signing in with your existing IB login. Keep your login in Apple Passwords and enter it directly in IB Gateway. PolyTheta connects to that signed-in session.</p>
      {mode === 'paper' && <p>Use the paper account linked to your IB login. PolyTheta automatically detects a single paper account; simulated trades remain separate from actual-trade performance.</p>}
      <p className="text-muted-foreground">Keep the API read-only for the first connection check. Saving these settings does not activate orders.</p>
      <a className="underline" href="/ib_operations.md">Connection and paper-testing instructions</a>
    </div>
  </>;
}
