import { eq } from "drizzle-orm";
import { db } from "@/db";
import { basketMetrics, baskets, performanceSnapshots, positions } from "@/db/schema";
import { getModelSettings, type ModelSettings } from "@/server/services/model-settings";
import { modelBacking, sideEnabled } from "@/lib/model-sizing";
import { asNumber } from "./helpers";

// Persist the model sizing to every basket — historical and current.
//
// The published legs keep their per-contract economics (entry credit, strike,
// underlying, margin per contract, option values in every snapshot); only the
// contract count is what the current model settings would have bought:
//   backing   = equity × share traded × margin available
//   per trade = backing × allocation scale ÷ enabled legs in the basket
//   contracts = floor(per trade ÷ (max(underlying, strike) × 100))
// This is the same arithmetic as computeModelPerformance / resizeLeg, so the
// stored baskets, the performance report and the apps agree. Snapshot P&L is
// recomputed from its own option value rather than scaled, so remodeling is
// exact and idempotent (a leg sized to zero and back loses nothing).
//
// Nothing here touches the IB account: real fills live in trades/journal and
// the account report always shows what was actually executed.

export interface RemodelSummary {
  at: string;
  model: ModelSettings;
  backing: number;
  baskets: number;
  positions: number;
  positionsChanged: number;
  snapshots: number;
}

type Meta = Record<string, unknown>;

export async function remodelBaskets(model?: ModelSettings): Promise<RemodelSummary | null> {
  if (!db) return null;
  const settings = model ?? (await getModelSettings());
  const backing = modelBacking(settings);
  const at = new Date();
  const [basketRows, positionRows, metricRows, snapshotRows] = await Promise.all([
    db.select().from(baskets),
    db.select().from(positions),
    db.select().from(basketMetrics),
    db.select({ id: performanceSnapshots.id, positionId: performanceSnapshots.positionId, optionMark: performanceSnapshots.optionMark, estimatedOptionValue: performanceSnapshots.estimatedOptionValue, pnlAmount: performanceSnapshots.pnlAmount, pnlPercent: performanceSnapshots.pnlPercent }).from(performanceSnapshots),
  ]);
  const metricByBasket = new Map(metricRows.map((m) => [m.basketId, m]));
  const positionsByBasket = new Map<string, typeof positionRows>();
  for (const row of positionRows) positionsByBasket.set(row.basketId, [...(positionsByBasket.get(row.basketId) ?? []), row]);
  const snapshotsByPosition = new Map<string, typeof snapshotRows>();
  for (const snap of snapshotRows) snapshotsByPosition.set(snap.positionId, [...(snapshotsByPosition.get(snap.positionId) ?? []), snap]);

  const summary: RemodelSummary = { at: at.toISOString(), model: settings, backing, baskets: 0, positions: 0, positionsChanged: 0, snapshots: 0 };

  for (const basket of basketRows) {
    const legs = positionsByBasket.get(basket.id) ?? [];
    if (legs.length === 0) continue;
    const metric = metricByBasket.get(basket.id);
    const other = ((metric?.otherMetrics ?? {}) as Meta);
    const scale = Number(other.allocation_scale ?? 1) || 1;
    const enabled = legs.filter((leg) => sideEnabled(leg.side, settings));
    const perTrade = enabled.length ? (backing * scale) / enabled.length : 0;
    let totalMargin = 0, totalCredit = 0, callCount = 0, putCount = 0;

    for (const leg of legs) {
      summary.positions += 1;
      const meta = ((leg.sourceMetadata ?? {}) as Meta);
      // Per-contract margin is captured from the published leg the first time
      // it is remodeled, so later remodels never compound rounding or lose it.
      const unit = ((meta.sizing_unit as Meta | undefined) ?? {
        margin_per_contract: leg.contracts > 0 ? leg.margin / leg.contracts : 0,
        published_contracts: leg.contracts,
        published_margin: leg.margin,
      }) as { margin_per_contract: number; published_contracts: number; published_margin: number };
      const entryPrice = asNumber(leg.entryUnderlyingPrice), strike = asNumber(leg.strike), credit = asNumber(leg.estimatedEntryCredit);
      const unitBacking = Math.max(entryPrice, strike) * 100;
      const contracts = sideEnabled(leg.side, settings) && unitBacking > 0 && perTrade > 0 ? Math.floor(perTrade / unitBacking) : 0;
      const margin = Math.round((Number(unit.margin_per_contract) || 0) * contracts);
      if (contracts > 0) { if (leg.side === "call") callCount += 1; else putCount += 1; }
      totalMargin += margin;
      totalCredit += Math.round(credit * 100 * contracts);

      const remodel = { at: at.toISOString(), model_equity: settings.modelEquity, backing, allocation_scale: scale, per_trade_backing: perTrade, enabled_legs: enabled.length };
      const changed = contracts !== leg.contracts || margin !== leg.margin || !meta.sizing_unit;
      if (changed) {
        summary.positionsChanged += 1;
        await db.update(positions)
          .set({ contracts, margin, sourceMetadata: { ...meta, sizing_unit: unit, remodel }, updatedAt: at })
          .where(eq(positions.id, leg.id));
      }
      // Every snapshot's P&L follows from its own option value at the new size.
      for (const snap of snapshotsByPosition.get(leg.id) ?? []) {
        const value = snap.optionMark != null ? asNumber(snap.optionMark) : snap.estimatedOptionValue != null ? asNumber(snap.estimatedOptionValue) : 0;
        const pnlAmount = (credit - value) * 100 * contracts;
        const pnlPercent = pnlAmount / Math.max(margin, 1);
        if (Math.abs(pnlAmount - asNumber(snap.pnlAmount)) > 0.005 || Math.abs(pnlPercent - asNumber(snap.pnlPercent)) > 1e-6) {
          summary.snapshots += 1;
          await db.update(performanceSnapshots)
            .set({ pnlAmount: pnlAmount.toFixed(2), pnlPercent: pnlPercent.toFixed(6) })
            .where(eq(performanceSnapshots.id, snap.id));
        }
      }
    }

    summary.baskets += 1;
    const cashNeeded = Math.round(perTrade * enabled.length);
    const quickSummary = (basket.quickSummary ?? []).map((item) => {
      const label = String((item as Meta).label ?? "");
      if (label === "Total margin") return { ...item, value: `$${totalMargin.toLocaleString()}` };
      if (label === "Est. credit") return { ...item, value: `$${totalCredit.toLocaleString()}` };
      if (label === "RoM at max profit") return { ...item, value: totalMargin ? `${((totalCredit / totalMargin) * 100).toFixed(2)}%` : "n/a" };
      if (label === "Names") return { ...item, value: `${callCount + putCount} (${callCount} call / ${putCount} put)` };
      return item;
    });
    await db.update(baskets).set({ cashNeeded, quickSummary, updatedAt: at }).where(eq(baskets.id, basket.id));
    if (metric) {
      await db.update(basketMetrics).set({
        totalMargin, cashNeeded, totalEstimatedCredit: totalCredit, callCount, putCount,
        otherMetrics: { ...other, rom_pct: totalMargin ? Number(((totalCredit / totalMargin) * 100).toFixed(2)) : null, model_equity: settings.modelEquity, model_equity_source: "settings-remodel", remodeled_at: at.toISOString(), model_sizing: { ...settings, backing } },
        updatedAt: at,
      }).where(eq(basketMetrics.id, metric.id));
    }
  }
  return summary;
}
