import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrokerSettings } from '../shared/broker-settings.mjs';
import { syncLossStopCoverage, recordEntryBaseline, evaluateLossStops, tickerEntryBlocked, lossStopForEntry, lossStopQuoteContracts } from '../shared/loss-stop.mjs';
import { executionCycle } from '../scripts/broker/execution-engine.mjs';
import { accountFingerprint } from '../shared/broker-portfolio.mjs';

const now = new Date('2026-09-08T14:00:00Z');
const settings = validateBrokerSettings({ pauseEntries: false });
const week = '2026-09-07';
const contract = { conid: 123, symbol: 'ABC', side: 'call', strike: 25, expiry: '2026-09-11', multiplier: 100, tick: .01 };
const quote = (c = contract, ask = 3, at = now) => ({ conid: c.conid, bid: ask - .05, ask, bidSize: 10, askSize: 10, realtime: true, observedAt: +at });
const emptyJournal = () => ({ intents: {}, fills: {}, signals: {} });
function addEntry(journal, { ref = 'entry', c = contract, equity = 1000, quantity = 2, price = 1, commission = 1, basket = week } = {}) {
  const entry = { ref, action: 'entry', contract: c, pick: { ticker: c.symbol, side: c.side }, week: basket, quantity, status: 'Filled', filled: quantity };
  recordEntryBaseline(journal, entry, { netLiquidation: equity }, now);
  journal.intents[ref] = entry;
  journal.fills[`fill:${ref}`] = { executionId: `fill:${ref}`, ref, contract: c, action: 'entry', quantity, price, commission };
  return entry;
}
function evaluate(journal, { positions = [{ conid: 123, quantity: -2 }], quotes = new Map([[123, quote()]]), at = now, ...rest } = {}) {
  return evaluateLossStops({ journal, positions, quotes, settings, now: at, ...rest });
}
function fixture() {
  const journal = emptyJournal(), entry = addEntry(journal);
  const writes = [], publications = [], events = [];
  const account = { grossPositionValue: 0, netLiquidation: 10000, availableFunds: 10000, excessLiquidity: 10000, cash: 10000 };
  const broker = {
    account: 'U_TEST', connect: async () => ({ mode: 'live' }), accountSummary: async () => account,
    positions: async () => [{ conid: 123, quantity: -2 }, { conid: 999, quantity: -500, symbol: 'ABC' }], orders: async () => [], executions: async () => [],
    quote: async c => quote(c), cancel: async id => { writes.push({ cancel: id }); events.push('cancel'); },
    submit: async order => { writes.push({ submit: order }); events.push('submit'); return { orderId: String(writes.length), status: 'Submitted' }; },
    modify: async (id, order) => { writes.push({ modify: id, order }); events.push('modify'); },
  };
  return { broker, journal, entry, writes, publications, events, settings, proposal: null, enabled: true, now,
    save: async () => {}, scanNews: async () => { events.push('news'); return []; }, publish: async snapshot => { publications.push(snapshot); } };
}

test('ticker loss uses actual credits, fresh ask debit and known fees, excluding unrelated account positions', () => {
  const journal = emptyJournal(), entry = addEntry(journal);
  assert.deepEqual(evaluate(journal), []);
  const stop = lossStopForEntry(journal, entry);
  assert.equal(stop.baselineEquity, 1000);
  assert.equal(stop.thresholdAmount, 200);
  assert.equal(stop.lossAmount, 401);
  assert.equal(stop.lossPct, 40.1);
  assert.equal(stop.status, 'triggered');
  assert.equal(journal.signals[123].lossStop, true);
  assert.equal(journal.signals[999], undefined);
});

test('each ticker has its own threshold and overlapping contracts share the first entry baseline', () => {
  const journal = emptyJournal(), a = addEntry(journal, { equity: 10000, quantity: 1 });
  const other = { ...contract, conid: 456, symbol: 'DEF' };
  const b = addEntry(journal, { ref: 'other', c: other, equity: 20000, quantity: 1 });
  const a2 = addEntry(journal, { ref: 'same-ticker', c: { ...contract, conid: 124 }, equity: 30000, quantity: 1 });
  evaluate(journal, { positions: [{ conid: 123, quantity: -1 }, { conid: 124, quantity: -1 }, { conid: 456, quantity: -1 }], quotes: new Map([[123, quote(contract, 10)], [124, quote(a2.contract, 10)], [456, quote(other, 30)]]) });
  assert.equal(lossStopForEntry(journal, a).lossAmount, 1802);
  assert.equal(lossStopForEntry(journal, a).status, 'monitoring');
  assert.equal(lossStopForEntry(journal, a2).baselineEquity, 10000);
  assert.equal(lossStopForEntry(journal, b).thresholdAmount, 4000);
  assert.equal(lossStopForEntry(journal, b).status, 'monitoring');
});

