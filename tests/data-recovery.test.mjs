import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runUniverseQuotes, parseCboeWeeklys, refreshWeeklyUniverse, WEEKLYS_SOURCE } from '../scripts/lib/refresh.mjs';
import { runEarnings } from '../scripts/lib/earnings.mjs';
import { importProposal } from '../scripts/lib/import_proposal.mjs';
import { selectAffordableBasket } from '../scripts/lib/build_basket.mjs';
import { buildBasketEmailHtml, sendBasketEmail } from '../scripts/lib/basket_email.mjs';
import { assertCurrentDelivery, assertCurrentProposal } from '../shared/market-calendar.mjs';
import { DEFAULT_BROKER_SETTINGS } from '../shared/broker-settings.mjs';
import { calculateGsrs } from '../shared/gsrs.mjs';
import marketSync from '../src/server/services/market-sync.ts';
import yahooMarket from '../src/server/market/yahoo.ts';
import newsRadar from '../src/server/services/news-radar.ts';
const { runIndependentPositionTasks, selectSyncBatch } = marketSync;

const now = new Date('2026-09-08T15:00:00Z');
const temporary = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polytheta-recovery-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const put = (dir, name, value) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const quote = symbol => ({ symbol, regularMarketPrice: 20, regularMarketTime: now, marketState: 'REGULAR', averageDailyVolume10Day: 2000000 });
const symbols = Array.from({ length: 60 }, (_, i) => `A${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`);
const proposal = { basket_date: '2026-09-07', expiry: '2026-09-11', generated_ts: now.toISOString(), data_observed_at: now.toISOString(), gsrs: 2,
  picks: [{ ticker: 'ABC', side: 'call', px: 20, K: 25, cr: 0.5, contracts: 1, margin: 500, credit: 50 }], totals: { callMargin: 500, callCredit: 50 } };

test('failed quote batches keep the original denominator and recover only missing symbols', async t => {
  const OUT = temporary(t); put(OUT, 'weeklys_universe.csv', ['ticker', ...symbols].join('\n'));
  let calls = 0;
  await assert.rejects(runUniverseQuotes(OUT, { now, sleep: async () => {}, client: { quote: async batch => { if (++calls === 2) throw new Error('HTTP 503'); return batch.map(quote); } } }), /50\/60/);
  assert.equal(read(OUT, 'universe_quote_quality.json').expected, 60);
  assert.equal(read(OUT, 'universe_quote_state.json').quarantine && Object.keys(read(OUT, 'universe_quote_state.json').quarantine).length, 0);
  const fetched = [];
  const result = await runUniverseQuotes(OUT, { now, sleep: async () => {}, client: { quote: async batch => { fetched.push(...batch); return batch.map(quote); } } });
  assert.equal(result.done, 60); assert.deepEqual(fetched, symbols.slice(50));
});

test('known unavailable symbols are recorded, stay in coverage denominator, and expire from quarantine', async t => {
  const OUT = temporary(t); const list = symbols.slice(0, 20); put(OUT, 'weeklys_universe.csv', ['ticker', ...list].join('\n'));
  const result = await runUniverseQuotes(OUT, { now, sleep: async () => {}, client: { quote: async input => {
    if (typeof input === 'string') { const error = new Error('Quote not found'); error.name = 'NotFoundError'; throw error; }
    return input.filter(x => x !== list[19]).map(quote);
  } } });
  assert.equal(result.expected, 20); assert.equal(result.done, 19); assert.equal(result.quarantined, 1);
  const later = new Date(+now + 3 * 3600000), fetched = [];
  const recovered = await runUniverseQuotes(OUT, { now: later, sleep: async () => {}, client: { quote: async batch => { fetched.push(...batch); return batch.map(symbol => ({ ...quote(symbol), regularMarketTime: later })); } } });
  assert.equal(recovered.done, 20); assert.ok(fetched.includes(list[19]));
});

test('a working single-symbol lookup recovers a symbol missing from a batch', async t => {
  const OUT = temporary(t); put(OUT, 'weeklys_universe.csv', 'ticker\nABC');
  const result = await runUniverseQuotes(OUT, { now, sleep: async () => {}, client: { quote: async input => Array.isArray(input) ? [] : quote(input) } });
  assert.equal(result.done, 1);
});

test('Cboe parsing uses equity section, excludes ETFs and replaces old unsourced seeds', async t => {
  assert.deepEqual(parseCboeWeeklys('Available Weeklys - Exchange Traded Products\n"SPY","ETF"\nAvailable Weeklys - Equity\n"ABC","Acme"\n"ABC","Duplicate"'), ['ABC']);
  assert.throws(() => parseCboeWeeklys('<html>Unavailable</html>'), /section missing/);
  const OUT = temporary(t); put(OUT, 'weeklys_universe.csv', 'ticker\nDEAD');
  const list = Array.from({ length: 110 }, (_, i) => `B${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`);
  const text = `Available Weeklys - Equity\n${list.map(x => `"${x}","Company"`).join('\n')}`;
  let requests = 0;
  const fetchImpl = async url => { assert.equal(url, WEEKLYS_SOURCE); requests++; return { ok: true, text: async () => text }; };
  const result = await refreshWeeklyUniverse(OUT, { now, fetchImpl });
  assert.equal(result.count, 110); assert.ok(!fs.readFileSync(path.join(OUT, 'weeklys_universe.csv'), 'utf8').includes('DEAD'));
  await refreshWeeklyUniverse(OUT, { now, fetchImpl }); assert.equal(requests, 1);
});

