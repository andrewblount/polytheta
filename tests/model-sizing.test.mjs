import test from 'node:test';
import assert from 'node:assert/strict';
import { validateModelSettings, modelPolicy, DEFAULT_MODEL_SETTINGS } from '../shared/model-settings.mjs';
import { validateBrokerSettings, sizingBacking, basketCounts, sideSplit } from '../shared/broker-settings.mjs';
import performance from '../src/server/repos/performance.ts';
const { resizeLeg } = performance;

test('model settings validate, default to full account at 400% margin with both sides on', () => {
  assert.deepEqual(validateModelSettings({}), { ...DEFAULT_MODEL_SETTINGS });
  assert.equal(validateModelSettings({ modelEquity: '50000' }).modelEquity, 50000);
  assert.throws(() => validateModelSettings({ marginAvailablePct: 50 }), /marginAvailablePct/);
  assert.throws(() => validateModelSettings({ accountTradedPct: 120 }), /accountTradedPct/);
  assert.throws(() => validateModelSettings({ sellCalls: 'yes' }), /on or off/);
});

test('the model policy lays the model sizing over the broker basket shape', () => {
  const broker = validateBrokerSettings({ maxTrades: 6, callAllocationPct: 50, putAllocationPct: 50, entryCapitalPct: 30, marginAvailablePct: 200, sellPuts: false });
  const policy = modelPolicy(broker, { modelEquity: 100000, accountTradedPct: 100, marginAvailablePct: 400, sellCalls: true, sellPuts: true });
  assert.equal(policy.entryCapitalPct, 100, 'the model trades its own share, not the account\'s');
  assert.equal(policy.marginAvailablePct, 400); assert.equal(policy.sellPuts, true, 'the account\'s put toggle does not reach the model');
  assert.equal(sizingBacking(policy.modelEquity, policy), 400000);
  assert.deepEqual(basketCounts(policy), { calls: 3, puts: 3, total: 6 }, 'the broker split still shapes the basket');
  assert.deepEqual(sideSplit({ ...policy, sellCalls: false }), { callAllocationPct: 0, putAllocationPct: 100 });
  // The IB account sizes from its own settings.
  assert.equal(sizingBacking(50000, broker), 30000);
});

test('historical legs re-size from the current model settings, keeping per-contract economics', () => {
  // Published: 132 contracts of a $36 stock at $0.58 credit that expired worthless (+$7,656).
  const leg = { entryPrice: 27.73, strike: 36, contracts: 132, margin: 55024, credit: 7656, pnl: 7656 };
  const perTrade = sizingBacking(50000, { accountTradedPct: 100, marginAvailablePct: 400 }) / 5; // $40,000 per leg
  const sized = resizeLeg(leg, perTrade);
  assert.equal(sized.contracts, 11, 'floor(40000 / 3600)');
  assert.equal(sized.pnl, 7656 * 11 / 132); assert.equal(sized.credit, 638); assert.equal(sized.margin, 4585);
  assert.equal(resizeLeg(leg, 1000).contracts, 0, 'unaffordable under the settings: not traded');
  assert.equal(resizeLeg({ ...leg, pnl: null }, perTrade).pnl, null);
});

test('the shared sizing report recalculates the whole track record from the published legs', async () => {
  const { computeModelPerformance, modelBacking } = await import('../src/lib/model-sizing.ts');
  const source = [{
    weekOf: '2026-08-31', slug: 'weekly-basket-2026-08-31', title: 'Week', gsrs: 2.5, cashNeeded: 100000, allocationScale: 1,
    legs: [
      { positionId: 'a', ticker: 'AAA', side: 'call', strike: 36, entryPrice: 27.73, entryCredit: 0.58, contracts: 132, margin: 55024, credit: 7656, pnl: 7656, state: 'expired-otm', settledAt: '2026-09-04T20:00:00Z' },
      { positionId: 'b', ticker: 'BBB', side: 'put', strike: 20, entryPrice: 25, entryCredit: 0.30, contracts: 100, margin: 40000, credit: 3000, pnl: -2000, state: 'expired-itm', settledAt: '2026-09-04T20:00:00Z' },
    ],
  }, {
    weekOf: '2026-09-07', slug: 'weekly-basket-2026-09-07', title: 'Open', gsrs: 3, cashNeeded: 1, allocationScale: 1,
    legs: [{ positionId: 'c', ticker: 'CCC', side: 'call', strike: 10, entryPrice: 9, entryCredit: 0.1, contracts: 10, margin: 1000, credit: 100, pnl: null, state: null, settledAt: null }],
  }];
  const model = { modelEquity: 50000, accountTradedPct: 100, marginAvailablePct: 400, sellCalls: true, sellPuts: true };
  assert.equal(modelBacking(model), 200000);
  const report = computeModelPerformance(source, model);
  // $100,000 per leg: 27 contracts of AAA (+$1,566), 40 of BBB (−$800).
  assert.equal(report.weeks[0].pnl, 766); assert.equal(report.weeks[0].complete, true); assert.equal(report.weeks[1].complete, false);
  assert.equal(report.stats.totalPnl, 766); assert.equal(report.stats.completeWeeks, 1); assert.equal(report.stats.worstLeg.ticker, 'BBB');
  assert.equal(report.basis.backing, 200000);
  // Puts off: the calls take the whole backing and the losing put disappears.
  const callsOnly = computeModelPerformance(source, { ...model, sellPuts: false });
  assert.equal(callsOnly.weeks[0].legs, 1); assert.equal(callsOnly.weeks[0].pnl, 7656 * 55 / 132 | 0);
  // Half the account: contracts halve, so does the P&L (within rounding).
  const half = computeModelPerformance(source, { ...model, accountTradedPct: 50 });
  assert.ok(Math.abs(half.weeks[0].pnl - 766 / 2) < 60);
  // Published sizing is the original contracts.
  const published = computeModelPerformance(source, null);
  assert.equal(published.weeks[0].pnl, 5656); assert.equal(published.basis.sizing, 'published');
});