test('partial closes retain realized losses and a triggered latch survives recovery and overnight', () => {
  const journal = emptyJournal(), entry = addEntry(journal);
  evaluate(journal);
  const stop = lossStopForEntry(journal, entry), triggeredAt = stop.triggeredAt;
  journal.intents.exit = { ref: 'exit', action: 'exit', contract, week, lossStopId: stop.id, status: 'Cancelled', quantity: 2 };
  journal.fills.close = { ref: 'exit', action: 'exit', contract, quantity: 1, price: 4, commission: 1 };
  evaluate(journal, { positions: [{ conid: 123, quantity: -1 }], quotes: new Map([[123, quote(contract, .5)]]) });
  assert.equal(stop.lossAmount, 252); // $200 entry - $400 closed - $50 remaining - $2 fees.
  assert.equal(stop.remainingQuantity, 1);
  assert.equal(stop.triggeredAt, triggeredAt);
  evaluate(journal, { positions: [{ conid: 123, quantity: -1 }], quotes: new Map(), at: new Date('2026-09-09T01:00:00Z') });
  assert.equal(stop.status, 'triggered');
  assert.equal(stop.available, false);
  assert.equal(journal.signals[123].detectedAt, triggeredAt);
});

test('unknown fees do not suppress an already-proven loss breach', () => {
  const journal = emptyJournal(), entry = addEntry(journal, { commission: null });
  evaluate(journal);
  const stop = lossStopForEntry(journal, entry);
  assert.equal(stop.lossAmount, 400);
  assert.equal(stop.status, 'triggered');
  assert.match(stop.message, /commissions are pending/);
});

test('missing historical equity, stale quotes and quantity mismatches are visible rather than invented', () => {
  const journal = emptyJournal(), entry = addEntry(journal);
  delete journal.lossStops;
  syncLossStopCoverage(journal);
  assert.match(evaluate(journal)[0], /Pre-entry IB equity was not recorded/);
  assert.equal(lossStopForEntry(journal, entry).baselineEquity, null);
  assert.equal(tickerEntryBlocked(journal, 'ABC', week), true);
  const healthy = emptyJournal(); addEntry(healthy);
  assert.match(evaluate(healthy, { quotes: new Map([[123, quote(contract, 3, new Date(+now - 60000))]]) })[0], /stale/);
  assert.match(evaluate(healthy, { positions: [{ conid: 123, quantity: -1 }] })[0], /does not reconcile/);
  assert.equal(Object.keys(healthy.signals).length, 0);
});

test('a filled order without all execution records cannot appear flat and reset the baseline', () => {
  const journal = emptyJournal(), entry = addEntry(journal);
  journal.fills = {};
  assert.match(evaluate(journal)[0], /executions do not fully reconcile/);
  assert.equal(lossStopForEntry(journal, entry).closedAt, undefined);
});

test('confirmed flat trigger retains history, blocks its basket, and permits a fresh future basket baseline', () => {
  const journal = emptyJournal(), entry = addEntry(journal);
  evaluate(journal);
  const stop = lossStopForEntry(journal, entry);
  journal.intents.exit = { ref: 'exit', action: 'exit', contract, week, quantity: 2, status: 'Filled', lossStopId: stop.id };
  journal.fills.close = { ref: 'exit', action: 'exit', contract, quantity: 2, price: 3, commission: 1 };
  evaluate(journal, { positions: [] });
  assert.equal(stop.status, 'closed');
  assert.equal(stop.lossAmount, 402);
  assert.equal(tickerEntryBlocked(journal, 'ABC', week), true);
  assert.equal(tickerEntryBlocked(journal, 'ABC', '2026-09-14'), false);
  assert.deepEqual(lossStopQuoteContracts(journal), []);
  const next = { ref: 'next-week', action: 'entry', contract: { ...contract, conid: 124 }, week: '2026-09-14' };
  recordEntryBaseline(journal, next, { netLiquidation: 5000 }, new Date('2026-09-14T14:00:00Z'));
  assert.equal(journal.lossStops[next.ref].baselineEquity, 5000);
  assert.equal(journal.lossStops[stop.id], stop);
  assert.equal(stop.baselineEquity, 1000);
});

