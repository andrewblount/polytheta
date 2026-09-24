import { inArray, like } from "drizzle-orm";

import { db } from "@/db";
import { baskets, performanceSnapshots, positions, trades } from "@/db/schema";
import { asNumber, asIsoString } from "./helpers";

// Account performance: what the IB account actually did with each model
// basket, leg by leg, against what the model said. The model report
// (performance.ts) is untouched by anything here; this report is the second
// track. Slippage is fill credit minus modeled credit on the executed
// contracts; execution is which model legs the account entered at all.
//
// Fills come from the `trades` ledger written by the execution service
// (broker 'IBKR live' / 'IBKR paper'). A fill is attributed to a model
// position by position_id when the worker set it, otherwise by exact contract
// (ticker, side, strike, expiry) inside the basket week.

const SETTLED_STATES = ["expired-otm", "expired-itm", "manually-closed"] as const;

export type AccountMode = "paper" | "live";

export interface AccountLeg {
  positionId: string;
  ticker: string;
  side: "call" | "put";
  strike: number;
  expiry: string;
  modeledCredit: number;
  modeledContracts: number;
  modeledPnl: number | null;
  executed: boolean;
  openedContracts: number;
  closedContracts: number;
  avgOpenCredit: number | null;
  avgCloseDebit: number | null;
  fees: number;
  slippagePerContract: number | null;
  slippageTotal: number;
  modeledPnlAtAccountSize: number | null;
  actualPnl: number | null;
  settlementValue: number | null;
  status: "not-executed" | "open" | "closed" | "expired" | "unreconciled";
  firstFillAt: string | null;
}

export interface AccountWeek {
  weekOf: string;
  slug: string;
  title: string;
  modelLegs: number;
  executedLegs: number;
  executionRatePct: number;
  modeledPnl: number | null;
  modeledPnlAtAccountSize: number | null;
  actualPnl: number | null;
  slippageTotal: number;
  fees: number;
  complete: boolean;
  legs: AccountLeg[];
}

export interface AccountTrack {
  mode: AccountMode;
  weeks: AccountWeek[];
  totals: {
    weeks: number;
    modelLegs: number;
    executedLegs: number;
    executionRatePct: number;
    modeledPnl: number;
    modeledPnlAtAccountSize: number;
    actualPnl: number;
    slippageTotal: number;
    fees: number;
    avgSlippagePerContract: number | null;
  };
}

export interface AccountPerformanceReport {
  accounts: AccountTrack[];
  generatedAt: string;
}

const modeOf = (broker: string | null): AccountMode | null =>
  broker === "IBKR paper" ? "paper" : broker === "IBKR live" ? "live" : null;

export async function getAccountPerformanceReport(): Promise<AccountPerformanceReport | null> {
  if (!db) return null;
  const basketRows = await db.select().from(baskets);
  if (!basketRows.length) return { accounts: [], generatedAt: new Date().toISOString() };
  const positionRows = await db.select().from(positions);
  const fillRows = await db.select().from(trades).where(like(trades.broker, "IBKR %"));
  const settledRows = positionRows.length
    ? await db
        .select()
        .from(performanceSnapshots)
        .where(inArray(performanceSnapshots.state, [...SETTLED_STATES]))
    : [];
  return computeAccountPerformance({ basketRows, positionRows, fillRows, settledRows });
}

type BasketRow = { id: string; slug: string; title: string; weekOf: string | Date };
type PositionRow = { id: string; basketId: string; ticker: string; side: "call" | "put"; strike: string | number; expiry: string | Date; estimatedEntryCredit: string | number; contracts: number };
type FillRow = { positionId: string | null; ticker: string; side: "call" | "put"; strike: string | number; expiry: string | Date; action: "sell-to-open" | "buy-to-close"; quantity: number; price: string | number; fees: string | number; broker: string | null; executedAt: string | Date };
type SettledRow = { positionId: string; observedAt: string | Date; pnlAmount: string | number; optionMark: string | number | null; estimatedOptionValue: string | number | null };

