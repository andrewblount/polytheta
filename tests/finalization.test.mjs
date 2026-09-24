import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finalizeBasket, freezeFinalProposal, preparationMatches, preparationPolicy, requireCurrentModelPolicy } from '../scripts/lib/finalize_basket.mjs';
import { basketThesis } from '../shared/basket-thesis.mjs';
import { chainUnderlying, WEEKLYS_SOURCE } from '../scripts/lib/refresh.mjs';
import { importProposal, findPublishedProposal } from '../scripts/lib/import_proposal.mjs';
import { DEFAULT_BROKER_SETTINGS } from '../shared/broker-settings.mjs';
import { entrySchedule } from '../shared/entry-schedule.mjs';
import { pricingReference, repriceEntry } from '../shared/entry-pricing.mjs';
import { assertCurrentDelivery, assertCurrentProposal } from '../shared/market-calendar.mjs';

function fixture(mode = 'monday-morning') {
  const friday = mode === 'friday-close';
  const now = new Date(friday ? '2026-09-11T19:45:00Z' : '2026-09-14T13:35:00Z');
  const settings = { ...DEFAULT_BROKER_SETTINGS, entryTiming: mode, maxTrades: 1 };
  const iv = friday ? .35 : .48;
  const reference = { ticker: 'ABC', observedAt: '2026-09-11T19:00:00Z', underlyingObservedAt: '2026-09-11T19:00:00Z', spot: 20, strike: 21, iv, credit: .35, side: 'call', expiry: '2026-09-18', vix: 20 };
  const prepared = { basket_date: '2026-09-14', expiry: '2026-09-18', phase: 'prepared', generated_ts: reference.observedAt, data_observed_at: reference.observedAt,
    preparation_policy: preparationPolicy(settings), model_equity: 100000, allocation_settings: settings, macro: { VIX: 20 },
    picks: [{ ticker: 'ABC', side: 'call', K: 21, px: 20, iv, cr: .35, atr: .5, pricing_reference: reference }] };
  const stock = { symbol: 'ABC', regularMarketPrice: 20, regularMarketTime: now };
  const macroQuotes = [['SPY', 550], ['^GSPC', 5500], ['^VIX', 20], ['^SKEW', 110], ['^MOVE', 70]].map(([symbol, regularMarketPrice]) => ({ symbol, regularMarketPrice, regularMarketTime: now, regularMarketPreviousClose: 20 }));
  const option = { strike: 21, impliedVolatility: iv, bid: .80, ask: .90 };
  const chain = { options: [{ expirationDate: new Date('2026-09-18'), calls: [option], puts: [] }] };
  const tv = { basket_date: prepared.basket_date, fetched_ts: now.toISOString(), hy_oas: { value: 2, date: '2026-09-10' }, pc_ratio: { total: 1, as_of: '2026-09-10' }, error: null };
  const news = { ABC: { call: [], put: [], checked_at: now.toISOString() } };
  const weeklys = { source: WEEKLYS_SOURCE, fetched_at: now.toISOString(), tickers: ['ABC'] };
  const calls = [];
  const dependencies = { now, client: {
    quote: async ticker => Array.isArray(ticker) ? macroQuotes : stock,
    options: async (ticker, request) => { calls.push({ ticker, date: request.date }); return chain; },
    quoteSummary: async () => ({ calendarEvents: { earnings: { earningsDate: [new Date('2026-10-25')] } } }),
  }, macros: async () => tv, radar: async () => news, universe: async () => weeklys };
  return { now, settings, prepared, stock, macroQuotes, option, chain, tv, news, weeklys, calls, dependencies };
}
const metricsOther = queries => queries.find(([sql]) => sql.includes('insert into basket_metrics'))[1][10];
const temporary = t => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polytheta-finalization-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; };

