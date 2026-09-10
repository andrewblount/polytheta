import test from 'node:test';
import assert from 'node:assert/strict';
import briefingModule from '../src/server/services/briefing.ts';
const { actualBriefingSummary, buildBriefing } = briefingModule;

const now = new Date('2026-09-11T19:50:00Z');
const ownedPosition = { ticker: 'ABC', quantity: 2, workingEntry: false, expiry: '2026-09-18', reconciled: true,
  unrealizedPnl: 40, realizedPnl: 125, feesComplete: true };
const freshBroker = () => ({ stale: false, snapshot: {
  scope: 'PolyTheta only', observedAt: now.toISOString(), positions: [{ ...ownedPosition }], fees: 2.5, complete: true,
  // Account-level totals deliberately disagree. Only attributed rows count.
  unrealizedPnl: 999999, accountDayPnl: 888888, liquidationValue: 777777,
} });

test('briefing actual P/L uses only reconciled PolyTheta holdings and never whole-account totals', () => {
  const actual = actualBriefingSummary(freshBroker(), now);
  assert.equal(actual.unrealizedPnl, 40);
  assert.equal(actual.realizedPnl, 125);
  assert.match(actual.compact, /PolyTheta IB open P\/L \+\$40 before fees/);
  assert.ok(actual.rows.some(([label, value]) => label === 'PolyTheta confirmed fees' && value === '$2.50'));
  assert.doesNotMatch(JSON.stringify(actual), /999999|888888|777777|net premium|Schwab/);
});

test('stale, absent and unscoped IB snapshots are unavailable rather than reported as current zero P/L', () => {
  for (const broker of [
    { ...freshBroker(), stale: true },
    { stale: true, snapshot: null },
    { stale: false, snapshot: { ...freshBroker().snapshot, scope: 'Whole account' } },
    { stale: false, snapshot: { ...freshBroker().snapshot, observedAt: new Date(+now - 120001).toISOString() } },
  ]) {
    const result = actualBriefingSummary(broker, now);
    assert.equal(result.unrealizedPnl, null);
    assert.equal(result.realizedPnl, null);
    assert.match(result.compact, /unavailable/);
    assert.doesNotMatch(JSON.stringify(result.rows), /\+\$0|\+\$40|\+\$125/);
  }
});

test('pending historical settlement leaves current reconciled open P/L visible but not realized totals', () => {
  const broker = freshBroker();
  broker.snapshot.complete = false;
  broker.snapshot.positions.push({ ...ownedPosition, ticker: 'OLD', expiry: '2026-09-04', quantity: 0, reconciled: false, unrealizedPnl: null, realizedPnl: 0, feesComplete: false });
  const actual = actualBriefingSummary(broker, now);
  assert.equal(actual.unrealizedPnl, 40);
  assert.equal(actual.realizedPnl, null);
  assert.match(JSON.stringify(actual.rows), /settlement or reconciliation pending|partial; awaiting IB/);
  broker.snapshot.positions[1].expiry = '2026-09-18';
  assert.equal(actualBriefingSummary(broker, now).unrealizedPnl, null, 'a current missing holding cannot silently disappear from actual losses');
});

test('future entries and future snapshots cannot affect modeled briefing P/L', () => {
  const past = { observedAt: '2026-09-10T19:55:00Z', pnlAmount: 10, state: 'safe' };
  const present = { observedAt: '2026-09-11T19:45:00Z', pnlAmount: 50, state: 'safe' };
  const future = { observedAt: '2026-09-11T19:55:00Z', pnlAmount: 999, state: 'safe' };
  const basket = { weekOf: '2026-09-14', gsrs: 2.5, callPositions: [
    { ticker: 'ABC', side: 'call', strike: 25, entryTimestamp: '2026-09-10T19:50:00Z', performanceHistory: [past, present, future], latestPerformance: future },
    { ticker: 'FUTURE', side: 'call', strike: 35, entryTimestamp: '2026-09-11T19:55:00Z', performanceHistory: [present, future], latestPerformance: future },
  ], putPositions: [] };
  const report = { weeks: [], stats: { totalPnl: 100, completeWeeks: 1, winningWeeks: 1, legWinRatePct: 100 } };
  const briefing = buildBriefing('close', { basket, report, broker: freshBroker(), now });
  assert.equal(briefing.dayPnl, 40);
  assert.equal(briefing.weekPnl, 50);
  assert.equal(briefing.totalReturn, 150);
  assert.match(briefing.title, /modeled day/);
  assert.match(briefing.html, /1 planned positions are excluded/);
  assert.doesNotMatch(briefing.html, /Schwab|Actual net premium|999/);
  assert.match(briefing.html, /PolyTheta open P\/L/);
  const memberHtml = briefing.buildHtml([['Your tracked value (modeled)', '$5,000']]);
  assert.doesNotMatch(memberHtml, /PolyTheta open P\/L|PolyTheta realized P\/L|IB actuals|\$2\.50/);
  assert.doesNotMatch(briefing.modeledCompact, /IB open P\/L/);
});