test('a late fill after confirmed entry cancellation reopens the original baseline instead of losing risk coverage', () => {
  const journal = emptyJournal(), entry = addEntry(journal);
  journal.fills = {};
  entry.status = 'Cancelled';
  evaluate(journal, { positions: [] });
  const stop = lossStopForEntry(journal, entry);
  assert.equal(stop.status, 'closed');
  journal.fills.late = { ref: entry.ref, contract, action: 'entry', quantity: 1, price: 1, commission: 1 };
  syncLossStopCoverage(journal);
  evaluate(journal, { positions: [{ conid: 123, quantity: -1 }] });
  assert.equal(stop.closedAt, undefined);
  assert.equal(stop.baselineEquity, 1000);
  assert.equal(stop.status, 'triggered');
  assert.equal(stop.lossAmount, 201);
});

test('loss latch is saved before an exit and only that ticker PolyTheta quantity is closed', async () => {
  const args = fixture();
  let persisted = false;
  args.save = async journal => { persisted = Boolean(lossStopForEntry(journal, args.entry).triggeredAt); };
  args.broker.submit = async order => {
    assert.equal(persisted, true);
    assert.equal(args.journal.intents[order.ref].status, 'uncertain');
    args.writes.push({ submit: order }); return { orderId: '2', status: 'Submitted' };
  };
  const other = { ...contract, conid: 456, symbol: 'DEF' };
  addEntry(args.journal, { ref: 'other', c: other, equity: 10000, quantity: 1 });
  args.broker.positions = async () => [{ conid: 123, quantity: -5 }, { conid: 456, quantity: -1 }, { conid: 999, quantity: -500 }];
  args.scanNews = async () => { throw new Error('News provider unavailable'); };
  await executionCycle(args);
  const exits = args.writes.filter(write => write.submit);
  assert.equal(exits.length, 1);
  assert.equal(exits[0].submit.quantity, 2);
  assert.equal(exits[0].submit.contract.conid, 123);
  assert.equal(exits[0].submit.dynamicAsk, true);
  assert.equal(exits[0].submit.ceiling, undefined);
  assert.equal(args.publications.at(-1).positions.find(row => row.conid === 123).lossStop.status, 'triggered');
});

test('an acknowledged loss exit follows the refreshed ask each cycle before news, with no old ceiling or 60-second delay', async () => {
  const args = fixture();
  args.journal.intents.exit = { ref: 'exit', action: 'exit', contract, week, quantity: 2, status: 'Submitted', orderId: '2', limit: 3, ceiling: 4.5, submittedAt: new Date(+now - 1000).toISOString() };
  args.broker.quote = async c => quote(c, 20.003);
  const other = { ...contract, conid: 456, symbol: 'DEF' };
  addEntry(args.journal, { ref: 'other', c: other, equity: 100000, quantity: 1 });
  args.broker.positions = async () => [{ conid: 123, quantity: -2 }, { conid: 456, quantity: -1 }];
  await executionCycle(args);
  assert.equal(args.writes.filter(write => write.submit).length, 0);
  assert.equal(args.writes[0].modify, '2');
  assert.equal(args.writes[0].order.limit, 20.01);
  assert.ok(args.events.indexOf('modify') < args.events.indexOf('news'));
});

test('a loss-triggered partial entry is cancelled first and closes only after cancellation and fills reconcile', async () => {
  const args = fixture();
  Object.assign(args.entry, { quantity: 4, status: 'Submitted', orderId: '1', submittedAt: now.toISOString() });
  args.broker.orders = async () => [{ ref: args.entry.ref, conid: 123, orderId: '1', status: 'Submitted' }];
  await executionCycle(args);
  assert.deepEqual(args.writes, [{ cancel: '1' }]);
  args.broker.orders = async () => [{ ref: args.entry.ref, conid: 123, orderId: '1', status: 'Cancelled' }];
  await executionCycle(args);
  assert.equal(args.writes[1].submit.quantity, 2);
});