test('the model finalizes on its own data whatever the IB account, host or connection state', async () => {
  // A selected execution computer, a paper account and an IB outage change nothing for the model.
  const f = fixture();
  f.settings.executionHostId = 'selected-host'; f.settings.accountMode = 'paper';
  const result = await finalizeBasket(f.prepared, f.settings, f.dependencies);
  assert.equal(result.phase, 'final');
  assert.equal(result.picks[0].quote_source, 'Yahoo Finance');
  assert.equal(result.picks[0].bid, .80);
  assert.equal(result.late, false);
  assert.equal(f.calls.length, 1, 'the model reads its own Yahoo chain');
  // Execution-only settings never invalidate a model preparation.
  const execOnly = { ...f.settings, executionHostId: 'other-host', twsPort: 4002, accountMode: 'live', connection: 'web-api', pauseEntries: true };
  assert.equal(preparationPolicy(execOnly), preparationPolicy(f.settings));
  assert.notEqual(preparationPolicy({ ...f.settings, maxTrades: 3 }), preparationPolicy(f.settings));
  const thesis = basketThesis(result);
  assert.match(thesis.headline, /1 short call/); assert.match(thesis.regime, /GSRS/); assert.equal(thesis.picks[0].ticker, 'ABC'); assert.match(thesis.picks[0].text, /strike 21/);
});

test('a basket priced after the entry window is still finalized, marked late with its true pricing time', async () => {
  const f = fixture();
  const lateTime = new Date('2026-09-14T15:10:00Z'); // 11:10 ET, 40 minutes after the window closed
  f.stock.regularMarketTime = lateTime; for (const q of f.macroQuotes) q.regularMarketTime = lateTime;
  f.tv.fetched_ts = lateTime.toISOString(); f.news.ABC.checked_at = lateTime.toISOString(); f.weeklys.fetched_at = lateTime.toISOString();
  const result = await finalizeBasket(f.prepared, f.settings, { ...f.dependencies, now: lateTime });
  assert.equal(result.late, true); assert.equal(result.late_minutes, 40);
  assert.equal(result.entry_timestamp, lateTime.toISOString()); assert.equal(result.entry_date, '2026-09-14'); assert.equal(result.scheduled_entry_date, '2026-09-14');
  assert.match(result.late_note, /40 minutes after/);
  // Wednesday of the same week still publishes (late); the expiry session never does.
  const wednesday = new Date('2026-09-16T15:00:00Z');
  f.option.impliedVolatility = .62; // two days out the same strike only qualifies at a higher IV; otherwise the model rebuilds
  f.stock.regularMarketTime = wednesday; for (const q of f.macroQuotes) q.regularMarketTime = wednesday;
  f.tv.fetched_ts = wednesday.toISOString(); f.news.ABC.checked_at = wednesday.toISOString(); f.weeklys.fetched_at = wednesday.toISOString();
  const midweek = await finalizeBasket(f.prepared, f.settings, { ...f.dependencies, now: wednesday });
  assert.equal(midweek.late, true); assert.equal(midweek.entry_date, '2026-09-16');
  await assert.rejects(finalizeBasket(f.prepared, f.settings, { ...f.dependencies, now: new Date('2026-09-18T15:00:00Z') }), /expiry session/);
  await assert.rejects(finalizeBasket(f.prepared, f.settings, { ...f.dependencies, now: lateTime, allowLate: false }), /late model publication is disabled/);
});

test('publication re-reads the model policy at every side-effect boundary and ignores execution settings', async () => {
  const f = fixture();
  let settings = { ...f.settings, executionHostId: 'selected-host' }, reads = 0;
  const loadSettings = async () => { reads++; return settings; };
  const rejected = error => error.code === 'MODEL_POLICY_CHANGED';
  await requireCurrentModelPolicy(f.prepared, { loadSettings });
  settings = { ...settings, executionHostId: 'new-host' };
  await requireCurrentModelPolicy(f.prepared, { loadSettings });
  settings = { ...settings, executionHostId: '' };
  await requireCurrentModelPolicy(f.prepared, { loadSettings, deliveryOnly: true });
  settings = { ...settings, entryCapitalPct: 25 };
  await assert.rejects(requireCurrentModelPolicy(f.prepared, { loadSettings }), rejected);
  const original = structuredClone(f.prepared);
  await requireCurrentModelPolicy(f.prepared, { loadSettings, deliveryOnly: true });
  assert.deepEqual(f.prepared, original);
  await assert.rejects(requireCurrentModelPolicy(f.prepared, { loadSettings: async () => { throw new Error('Database unavailable'); } }), rejected);
  assert.equal(reads, 5);
});

