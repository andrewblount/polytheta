import type { AppUserProfile } from "@/lib/types";

import { getCurrentBasket } from "@/server/repos/baskets";
import { getPerformanceReport } from "@/server/repos/performance";

// Per-member returns. Everyone follows the same weekly baskets; each member
// differs only in starting capital and when they started tracking. A week's
// return fraction is the settled modeled P&L over the cash the reference
// basket required, and each member compounds that fraction over their own
// equity — so a $50k member and a $500k member see the same percentages but
// their own dollars.

export interface MemberWeekReturn {
  weekOf: string;
  slug: string;
  title: string;
  returnPct: number;
  pnl: number;
  equityAfter: number;
}

export interface MemberPerformance {
  startingCapital: number;
  trackingStartDate: string | null;
  currentValue: number;
  totalReturn: number;
  totalReturnPct: number;
  weeksTracked: number;
  weeks: MemberWeekReturn[];
  // Modeled P&L of the in-progress week, scaled to this member's equity.
  // Null when there is no live basket data yet.
  liveWeekPnl: number | null;
}

export async function getMemberPerformance(
  user: Pick<AppUserProfile, "startingCapital" | "trackingStartDate">,
): Promise<MemberPerformance | null> {
  const starting =
    user.startingCapital != null ? Number(user.startingCapital) : null;
  if (!starting || !Number.isFinite(starting) || starting <= 0) {
    return null;
  }

  const startDate = user.trackingStartDate ?? null;
  const report = await getPerformanceReport();

  let equity = starting;
  const weeks: MemberWeekReturn[] = [];
  for (const week of report?.weeks ?? []) {
    if (!week.complete) continue;
    if (startDate && week.weekOf < startDate) continue;
    const base = week.cashNeeded > 0 ? week.cashNeeded : week.margin;
    if (base <= 0) continue;
    const fraction = week.pnl / base;
    const pnl = Math.round(equity * fraction);
    equity += pnl;
    weeks.push({
      weekOf: week.weekOf,
      slug: week.slug,
      title: week.title,
      returnPct: +(fraction * 100).toFixed(2),
      pnl,
      equityAfter: equity,
    });
  }

  let liveWeekPnl: number | null = null;
  const basket = await getCurrentBasket();
  if (basket && basket.cashNeeded > 0) {
    const positions = [...basket.callPositions, ...basket.putPositions];
    let weekPnl = 0;
    let observed = false;
    for (const position of positions) {
      const latest = position.latestPerformance;
      if (latest) {
        weekPnl += latest.pnlAmount;
        observed = true;
      }
    }
    if (observed) {
      liveWeekPnl = Math.round((weekPnl / basket.cashNeeded) * equity);
    }
  }

  const totalReturn = equity - starting;
  return {
    startingCapital: starting,
    trackingStartDate: startDate,
    currentValue: equity,
    totalReturn,
    totalReturnPct: +((totalReturn / starting) * 100).toFixed(2),
    weeksTracked: weeks.length,
    weeks,
    liveWeekPnl,
  };
}