// Pure computation, so it can be unit-tested with synthetic rows.
export function computeAccountPerformance({ basketRows, positionRows, fillRows, settledRows, now = Date.now() }: { basketRows: BasketRow[]; positionRows: PositionRow[]; fillRows: FillRow[]; settledRows: SettledRow[]; now?: number }): AccountPerformanceReport {
  const settledByPosition = new Map<string, SettledRow>();
  for (const snap of settledRows) {
    const existing = settledByPosition.get(snap.positionId);
    if (!existing || new Date(snap.observedAt) > new Date(existing.observedAt)) settledByPosition.set(snap.positionId, snap);
  }
  const positionsByBasket = new Map<string, PositionRow[]>();
  for (const row of positionRows) {
    const list = positionsByBasket.get(row.basketId) ?? [];
    list.push(row);
    positionsByBasket.set(row.basketId, list);
  }
  const weekOfBasket = (b: BasketRow) =>
    typeof b.weekOf === "string" ? b.weekOf : asIsoString(b.weekOf).slice(0, 10);

  // Attribute every IB fill to a model position.
  const fillsByPosition = new Map<string, Map<AccountMode, FillRow[]>>();
  const contractKey = (ticker: string, side: string, strike: number, expiry: string) => `${ticker}:${side}:${strike.toFixed(2)}:${expiry}`;
  const positionByContract = new Map<string, PositionRow>();
  for (const p of positionRows) positionByContract.set(contractKey(p.ticker, p.side, asNumber(p.strike), String(p.expiry).slice(0, 10)), p);
  for (const fill of fillRows) {
    const mode = modeOf(fill.broker);
    if (!mode) continue;
    const position =
      (fill.positionId && positionRows.find((p) => p.id === fill.positionId)) ||
      positionByContract.get(contractKey(fill.ticker, fill.side, asNumber(fill.strike), String(fill.expiry).slice(0, 10)));
    if (!position) continue;
    const byMode = fillsByPosition.get(position.id) ?? new Map<AccountMode, FillRow[]>();
    byMode.set(mode, [...(byMode.get(mode) ?? []), fill]);
    fillsByPosition.set(position.id, byMode);
  }

  const modes: AccountMode[] = [];
  for (const byMode of fillsByPosition.values()) for (const mode of byMode.keys()) if (!modes.includes(mode)) modes.push(mode);
  const accounts: AccountTrack[] = modes.sort().map((mode) => {
    const weeks: AccountWeek[] = [];
    for (const basket of basketRows) {
      const basketPositions = positionsByBasket.get(basket.id) ?? [];
      if (!basketPositions.length) continue;
      const legs: AccountLeg[] = basketPositions.map((position) => {
        const fills = fillsByPosition.get(position.id)?.get(mode) ?? [];
        const opens = fills.filter((f) => f.action === "sell-to-open");
        const closes = fills.filter((f) => f.action === "buy-to-close");
        const openedContracts = opens.reduce((a, f) => a + f.quantity, 0);
        const closedContracts = closes.reduce((a, f) => a + f.quantity, 0);
        const openProceeds = opens.reduce((a, f) => a + asNumber(f.price) * f.quantity * 100, 0);
        const closeCost = closes.reduce((a, f) => a + asNumber(f.price) * f.quantity * 100, 0);
        const fees = fills.reduce((a, f) => a + asNumber(f.fees), 0);
        const modeledCredit = asNumber(position.estimatedEntryCredit);
        const settled = settledByPosition.get(position.id);
        const settlementValue = settled ? asNumber(settled.optionMark ?? settled.estimatedOptionValue ?? 0) : null;
        const modeledPnl = settled ? asNumber(settled.pnlAmount) : null;
        const expiry = String(position.expiry).slice(0, 10);
        const expired = now >= Date.parse(`${expiry}T21:00:00Z`);
        const remaining = openedContracts - closedContracts;
        const avgOpenCredit = openedContracts ? openProceeds / (openedContracts * 100) : null;
        const avgCloseDebit = closedContracts ? closeCost / (closedContracts * 100) : null;
        let status: AccountLeg["status"] = "not-executed";
        let actualPnl: number | null = null;
        if (openedContracts > 0) {
          if (remaining <= 0) {
            status = "closed";
            actualPnl = openProceeds - closeCost - fees;
          } else if (expired && settlementValue != null) {
            // Remaining short contracts settle at the expiry-session intrinsic
            // value the model resolved; assignment must still be reconciled at IB.
            status = "expired";
            actualPnl = openProceeds - closeCost - settlementValue * remaining * 100 - fees;
          } else if (expired) {
            status = "unreconciled";
          } else {
            status = "open";
          }
        }
        const slippagePerContract = avgOpenCredit != null ? +(avgOpenCredit - modeledCredit).toFixed(4) : null;
        return {
          positionId: position.id,
          ticker: position.ticker,
          side: position.side,
          strike: asNumber(position.strike),
          expiry,
          modeledCredit,
          modeledContracts: position.contracts,
          modeledPnl,
          executed: openedContracts > 0,
          openedContracts,
          closedContracts,
          avgOpenCredit: avgOpenCredit != null ? +avgOpenCredit.toFixed(4) : null,
          avgCloseDebit: avgCloseDebit != null ? +avgCloseDebit.toFixed(4) : null,
          fees: +fees.toFixed(2),
          slippagePerContract,
          slippageTotal: slippagePerContract != null ? Math.round(slippagePerContract * openedContracts * 100) : 0,
          modeledPnlAtAccountSize:
            openedContracts > 0 && settlementValue != null ? Math.round((modeledCredit - settlementValue) * openedContracts * 100) : null,
          actualPnl: actualPnl != null ? Math.round(actualPnl) : null,
          settlementValue,
          status,
          firstFillAt: opens.length ? asIsoString(opens.map((f) => f.executedAt).sort((a, b) => +new Date(a) - +new Date(b))[0]) : null,
        };
      });
      const executed = legs.filter((l) => l.executed);
      if (!executed.length && !legs.some((l) => l.modeledPnl != null)) {
        // Keep weeks the account skipped entirely only once the model has settled
        // them, so the execution gap is visible without polluting live weeks.
        continue;
      }
      const settledLegs = legs.filter((l) => l.modeledPnl != null);
      const modeledPnl = settledLegs.length === legs.length ? Math.round(settledLegs.reduce((a, l) => a + (l.modeledPnl ?? 0), 0)) : null;
      const accountSized = executed.filter((l) => l.modeledPnlAtAccountSize != null);
      const actual = executed.filter((l) => l.actualPnl != null);
      weeks.push({
        weekOf: weekOfBasket(basket),
        slug: basket.slug,
        title: basket.title,
        modelLegs: legs.length,
        executedLegs: executed.length,
        executionRatePct: legs.length ? +((executed.length / legs.length) * 100).toFixed(1) : 0,
        modeledPnl,
        modeledPnlAtAccountSize: accountSized.length === executed.length && executed.length ? accountSized.reduce((a, l) => a + (l.modeledPnlAtAccountSize ?? 0), 0) : null,
        actualPnl: actual.length === executed.length && executed.length ? actual.reduce((a, l) => a + (l.actualPnl ?? 0), 0) : null,
        slippageTotal: executed.reduce((a, l) => a + l.slippageTotal, 0),
        fees: +executed.reduce((a, l) => a + l.fees, 0).toFixed(2),
        complete: executed.every((l) => l.status === "closed" || l.status === "expired") && (executed.length > 0 || modeledPnl != null),
        legs,
      });
    }
    weeks.sort((a, b) => a.weekOf.localeCompare(b.weekOf));
    const complete = weeks.filter((w) => w.complete);
    const executedLegs = weeks.reduce((a, w) => a + w.executedLegs, 0);
    const modelLegs = weeks.reduce((a, w) => a + w.modelLegs, 0);
    const contracts = weeks.flatMap((w) => w.legs).filter((l) => l.executed).reduce((a, l) => a + l.openedContracts, 0);
    const slippageTotal = weeks.reduce((a, w) => a + w.slippageTotal, 0);
    return {
      mode,
      weeks,
      totals: {
        weeks: weeks.length,
        modelLegs,
        executedLegs,
        executionRatePct: modelLegs ? +((executedLegs / modelLegs) * 100).toFixed(1) : 0,
        modeledPnl: Math.round(complete.reduce((a, w) => a + (w.modeledPnl ?? 0), 0)),
        modeledPnlAtAccountSize: Math.round(complete.reduce((a, w) => a + (w.modeledPnlAtAccountSize ?? 0), 0)),
        actualPnl: Math.round(complete.reduce((a, w) => a + (w.actualPnl ?? 0), 0)),
        slippageTotal,
        fees: +weeks.reduce((a, w) => a + w.fees, 0).toFixed(2),
        avgSlippagePerContract: contracts ? +(slippageTotal / (contracts * 100)).toFixed(4) : null,
      },
    };
  });
  return { accounts, generatedAt: new Date().toISOString() };
}