test('Monday finalization preserves the dated exact-contract anchor and uses current IV and underlying', async () => {
  const f = fixture();
  const result = await finalizeBasket(f.prepared, f.settings, f.dependencies);
  const p = result.picks[0], expected = repriceEntry({ reference: f.prepared.picks[0].pricing_reference, spot: 20, optionIv: .48, vix: 20, now: new Date('2026-09-14T13:45:00Z'), settings: f.settings });
  assert.equal(result.phase, 'final'); assert.equal(result.entry_timestamp, '2026-09-14T13:45:00.000Z');
  assert.deepEqual(p.pricing_reference, f.prepared.picks[0].pricing_reference);
  assert.equal(p.entry_pricing.credit, expected.credit); assert.ok(p.cr < .35); assert.notEqual(p.cr, .85);
  assert.equal(p.entry_pricing.ivSource, 'current option IV');
  assert.equal(p.quote_observed_at, f.now.toISOString()); assert.equal(p.underlying_observed_at, f.now.toISOString());
  assert.match(p.quote_timestamp_basis, /exchange bid\/ask timestamp unavailable/);
  assert.equal(f.calls[0].date.toISOString().slice(0, 10), '2026-09-18');
  assert.equal(result.tv_macros_source.pc, 'CBOE 2026-09-10');
  assert.equal(result.weeklys_universe_source.source, WEEKLYS_SOURCE);
  assert.equal(f.prepared.phase, 'prepared'); assert.equal(f.prepared.picks[0].cr, .35);
});

test('fresh Monday reference does not charge the weekend twice', async () => {
  const f = fixture();
  f.now = new Date('2026-09-14T13:45:00Z');
  f.dependencies.now = f.now;
  const reference = f.prepared.picks[0].pricing_reference;
  reference.observedAt = f.now.toISOString(); reference.credit = .25;
  f.prepared.generated_ts = f.now.toISOString();
  const result = await finalizeBasket(f.prepared, f.settings, f.dependencies);
  assert.equal(result.picks[0].entry_pricing.elapsedCalendarDays, 0);
  assert.equal(result.picks[0].cr, .25);
});

test('finalization uses completion time and refuses reads finishing after entry closes', async () => {
  const f = fixture(), completed = new Date('2026-09-14T13:41:00Z');
  let reads = 0;
  const result = await finalizeBasket(f.prepared, f.settings, { ...f.dependencies, clock: () => ++reads === 1 ? f.now : completed });
  assert.equal(result.generated_ts, completed.toISOString()); assert.equal(result.finalized_at, completed.toISOString());
  assert.equal(result.picks[0].quote_observed_at, completed.toISOString());
  assert.equal(result.data_observed_at, f.now.toISOString());
  reads = 0;
  const after = new Date('2026-09-14T14:30:01Z');
  f.stock.regularMarketTime = after; for (const q of f.macroQuotes) q.regularMarketTime = after;
  f.tv.fetched_ts = after.toISOString(); f.news.ABC.checked_at = after.toISOString(); f.weeklys.fetched_at = after.toISOString();
  const late = await finalizeBasket(f.prepared, f.settings, { ...f.dependencies, clock: () => ++reads === 1 ? f.now : after });
  assert.equal(late.late, true, 'reads finishing after the window still publish, flagged late');
  assert.equal(late.entry_timestamp, '2026-09-14T14:30:01.000Z');
});