test('earnings retry failed records immediately while retaining successful records', async t => {
  const OUT = temporary(t); put(OUT, 'shortlist_calls_refined.csv', 'ticker\nABC\nDEF'); put(OUT, 'shortlist_puts_refined.csv', 'ticker\n');
  let fail = true; const calls = [];
  const client = { quoteSummary: async ticker => { calls.push(ticker); if (ticker === 'DEF' && fail) throw new Error('HTTP 503'); return { calendarEvents: { earnings: { earningsDate: [new Date('2026-10-01T12:00:00Z')] } } }; }, quote: async ticker => { if (ticker === 'DEF' && fail) throw new Error('HTTP 503'); return {}; } };
  const first = await runEarnings({ OUT, client, now }); assert.equal(first.errors, 1);
  fail = false; calls.length = 0;
  const recovered = await runEarnings({ OUT, client, now }); assert.deepEqual(calls, ['DEF']); assert.equal(recovered.errors, 0); assert.equal(recovered.retained, 1);
});

test('delayed delivery preserves timestamps and prices, while entries and wrong weeks remain blocked', async t => {
  const later = new Date('2026-09-09T15:00:00Z');
  assert.doesNotThrow(() => assertCurrentDelivery(proposal, later));
  assert.throws(() => assertCurrentProposal(proposal, later), /stale/);
  assert.throws(() => assertCurrentDelivery(proposal, new Date('2026-09-14T15:00:00Z')), /week/);
  assert.throws(() => assertCurrentDelivery(proposal, new Date('2026-09-11T20:01:00Z')), /window/);
  const original = structuredClone(proposal), html = buildBasketEmailHtml(proposal, { deliveryRetry: true });
  assert.match(html, /DELAYED DELIVERY/); assert.ok(html.includes(proposal.data_observed_at)); assert.match(html, /prices have not been refreshed/);
  const previous = { key: process.env.SENDGRID_API_KEY, from: process.env.SENDGRID_FROM_EMAIL };
  process.env.SENDGRID_API_KEY = 'fixture'; process.env.SENDGRID_FROM_EMAIL = 'fixture@example.com';
  t.after(() => { for (const [key, value] of [['SENDGRID_API_KEY', previous.key], ['SENDGRID_FROM_EMAIL', previous.from]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let body;
  const result = await sendBasketEmail(proposal, { now: later, deliveryRetry: true, fetchImpl: async (_url, request) => { body = JSON.parse(request.body); return { ok: true, status: 202 }; } });
  assert.equal(result.sent, true); assert.match(body.personalizations[0].subject, /Delayed delivery/); assert.ok(body.content[0].value.includes(proposal.generated_ts)); assert.deepEqual(proposal, original);
});

test('price failures do not suppress news or later positions', async () => {
  const events = [];
  for (const ticker of ['OLD', 'LIVE']) await runIndependentPositionTasks({
    pricing: async () => { events.push(`price:${ticker}`); if (ticker === 'OLD') throw new Error('History unavailable'); },
    news: async () => { events.push(`news:${ticker}`); },
    onError: async kind => { events.push(`error:${kind}`); },
  });
  assert.deepEqual(events, ['price:OLD', 'news:OLD', 'error:pricing', 'price:LIVE', 'news:LIVE']);
});

test('a slow price read does not delay the independent news check', async () => {
  let rejectPrice, newsChecked = false;
  const pending = runIndependentPositionTasks({ pricing: () => new Promise((_resolve, reject) => { rejectPrice = reject; }), news: async () => { newsChecked = true; }, onError: async () => {} });
  assert.equal(newsChecked, true); rejectPrice(new Error('Timed out')); await pending;
});

test('sync prioritizes current week and rotates bounded cohorts past slow positions', () => {
  const active = Array.from({ length: 20 }, (_, i) => ({ position: { id: `active-${i}` }, basket: { id: 'current', weekOf: '2026-09-07' } }));
  const old = Array.from({ length: 10 }, (_, i) => ({ position: { id: `old-${i}` }, basket: { id: 'old', weekOf: '2026-08-31' } }));
  const first = selectSyncBatch([...old, ...active], {}, '2026-09-07');
  assert.equal(first.rows.length, 10); assert.equal(first.deferred, 20);
  assert.deepEqual(first.rows.slice(0, 8).map(row => row.position.id), active.slice(0, 8).map(row => row.position.id));
  const second = selectSyncBatch([...old, ...active], first.cursor, '2026-09-07');
  assert.equal(second.rows[0].position.id, 'active-8'); assert.equal(second.rows[8].position.id, 'old-2');
  const small = selectSyncBatch(active.slice(0, 4), {}, '2026-09-07');
  assert.equal(selectSyncBatch(active.slice(0, 4), small.cursor, '2026-09-07').rows[0].position.id, 'active-1');
});

test('each provider/news run passes its abort deadline to every fetch without a shared global client', async t => {
  const originalFetch = globalThis.fetch, controller = new AbortController(); let requests = 0;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    requests++; assert.ok(init.signal);
    if (init.signal.aborted) reject(init.signal.reason);
    else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const timer = setTimeout(() => controller.abort(new Error('Fixture deadline reached')), 20);
  t.after(() => clearTimeout(timer));
  const provider = new yahooMarket.YahooMarketDataProvider({ signal: controller.signal, requestTimeoutMs: 1000, attempts: 1 });
  assert.equal(await provider.getQuote('ABC'), null);
  await assert.rejects(newsRadar.scanNewsRadar('ABC', 'call', 'Acme', { signal: controller.signal, attempts: 1 }), /Fixture deadline/);
  assert.ok(requests >= 2); assert.equal(controller.signal.aborted, true);
});

test('affordability chooses a smaller complete split and never publishes a single leftover side', () => {
  const settings = { ...DEFAULT_BROKER_SETTINGS, entryCapitalPct: 1, maxTrades: 4, callAllocationPct: 50, putAllocationPct: 50 };
  const pool = [{ side: 'call', cost: 7500 }, { side: 'call', cost: 3000 }, { side: 'put', cost: 2000 }, { side: 'put', cost: 4000 }];
  const select = (counts, budget) => ({ picks: [...pool.filter(p => p.side === 'call' && p.cost <= budget).slice(0, counts.calls), ...pool.filter(p => p.side === 'put' && p.cost <= budget).slice(0, counts.puts)] });
  const result = selectAffordableBasket({ settings, modelEquity: 1000000, gsrs: 2, select });
  assert.equal(result.picks.length, 2); assert.equal(result.backingPerTrade, 5000); assert.deepEqual(result.picks.map(p => p.side), ['call', 'put']);
  const unaffordable = selectAffordableBasket({ settings: { ...settings, maxTrades: 2 }, modelEquity: 100000, gsrs: 2, select });
  assert.equal(unaffordable.picks.length, 0); assert.equal(unaffordable.backingPerTrade, 0);
});

test('imports run inside a transaction, roll back failures and permit status-only publication', async t => {
  const OUT = temporary(t), file = path.join(OUT, 'proposal.json'); put(OUT, 'proposal.json', proposal);
  let began = 0, ended = 0, committed = false, fail = true; const statements = [];
  const connectionFactory = () => ({ begin: async callback => {
    began++;
    const result = await callback({ unsafe: async (query, parameters) => {
      statements.push([query, parameters]);
      if (query.startsWith('select id, status')) return committed ? [{ id: 'basket', status: 'archived' }] : [];
      if (query.startsWith('select ticker')) return proposal.picks.map(p => ({ ticker: p.ticker, side: p.side, strike: p.K, expiry: proposal.expiry, contracts: p.contracts, estimated_entry_credit: p.cr }));
      if (query.includes('insert into market_conditions') && fail) throw new Error('Fixture child insert failed');
      return query.includes('returning id') ? [{ id: 'basket' }] : [];
    } });
    committed = true; return result;
  }, end: async () => { ended++; } });
  await assert.rejects(importProposal(file, { publish: true, connectionFactory }), /Fixture child/); assert.equal(committed, false); assert.equal(ended, 1);
  fail = false; await importProposal(file, { publish: false, connectionFactory }); assert.equal(committed, true);
  statements.length = 0; const result = await importProposal(file, { publish: true, connectionFactory });
  assert.equal(result.status, 'published'); assert.equal(result.unchanged, true); assert.equal(began, 3); assert.equal(ended, 3);
  assert.equal(statements.filter(([sql]) => sql.startsWith('update baskets set status')).length, 1);
  assert.ok(!statements.some(([sql]) => /delete|insert/i.test(sql)));
});

test('GSRS retains the historical normalization, weighting and rounding formula', () => {
  const clamp = x => Math.max(0, Math.min(10, x));
  for (let i = 0; i < 1000; i++) {
    const VIX = 10 + i % 80, VIX_prev = 12 + i % 25, SKEW = 70 + i % 160, HY_OAS = 0.1 + (i % 200) / 10, MOVE = 30 + i % 180, PC = 0.1 + (i % 25) / 10;
    const historical = +(0.4 * clamp((VIX - 10) / 4 + Math.max(0, VIX - VIX_prev) * 0.5) + 0.2 * clamp((SKEW - 100) / 10) + 0.2 * clamp((HY_OAS - 1.5) / (3.59 - 1.5) * 5) + 0.1 * clamp((MOVE - 50) / 10) + 0.1 * clamp((1 - PC) * 7)).toFixed(2);
    assert.equal(calculateGsrs({ VIX, VIX_prev, SKEW, HY_OAS, MOVE, PC }).score, historical);
  }
});