test('a timeout cannot create a second risk exit or modify an un-reconciled uncertain order', async () => {
  const args = fixture(); let submissions = 0;
  args.broker.submit = async () => { submissions++; throw new Error('Unknown IB result'); };
  await assert.rejects(executionCycle(args), /Unknown IB result/);
  await assert.rejects(executionCycle(args), /uncertain/);
  assert.equal(submissions, 1);
  const exit = Object.values(args.journal.intents).find(intent => intent.action === 'exit');
  exit.orderId = '2'; exit.limit = 1;
  await assert.rejects(executionCycle(args), /uncertain/);
  assert.equal(args.writes.length, 0);
});

test('a cancelled partial risk exit retries only its remaining PolyTheta contracts', async () => {
  const args = fixture();
  await executionCycle(args);
  const exit = Object.values(args.journal.intents).find(intent => intent.action === 'exit');
  args.broker.orders = async () => [{ ref: exit.ref, conid: 123, orderId: exit.orderId, status: 'Cancelled' }];
  args.broker.executions = async () => [{ executionId: 'closed', ref: exit.ref, conid: 123, quantity: 1, price: 3, commission: 1 }];
  args.broker.positions = async () => [{ conid: 123, quantity: -1 }];
  await executionCycle(args);
  const submissions = args.writes.filter(write => write.submit);
  assert.deepEqual(submissions.map(write => write.submit.quantity), [2, 1]);
  assert.notEqual(submissions[0].submit.ref, submissions[1].submit.ref);
});

test('a manual exit request does not erase a same-cycle loss trigger', async () => {
  const args = fixture();
  args.commands = [{ requestId: 'manual', accountKey: accountFingerprint(args.broker.account), scope: 'position', targets: [{ conid: 123, quantity: 2 }] }];
  await executionCycle(args);
  assert.equal(args.writes.find(write => write.submit).submit.dynamicAsk, true);
  assert.equal(args.journal.signals[123].manual, true);
  assert.equal(args.journal.signals[123].lossStop, true);
});

test('risk monitoring unavailable blocks new entries but preserves manual exits', async () => {
  const args = fixture(); delete args.journal.lossStops;
  args.journal.signals[123] = { manual: true };
  const result = await executionCycle(args);
  assert.match(result.message, /Loss monitoring unavailable; new entries blocked/);
  assert.equal(args.writes.find(write => write.submit).submit.quantity, 2);
  assert.equal(args.publications.at(-1).positions[0].lossStop.baselineEquity, null);
});

test('disabled monitoring can detect and publish a loss without any broker write', async () => {
  const args = fixture(); args.enabled = false;
  await executionCycle(args);
  assert.equal(args.writes.length, 0);
  assert.equal(args.publications.at(-1).positions[0].lossStop.status, 'triggered');
});

test('a stalled news provider has a bounded read after the loss exit has already been serviced', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const args = fixture(), other = { ...contract, conid: 456, symbol: 'DEF' };
  addEntry(args.journal, { ref: 'other', c: other, equity: 10000, quantity: 1 });
  args.broker.positions = async () => [{ conid: 123, quantity: -2 }, { conid: 456, quantity: -1 }];
  let started;
  const newsStarted = new Promise(resolve => { started = resolve; });
  args.scanNews = async () => { started(); return new Promise(() => {}); };
  const running = executionCycle(args);
  await newsStarted;
  assert.equal(args.writes.filter(write => write.submit).length, 1);
  t.mock.timers.tick(10000);
  await running;
  assert.match(args.journal.newsOutage.message, /timed out/);
});