test('Friday preparation remains reusable at Monday open until finalization without a full rebuild', () => {
  const f = fixture();
  assert.equal(preparationMatches(f.prepared, f.settings, '2026-09-14', new Date('2026-09-14T13:30:00Z')), true);
  assert.equal(preparationMatches(f.prepared, { ...f.settings, callAllocationPct: 50, putAllocationPct: 50 }, '2026-09-14', f.now), false);
  assert.equal(preparationMatches({ ...f.prepared, basket_date: '2026-09-07' }, f.settings, '2026-09-14', f.now), false);
});

test('finalizer rejects changed exact references, duplicate contracts, and noncanonical week keys', async () => {
  for (const mutation of [p => { p.pricing_reference.strike = 22; }, p => { p.pricing_reference.expiry = '2026-09-25'; }, p => { p.pricing_reference.ticker = 'WRONG'; }]) {
    const f = fixture(); mutation(f.prepared.picks[0]);
    await assert.rejects(finalizeBasket(f.prepared, f.settings, f.dependencies), /exact option contract/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.prepared.picks.push(structuredClone(f.prepared.picks[0]));
  await assert.rejects(finalizeBasket(f.prepared, f.settings, f.dependencies), /duplicate/);
  assert.throws(() => entrySchedule('2026-09-15', f.settings), /Monday date/);
  assert.throws(() => pricingReference({ side: 'call', K: 21, pricing_reference: { side: 'put', strike: 21, expiry: '2026-09-18' } }, f.prepared), /exact option/);
});

test('final checks fail closed on stale primary sources, news, quotes and nonfinite risk inputs', async () => {
  for (const [mutate, expected] of [
    [f => { f.tv.hy_oas.date = '2026-09-01'; }, /HY OAS publication/],
    [f => { f.tv.pc_ratio.as_of = '2026-09-01'; }, /Cboe put\/call publication/],
    [f => { f.tv.fetched_ts = 'invalid'; }, /Macro download/],
    [f => { f.weeklys.fetched_at = '2026-09-11T19:45:00Z'; }, /Cboe weekly universe/],
    [f => { f.weeklys.tickers = ['OTHER']; }, /absent/],
    [f => { f.news.ABC.checked_at = '2026-09-11T19:45:00Z'; }, /news source/],
    [f => { f.stock.regularMarketTime = new Date('2026-09-11T19:45:00Z'); }, /Current-session stock/],
    [f => { f.option.ask = Infinity; }, /exact option market/],
    [f => { f.prepared.picks[0].atr = NaN; }, /ATR reference/],
    [f => { f.prepared.model_equity = Infinity; }, /capital/],
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(finalizeBasket(f.prepared, f.settings, f.dependencies), expected);
  }
});

test('dated chain snapshot uses its associated stock quote and refuses stale or nonfinite underlying', () => {
  const now = new Date('2026-09-11T19:05:00Z');
  assert.deepEqual(chainUnderlying({ regularMarketPrice: 21.15, regularMarketTime: new Date('2026-09-11T19:04:50Z') }, now), { price: 21.15, underlyingObservedAt: '2026-09-11T19:04:50.000Z' });
  assert.throws(() => chainUnderlying({ regularMarketPrice: Infinity, regularMarketTime: now }, now), /unavailable/);
  assert.throws(() => chainUnderlying({ regularMarketPrice: 20, regularMarketTime: new Date('2026-09-10T20:00:00Z') }, now), /unavailable/);
});

test('finalized artifacts survive uncertain publication and refuse replacement by a rebuild', async t => {
  const f = fixture(), proposal = await finalizeBasket(f.prepared, f.settings, f.dependencies);
  const file = path.join(temporary(t), 'basket_proposal.json');
  freezeFinalProposal(file, proposal);
  assert.deepEqual(freezeFinalProposal(file, structuredClone(proposal)), proposal);
  const replacement = structuredClone(proposal); replacement.picks[0].cr += .1;
  assert.throws(() => freezeFinalProposal(file, replacement), /frozen/);
  assert.throws(() => freezeFinalProposal(file, f.prepared), /Only a finalized/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), proposal);
});

test('late delivery of the frozen current-week basket preserves Friday pricing without allowing a new entry', async () => {
  const f = fixture('friday-close'), proposal = await finalizeBasket(f.prepared, f.settings, f.dependencies);
  const original = structuredClone(proposal);
  assert.doesNotThrow(() => assertCurrentDelivery(proposal, new Date('2026-09-14T16:00:00Z')));
  assert.throws(() => assertCurrentProposal(proposal, new Date('2026-09-14T16:00:00Z')), /stale/);
  assert.throws(() => assertCurrentDelivery(proposal, new Date('2026-09-21T16:00:00Z')), /different trading week/);
  assert.deepEqual(proposal, original);
});

test('prepared or late-entry artifacts never open a database connection', async t => {
  const f = fixture(), file = path.join(temporary(t), 'proposal.json'); let connections = 0;
  assert.throws(() => assertCurrentDelivery(f.prepared, f.now), /not finalized/);
  assert.throws(() => assertCurrentProposal(f.prepared, f.now), /not finalized/);
  const connectionFactory = () => { connections++; throw new Error('Unexpected database access'); };
  fs.writeFileSync(file, JSON.stringify(f.prepared));
  await assert.rejects(importProposal(file, { publish: true, connectionFactory }), /finalization is required/);
  const final = await finalizeBasket(f.prepared, f.settings, f.dependencies);
  // A late pricing time must be declared late; an unflagged out-of-window stamp is a corrupt artifact.
  fs.writeFileSync(file, JSON.stringify({ ...final, entry_timestamp: '2026-09-14T14:30:01.000Z' }));
  await assert.rejects(importProposal(file, { publish: true, connectionFactory }), /marked late/);
  fs.writeFileSync(file, JSON.stringify({ ...final, entry_timestamp: '2026-09-18T20:00:00.000Z', late: true }));
  await assert.rejects(importProposal(file, { publish: true, connectionFactory }), /exchange week/);
  assert.equal(connections, 0);
});

test('Friday import persists its pricing audit and a seven-day hold without rewriting historical positions', async t => {
  const f = fixture('friday-close'), proposal = await finalizeBasket(f.prepared, f.settings, f.dependencies), file = path.join(temporary(t), 'proposal.json');
  fs.writeFileSync(file, JSON.stringify(proposal));
  const queries = []; let stored = null;
  const connectionFactory = () => ({ begin: async callback => callback({ unsafe: async (sql, params) => {
    queries.push([sql, params]);
    if (sql.startsWith('select id, status')) return stored ? [{ id: 'basket', status: 'published' }] : [];
    if (sql.startsWith('select ticker')) return stored;
    if (sql.startsWith('select key from app_settings')) return [{ key: params[0] }];
    return sql.includes('returning id') ? [{ id: 'fixture' }] : [];
  } }), end: async () => {} });
  await importProposal(file, { publish: true, connectionFactory });
  const position = queries.find(([sql]) => sql.includes('insert into positions'))[1];
  assert.equal(position[21], '2026-09-11T19:55:00.000Z');
  // jsonb parameters travel as objects; the driver serializes them (strings would be double-encoded).
  assert.equal(typeof position[22], 'object'); assert.equal(typeof metricsOther(queries), 'object');
  assert.deepEqual(position[22].pricing_reference, proposal.picks[0].pricing_reference);
  assert.deepEqual(position[22].entry_pricing, proposal.picks[0].entry_pricing);
  const metrics = queries.find(([sql]) => sql.includes('insert into basket_metrics'))[1];
  assert.equal(metrics[10].hold_days, 7);
  assert.match(metrics[10].thesis.headline, /short call/);
  assert.equal(metrics[10].late, false);
  const modelBasket = queries.find(([sql]) => sql.includes('insert into app_settings'));
  assert.equal(modelBasket[1][0], 'model_basket:2026-09-14');
  assert.equal(modelBasket[1][1].phase, 'final');
  assert.match(position[18], /Short call at 21/);
  assert.match(queries.find(([sql]) => sql.includes('insert into baskets'))[1][0], /September 11/);
  const p = proposal.picks[0];
  // The database rounds the credit to two decimals; the retry must still recognise its own basket.
  // PostgreSQL rounds numeric(10,2) half-up on the exact decimal (0.195 -> 0.20); JS toFixed does not.
  const half = (Math.round(p.cr * 100) / 100 + 0.005).toFixed(3);
  proposal.picks[0].cr = Number(half); fs.writeFileSync(file, JSON.stringify(proposal));
  stored = [{ ticker: p.ticker, side: p.side, strike: String(p.K), expiry: new Date(proposal.expiry), contracts: p.contracts, estimated_entry_credit: (Math.round(Number(half) * 100 + 1e-6) / 100).toFixed(2), entry_timestamp: proposal.entry_timestamp, source_metadata: { pricing_reference: p.pricing_reference, entry_pricing: p.entry_pricing } }];
  queries.length = 0;
  assert.equal((await importProposal(file, { publish: true, connectionFactory })).unchanged, true);
  assert.ok(!queries.some(([sql]) => /delete|insert|update/i.test(sql)));
  stored[0].source_metadata.entry_pricing = { ...p.entry_pricing, referenceCredit: .99 };
  await assert.rejects(importProposal(file, { publish: true, connectionFactory }), /different pricing audit/);
});

test('uncertain import recovers only an exactly matching already-published basket using readback only', async () => {
  const f = fixture('friday-close'), proposal = await finalizeBasket(f.prepared, f.settings, f.dependencies);
  let basket = { id: 'existing', status: 'published', publication_date: new Date(proposal.generated_ts) };
  const p = proposal.picks[0];
  const stored = [{ ticker: p.ticker, side: p.side, strike: p.K, expiry: proposal.expiry, contracts: p.contracts, estimated_entry_credit: p.cr, entry_timestamp: new Date(proposal.entry_timestamp), source_metadata: { pricing_reference: p.pricing_reference, entry_pricing: p.entry_pricing } }];
  const queries = []; let ended = 0;
  const connectionFactory = () => ({ begin: async callback => callback({ unsafe: async (sql, params) => {
    queries.push([sql, params]); assert.match(sql, /^select /);
    return sql.startsWith('select id, status') ? basket ? [basket] : [] : stored;
  } }), end: async () => { ended++; } });
  assert.doesNotThrow(() => assertCurrentDelivery(proposal, new Date('2026-09-14T18:00:00Z')));
  assert.deepEqual(await findPublishedProposal(proposal, { connectionFactory }), { slug: 'weekly-basket-2026-09-14', basketId: 'existing', publishedAt: proposal.generated_ts });
  basket = { ...basket, status: 'archived' };
  assert.equal(await findPublishedProposal(proposal, { connectionFactory }), null);
  basket = null;
  assert.equal(await findPublishedProposal(proposal, { connectionFactory }), null);
  basket = { id: 'existing', status: 'published', publication_date: new Date(+new Date(proposal.generated_ts) + 1) };
  await assert.rejects(findPublishedProposal(proposal, { connectionFactory }), /original publication timestamp/);
  basket.publication_date = proposal.generated_ts;
  stored[0].estimated_entry_credit += .01;
  await assert.rejects(findPublishedProposal(proposal, { connectionFactory }), /immutable/);
  stored[0].estimated_entry_credit = p.cr;
  stored[0].source_metadata.pricing_reference = { ...p.pricing_reference, observedAt: '2026-09-10T19:00:00Z' };
  await assert.rejects(findPublishedProposal(proposal, { connectionFactory }), /pricing audit/);
  assert.equal(ended, 6); assert.ok(queries.length > 6);
});
