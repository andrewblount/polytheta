import test from 'node:test';
import assert from 'node:assert/strict';
import accountPerformance from '../src/server/repos/account-performance.ts';
const { computeAccountPerformance } = accountPerformance;

// Two model legs; the paper account entered one at a worse credit and let it
// expire; the other was never executed. The model and the account must be
// reported side by side, with slippage and execution rate explicit.
const basketRows = [{ id: 'b1', slug: 'weekly-basket-2026-09-14', title: 'Weekly Basket — September 14, 2026 Entry', weekOf: '2026-09-14' }];
const positionRows = [
  { id: 'p1', basketId: 'b1', ticker: 'HIMS', side: 'call', strike: '30.50', expiry: '2026-09-18', estimatedEntryCredit: '0.22', contracts: 2 },
  { id: 'p2', basketId: 'b1', ticker: 'CIFR', side: 'call', strike: '18.00', expiry: '2026-09-18', estimatedEntryCredit: '0.14', contracts: 3 },
];
const settledRows = [
  { positionId: 'p1', observedAt: '2026-09-18T20:00:00Z', pnlAmount: '44', optionMark: '0', estimatedOptionValue: '0' },
  { positionId: 'p2', observedAt: '2026-09-18T20:00:00Z', pnlAmount: '-60', optionMark: '0.34', estimatedOptionValue: '0.34' },
];
const fillRows = [
  // Linked by contract only (older worker never set position_id): 3 contracts at 0.19 vs model 0.22, $1.50 fees.
  { positionId: null, ticker: 'HIMS', side: 'call', strike: '30.50', expiry: '2026-09-18', action: 'sell-to-open', quantity: 3, price: '0.19', fees: '1.50', broker: 'IBKR paper', executedAt: '2026-09-14T13:52:00Z' },
];
const now = Date.parse('2026-09-24T00:00:00Z');

test('account performance separates the paper account from the model and measures slippage and execution', () => {
  const report = computeAccountPerformance({ basketRows, positionRows, fillRows, settledRows, now });
  assert.equal(report.accounts.length, 1);
  const paper = report.accounts[0];
  assert.equal(paper.mode, 'paper');
  assert.equal(paper.weeks.length, 1);
  const week = paper.weeks[0];
  assert.equal(week.executedLegs, 1); assert.equal(week.modelLegs, 2); assert.equal(week.executionRatePct, 50);
  assert.equal(week.modeledPnl, -16, 'the full model basket: +44 and -60');
  const hims = week.legs.find(l => l.ticker === 'HIMS');
  assert.equal(hims.status, 'expired');
  assert.equal(hims.slippagePerContract, -0.03);
  assert.equal(hims.slippageTotal, -9, '3 contracts × $0.03 × 100');
  assert.equal(hims.modeledPnlAtAccountSize, 66, 'model credit on the account\'s 3 contracts, settled worthless');
  assert.equal(hims.actualPnl, 56, '3 × 0.19 × 100 − 1.50 fees, rounded');
  const cifr = week.legs.find(l => l.ticker === 'CIFR');
  assert.equal(cifr.status, 'not-executed'); assert.equal(cifr.executed, false); assert.equal(cifr.modeledPnl, -60);
  assert.equal(week.actualPnl, 56); assert.equal(week.modeledPnlAtAccountSize, 66); assert.equal(week.slippageTotal, -9); assert.equal(week.fees, 1.5);
  assert.equal(week.complete, true);
  assert.equal(paper.totals.actualPnl, 56); assert.equal(paper.totals.modeledPnl, -16); assert.equal(paper.totals.executionRatePct, 50);
  assert.equal(paper.totals.avgSlippagePerContract, -0.03);
});

test('an unsettled expired short without a closing fill is flagged unreconciled, and live fills form their own track', () => {
  const live = [{ ...fillRows[0], positionId: 'p2', ticker: 'CIFR', strike: '18.00', quantity: 1, price: '0.15', broker: 'IBKR live' }];
  const report = computeAccountPerformance({ basketRows, positionRows, fillRows: [...fillRows, ...live], settledRows: settledRows.filter(r => r.positionId !== 'p2'), now });
  assert.deepEqual(report.accounts.map(a => a.mode), ['live', 'paper']);
  const liveWeek = report.accounts[0].weeks[0];
  const cifr = liveWeek.legs.find(l => l.ticker === 'CIFR');
  assert.equal(cifr.status, 'unreconciled'); assert.equal(cifr.actualPnl, null); assert.equal(liveWeek.complete, false);
  // A closing fill resolves it.
  const closed = { ...live[0], action: 'buy-to-close', price: '0.05', fees: '1.00', executedAt: '2026-09-17T15:00:00Z' };
  const resolved = computeAccountPerformance({ basketRows, positionRows, fillRows: [...fillRows, ...live, closed], settledRows, now });
  const leg = resolved.accounts[0].weeks[0].legs.find(l => l.ticker === 'CIFR');
  assert.equal(leg.status, 'closed'); assert.equal(leg.actualPnl, 8, '(0.15 − 0.05) × 100 − 2.50 fees');
});