test('later tickers receive fair news scans even after a slow IB connection and the first ticker hangs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let wall = 0;
  t.mock.method(Date, 'now', () => wall);
  const args = fixture(), other = { ...contract, conid: 456, symbol: 'DEF' };
  args.journal.lossStops.entry.baselineEquity = 10000;
  addEntry(args.journal, { ref: 'other', c: other, equity: 10000, quantity: 1 });
  args.broker.connect = async () => { wall += 60000; return { mode: 'live' }; };
  args.broker.positions = async () => [{ conid: 123, quantity: -2 }, { conid: 456, quantity: -1 }];
  args.broker.quote = async c => quote(c, 3, new Date(+now + wall));
  const scanned = []; let allStarted, abandonedSignal;
  const started = new Promise(resolve => { allStarted = resolve; });
  args.scanNews = async (pick, { signal }) => {
    scanned.push(pick.ticker);
    if (scanned.length === 2) allStarted();
    if (pick.ticker === 'ABC') { abandonedSignal = signal; return new Promise(() => {}); }
    return [{ actionable: true, link: 'https://example.com/rumor', publishedAt: new Date(+now + wall).toISOString() }];
  };
  const running = executionCycle(args);
  await started;
  assert.deepEqual(scanned, ['ABC', 'DEF']);
  await new Promise(resolve => setImmediate(resolve));
  wall += 10000; t.mock.timers.tick(10000);
  await running;
  assert.equal(abandonedSignal.aborted, true);
  const exits = args.writes.filter(write => write.submit);
  assert.equal(exits.length, 1);
  assert.equal(exits[0].submit.contract.conid, 456);
});

test('a different ticker quote timeout cannot age out a healthy ticker loss breach', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let wall = 0;
  t.mock.method(Date, 'now', () => wall);
  const args = fixture(), other = { ...contract, conid: 456, symbol: 'DEF' };
  addEntry(args.journal, { ref: 'other', c: other, equity: 10000, quantity: 1 });
  args.broker.positions = async () => [{ conid: 123, quantity: -2 }, { conid: 456, quantity: -1 }];
  args.broker.quote = async c => c.conid === 456 ? new Promise(() => {}) : quote(c, 3, new Date(+now + wall));
  const running = executionCycle(args);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(args.journal.lossStops.entry.status, 'triggered');
  wall += 16000; t.mock.timers.tick(15000);
  const result = await running;
  assert.match(result.message, /DEF: Live IB risk quote timed out/);
  const exits = args.writes.filter(write => write.submit);
  assert.equal(exits.length, 1);
  assert.equal(exits[0].submit.contract.conid, 123);
});

test('a risk exit quote that ages during the final write fence is never transmitted', async t => {
  const args = fixture(); let wall = 0;
  t.mock.method(Date, 'now', () => wall);
  args.beforeWrite = async () => { wall += 16000; };
  await assert.rejects(executionCycle(args), /stale/);
  assert.equal(args.writes.length, 0);
  const exit = Object.values(args.journal.intents).find(intent => intent.action === 'exit');
  assert.equal(exit.status, 'Cancelled');
  assert.match(exit.reconciledReason, /no order sent/);
});

test('a fresh account read immediately before transmission determines the baseline, not the initial basket budget', async () => {
  const args = fixture(); args.journal = emptyJournal(); args.broker.positions = async () => [];
  const pick = { ticker: 'ABC', name: 'Acme', side: 'call', K: 25, px: 20, atr: 2, cr: .5, iv: 1,
    pricing_reference: { observedAt: now.toISOString(), spot: 20, iv: 1, vix: 20, credit: .5, strike: 25, side: 'call', expiry: contract.expiry },
    rule_checks: { earnings_clear: 'pass', thesis_signals: { radar: 'pass' } } };
  args.proposal = { basket_date: week, expiry: contract.expiry, generated_ts: now.toISOString(), data_observed_at: now.toISOString(), picks: [pick] };
  args.broker.resolve = async () => contract;
  args.broker.quote = async () => ({ ...quote(contract, .55), bid: .45, delta: .18, optionIv: 1, underlyingPrice: 20 });
  args.broker.preview = async () => ({ initialMarginChange: 500, maintenanceMarginChange: 500 });
  let accountReads = 0;
  args.broker.accountSummary = async () => ({ grossPositionValue: 0, netLiquidation: ++accountReads < 3 ? 10000 : 12000, availableFunds: 20000, excessLiquidity: 20000, cash: 20000 });
  args.broker.submit = async order => {
    const stop = args.journal.lossStops[order.lossStopId];
    assert.equal(stop.baselineEquity, 12000);
    assert.equal(args.journal.budgets[week].equity, 10000);
    args.writes.push({ submit: order }); return { orderId: '1', status: 'Submitted' };
  };
  await executionCycle(args);
  assert.equal(accountReads, 3);
  assert.equal(args.writes.length, 1); // No standing stop is sent alongside entry.
  assert.equal(args.writes[0].submit.action, 'entry');
});
