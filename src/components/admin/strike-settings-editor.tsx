"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Rule = { ticker: string; side: string; expiry: string; minimumOtmPct: number };
export function StrikeSettingsEditor({ initial }: { initial: Rule[] }) {
  const [rows, setRows] = useState(initial);
  function update(index: number, patch: Partial<Rule>) { setRows(rows.map((r, i) => i === index ? { ...r, ...patch } : r)); }
  return <fieldset className="space-y-3 rounded-xl border p-4 sm:col-span-2"><legend className="px-1 font-semibold">Per-trade minimum OTM</legend>
    <p className="text-xs text-muted-foreground">Choose the ticker, side and exact expiry before the basket is built. Every strike must be at least this far out of the money and still pass delta and ATR rules. Whole and half-dollar strikes may produce a larger distance. Unlisted trades use the existing selection rules.</p>
    <input type="hidden" name="strikeOverrides" value={JSON.stringify(rows)} />
    {rows.map((r, i) => <div key={i} className="grid gap-2 rounded-lg bg-muted/30 p-3 sm:grid-cols-5"><label className="text-xs">Ticker<Input aria-label={`Ticker ${i + 1}`} required value={r.ticker} onChange={e => update(i, { ticker: e.target.value.toUpperCase() })} /></label><label className="text-xs">Side<select className="w-full rounded-lg border bg-background p-2" value={r.side} onChange={e => update(i, { side: e.target.value })}><option value="call">Call</option><option value="put">Put</option></select></label><label className="text-xs">Expiry<Input type="date" required value={r.expiry} onChange={e => update(i, { expiry: e.target.value })} /></label><label className="text-xs">At least OTM (%)<Input type="number" min={0} max={99.99} step={0.01} required value={r.minimumOtmPct} onChange={e => update(i, { minimumOtmPct: Number(e.target.value) })} /></label><Button type="button" variant="secondary" className="self-end" onClick={() => setRows(rows.filter((_, j) => i !== j))}>Remove</Button></div>)}
    <Button type="button" variant="secondary" onClick={() => setRows([...rows, { ticker: "", side: "call", expiry: "", minimumOtmPct: 5 }])}>Add trade minimum</Button>
  </fieldset>;
}
