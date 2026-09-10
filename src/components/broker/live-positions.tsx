"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
type Position = { conid: number; ticker: string; side: string; strike: number; expiry: string; quantity: number; averageFill: number | null; mark: number | null; unrealizedPnl: number | null; realizedPnl: number; fees: number; status: string; canExit: boolean; workingEntry: boolean };
type State = { stale: boolean; snapshot: { accountKey: string; observedAt: string; activated: boolean; positions: Position[]; unrealizedPnl: number | null; realizedPnl: number; fees: number; complete: boolean } | null; requests: { requestId: string; requestedAt: string; status: string; message: string }[] };
const money = (value: number | null | undefined) => value == null ? "Unavailable" : value.toLocaleString("en-US", { style: "currency", currency: "USD" });
export function LivePositions() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { const r = await fetch("/api/ib", { cache: "no-store" }); if (!r.ok) throw new Error("IB positions could not be refreshed"); setState(await r.json()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Connection unavailable"); }
  }, []);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 15000); return () => clearInterval(timer); }, [refresh]);
  const snapshot = state?.snapshot;
  const canAct = !!snapshot?.activated && !state?.stale && !error && !busy;
  const active = snapshot?.positions.filter(p => p.quantity > 0 || p.workingEntry || p.status === "Reconciliation required") ?? [];
  async function exit(conid?: number) {
    const accountKey = snapshot?.accountKey;
    if (!accountKey) return;
    const selected = active.filter(p => conid == null || p.conid === conid);
    if (!window.confirm(`Exit ${conid == null ? "all PolyTheta trades" : selected[0]?.ticker + " " + selected[0]?.strike + " " + selected[0]?.side} now?\n\nThe worker cancels pending entries and submits buy-to-close limit orders for confirmed PolyTheta quantities. ${conid == null ? "New entries will be paused. " : ""}Fills require an open market and available liquidity.`)) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/ib", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), accountKey, scope: conid == null ? "all" : "position", conid }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setMessage(result.request.message); await refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Request could not be confirmed. Refresh before trying again."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-muted-foreground">Interactive Brokers · Live account</p><h1 className="text-3xl font-semibold">PolyTheta trades</h1><p className="mt-2 text-sm text-muted-foreground">Only PolyTheta fills and holdings contribute to these results.</p></div><Button variant="destructive" disabled={!canAct || !active.some(p => p.canExit || p.workingEntry)} onClick={() => void exit()}>Exit all NOW</Button></div>
    <div role="status" className="rounded-xl border p-4 text-sm"><p>{error ?? (state?.stale ? "IB data is stale or the connection is unavailable." : snapshot ? "IB account synchronized" : "Waiting for the IB connection.")}</p>{snapshot && <p className="mt-1 text-muted-foreground">Last sync: {new Date(snapshot.observedAt).toLocaleString()}. {snapshot.activated ? "Execution service activated." : "Execution service is not activated."}</p>}<Button className="mt-2" variant="secondary" size="sm" onClick={() => void refresh()}>Refresh</Button></div>
    {message && <p role="status" className="rounded-xl border p-4">{message}</p>}
    <div className="grid gap-3 sm:grid-cols-3">{[["Unrealized P/L", snapshot?.unrealizedPnl], ["Realized P/L before fees", snapshot?.realizedPnl], ["Confirmed fees", snapshot?.fees]].map(([label, value]) => <Card key={String(label)}><CardHeader><CardTitle className="text-sm">{label}</CardTitle></CardHeader><CardContent className="text-2xl tabular-nums">{money(value as number | null | undefined)}</CardContent></Card>)}</div>
    {snapshot && !snapshot.complete && <p className="text-sm text-amber-600">Some marks, fees or position reconciliations are pending. Incomplete values are not shown as final returns.</p>}
    {!active.length && <Card><CardContent className="pt-6">{snapshot ? "No open PolyTheta trades were confirmed in the latest IB snapshot." : "Connect IB on the trading Mac to load actual PolyTheta trades."}</CardContent></Card>}
    <div className="grid gap-4 xl:grid-cols-2">{active.map(p => <Card key={p.conid}><CardHeader><div className="flex justify-between gap-3"><CardTitle>{p.ticker} · {p.strike} {p.side}</CardTitle><span className="text-sm">{p.expiry}</span></div></CardHeader><CardContent className="space-y-4"><dl className="grid grid-cols-2 gap-3 text-sm">{[["Short contracts", p.quantity], ["Average entry fill", money(p.averageFill)], ["IB mark", money(p.mark)], ["Unrealized P/L", money(p.unrealizedPnl)]].map(([label, value]) => <div key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums">{value}</dd></div>)}</dl><p className="text-sm">{p.status}</p><Button variant="destructive" disabled={!canAct || !p.canExit && !p.workingEntry} onClick={() => void exit(p.conid)}>Exit NOW</Button></CardContent></Card>)}</div>
    {!!state?.requests.length && <Card><CardHeader><CardTitle>Exit requests</CardTitle></CardHeader><CardContent className="space-y-3">{state.requests.map(r => <div key={r.requestId} className="border-b pb-3 text-sm"><p className="font-semibold">{r.status} · {new Date(r.requestedAt).toLocaleString()}</p><p>{r.message}</p></div>)}</CardContent></Card>}
    <p className="text-sm text-muted-foreground">“NOW” requests immediate processing by the trading Mac. It does not guarantee an immediate fill. Outside exchange hours, exits wait for the next session. News-only automatic exits remain unchanged; these buttons are your manual override.</p>
  </div>;
}
