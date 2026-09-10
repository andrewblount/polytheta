// Generic weekly Yahoo refresh (macro + universe quotes + options chains).
// Extracted from scripts/_run_weekly_refresh_*.mjs so the same code runs every week.

import { createYahooClient } from './yahoo_client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { easternTime, sessionClose } from '../../shared/market-calendar.mjs';
import { retryRead } from '../../shared/retry.mjs';

const yf = createYahooClient();
export const WEEKLYS_SOURCE = 'https://www.cboe.com/available_weeklys/get_csv_download/';

export function parseCboeWeeklys(text) {
  const equity = text.split('Available Weeklys - Equity')[1];
  if (!equity) throw new Error('Cboe equity weekly-options section missing');
  const tickers = [...equity.matchAll(/^"([A-Z]{1,5})","/gm)].map(match => match[1]);
  if (!tickers.length) throw new Error('Cboe equity weekly-options list is empty');
  return [...new Set(tickers)].sort();
}

export async function refreshWeeklyUniverse(OUT, { force = false, now = new Date(), fetchImpl = fetch } = {}) {
  const metadataFile = path.join(OUT, 'weeklys_universe_source.json');
  const target = path.join(OUT, 'weeklys_universe.csv');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(metadataFile, 'utf8')); } catch { /* old unsourced seed */ }
  const age = +now - Date.parse(old.fetched_at);
  if (!force && old.source === WEEKLYS_SOURCE && Number.isFinite(age) && age >= 0 && age < 6 * 3600000 && fs.existsSync(target)) return { ...old, cached: true };
  const { text, tickers } = await retryRead(async () => {
    const response = await fetchImpl(WEEKLYS_SOURCE, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Cboe weekly universe HTTP ${response.status}`);
    const text = await response.text(), tickers = parseCboeWeeklys(text);
    if (tickers.length < 100) throw new Error('Cboe weekly equity universe unexpectedly small; refusing partial data');
    return { text, tickers };
  });
  if (fs.existsSync(target)) {
    const archive = path.join(OUT, 'refresh_history', now.toISOString().replaceAll(':', '-'), 'universe');
    fs.mkdirSync(archive, { recursive: true });
    fs.copyFileSync(target, path.join(archive, 'weeklys_universe.csv'));
    if (fs.existsSync(metadataFile)) fs.copyFileSync(metadataFile, path.join(archive, 'weeklys_universe_source.json'));
    const raw = path.join(OUT, 'cboe_weeklys_source.csv');
    if (fs.existsSync(raw)) fs.copyFileSync(raw, path.join(archive, 'cboe_weeklys_source.csv'));
  }
  fs.writeFileSync(path.join(OUT, 'cboe_weeklys_source.csv'), text);
  fs.writeFileSync(target, ['ticker', ...tickers].join('\n'));
  const metadata = { source: WEEKLYS_SOURCE, fetched_at: now.toISOString(), count: tickers.length };
  fs.writeFileSync(metadataFile, JSON.stringify(metadata, null, 2));
  return metadata;
}

function csvRow(vals) {
  return vals
    .map((v) => {
      if (v == null) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}
function ncdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
function bsDelta(S, K, T, r, sigma, type) {
  if (T <= 0 || sigma <= 0) return type === 'call' ? (S > K ? 1 : 0) : S < K ? -1 : 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
}
function realizedVol(closes, w) {
  if (closes.length < w + 1) return null;
  const rets = [];
  for (let i = closes.length - w; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v * 252);
}
function rollingRV(closes, w) {
  const out = [];
  for (let i = w; i < closes.length; i++) out.push(realizedVol(closes.slice(i - w, i + 1), w));
  return out.filter((v) => v != null);
}
function hvRank(series, cur) {
  if (!series.length || cur == null) return null;
  const mx = Math.max(...series), mn = Math.min(...series);
  if (mx === mn) return null;
  return ((cur - mn) / (mx - mn)) * 100;
}
function atr14(hist) {
  if (hist.length < 15) return null;
  let s = 0, n = 0;
  for (let i = hist.length - 14; i < hist.length; i++) {
    const h = hist[i].high, l = hist[i].low, pc = hist[i - 1].close;
    if (h == null || l == null || pc == null) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    s += tr; n++;
  }
  return n ? s / n : null;
}

// Step 1: macro quotes + SPY/GSPC/VIX history.
async function runMacro(OUT) {
  const macroTickers = [
    'SPY', '^GSPC', '^VIX', '^SKEW', '^MOVE', '^OVX', '^RVX', 'QQQ', 'IWM',
    'TLT', 'HYG', 'JNK', 'DXY', 'UUP', 'GLD', 'USO', 'XLE', 'XLF', 'XLK',
  ];
  const macroQuotes = await yf.quote(macroTickers);
  const rows = [
    'ticker,price,currency,exchange,market_time,prev_close,fifty_two_wk_high,fifty_two_wk_low',
  ];
  for (const q of macroQuotes) {
    rows.push(csvRow([
      q.symbol, q.regularMarketPrice, q.currency, q.fullExchangeName,
      q.regularMarketTime ? new Date(q.regularMarketTime).toISOString() : '',
      q.regularMarketPreviousClose, q.fiftyTwoWeekHigh, q.fiftyTwoWeekLow,
    ]));
  }
  fs.writeFileSync(path.join(OUT, 'macro_quotes.csv'), rows.join('\n'));

  const end = new Date();
  const start = new Date(end.getTime() - 180 * 86400 * 1000);
  for (const t of ['SPY', '^GSPC', '^VIX']) {
    try {
      const h = await yf.chart(t, { period1: start, period2: end, interval: '1d' });
      const hrows = ['date,open,high,low,close,volume'];
      for (const q of h.quotes) {
        hrows.push(csvRow([
          q.date?.toISOString?.().slice(0, 10) ?? q.date,
          q.open, q.high, q.low, q.close, q.volume,
        ]));
      }
      const fname = t.replace(/[^A-Za-z0-9]/g, '') + '_history.csv';
      fs.writeFileSync(path.join(OUT, fname), hrows.join('\n'));
    } catch (e) {
      console.error(`[macro] ${t} err: ${e.message}`);
    }
  }
  return { count: macroQuotes.length };
}

// Step 2: universe quotes and price-band filter.
// Band restored to the documented $8–$100 (docs/options_trading_system.md
// universe filter). It had drifted to $8–$40, which structurally emptied the
// put side under the 2x ATR + delta 0.15–0.20 rules: the tier-1 names those
// rules were designed around (F, GM, HOOD, PINS in the manual-era baskets)
// mostly trade $40–$100. Filename kept for resume-logic compatibility.
const PRICE_MIN = 8;
const PRICE_MAX = 100;
export async function runUniverseQuotes(OUT, { client = yf, now = new Date(), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const unifile = path.join(OUT, 'weeklys_universe.csv');
  if (!fs.existsSync(unifile)) throw new Error(`missing ${unifile}`);
  const clean = [...new Set(fs.readFileSync(unifile, 'utf8').trim().split(/\r?\n/).slice(1)
    .filter((t) => /^[A-Z]{1,5}$/.test(t)))];
  if (!clean.length) throw new Error('Weekly universe is empty');
  const stateFile = path.join(OUT, 'universe_quote_state.json');
  let cached = {}, quarantine = {};
  try { const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); cached = state.quotes ?? {}; quarantine = state.quarantine ?? {}; } catch { /* first run */ }
  const valid = record => record && easternTime(new Date(record.marketTime)).date === easternTime(now).date && +now - Date.parse(record.fetchedAt) >= 0 && +now - Date.parse(record.fetchedAt) < 2 * 3600000;
  cached = Object.fromEntries(Object.entries(cached).filter(([ticker, record]) => clean.includes(ticker) && Number.isFinite(Date.parse(record?.marketTime)) && valid(record)));
  quarantine = Object.fromEntries(Object.entries(quarantine).filter(([ticker, record]) => clean.includes(ticker) && +now - Date.parse(record.checked_at) >= 0 && +now - Date.parse(record.checked_at) < 2 * 3600000));
  const rows = [
    'ticker,price,currency,exchange,market_cap,avg_volume,shares_outstanding,prev_close,fifty_two_wk_high,fifty_two_wk_low,eps_fwd,pe_fwd,name',
  ];
  const errs = [];
  const batchSize = 50;
  const recordQuote = q => {
    if (!q || !clean.includes(q.symbol)) return;
    const price = q.marketState === 'PRE' ? q.preMarketPrice ?? q.regularMarketPrice : q.regularMarketPrice;
    if (!Number.isFinite(price) || price <= 0 || !q.regularMarketTime || !Number.isFinite(+new Date(q.regularMarketTime)) || easternTime(new Date(q.regularMarketTime)).date !== easternTime(now).date) {
      quarantine[q.symbol] = { reason: 'Yahoo returned no usable current-session quote', checked_at: now.toISOString() };
      return;
    }
    cached[q.symbol] = { marketTime: new Date(q.regularMarketTime).toISOString(), fetchedAt: now.toISOString(), row: csvRow([
      q.symbol, price, q.currency, q.fullExchangeName, q.marketCap,
      q.averageDailyVolume10Day ?? q.averageDailyVolume3Month,
      q.sharesOutstanding, q.regularMarketPreviousClose,
      q.fiftyTwoWeekHigh, q.fiftyTwoWeekLow, q.epsForward, q.forwardPE,
      q.longName ?? q.shortName,
    ]) };
  };
  const missing = clean.filter(ticker => !cached[ticker] && !quarantine[ticker]);
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    try {
      const quotes = await client.quote(batch);
      for (const q of quotes) recordQuote(q);
      for (const ticker of batch) if (!cached[ticker] && !quarantine[ticker]) {
        try {
          // A missing batch member is not proof of delisting. Require an
          // explicit per-symbol not-found response before quarantining it.
          recordQuote(await client.quote(ticker));
          if (!cached[ticker] && !quarantine[ticker]) errs.push({ ticker, err: 'Quote omitted from batch; retry required' });
        } catch (error) {
          if (error.name === 'NotFoundError' || /quote not found|no quote found|no data found.*delisted/i.test(error.message)) quarantine[ticker] = { reason: error.message, checked_at: now.toISOString() };
          else errs.push({ ticker, err: error.message });
        }
      }
    } catch (e) {
      for (const ticker of batch) errs.push({ ticker, err: e.message });
    }
    fs.writeFileSync(stateFile, JSON.stringify({ quotes: cached, quarantine, errors: errs }, null, 2));
    await sleep(250);
  }
  for (const ticker of clean) if (cached[ticker]) rows.push(cached[ticker].row);
  fs.writeFileSync(path.join(OUT, 'universe_quotes.csv'), rows.join('\n'));
  fs.writeFileSync(path.join(OUT, 'universe_quote_errors.json'), JSON.stringify(errs, null, 2));

  const header = rows[0].split(',');
  const priceIdx = header.indexOf('price');
  const filtered = [rows[0]];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(',');
    const p = parseFloat(cells[priceIdx]);
    if (Number.isFinite(p) && p >= PRICE_MIN && p <= PRICE_MAX) filtered.push(rows[i]);
  }
  fs.writeFileSync(path.join(OUT, 'universe_8to40.csv'), filtered.join('\n'));
  const result = { expected: clean.length, done: Object.keys(cached).length, errors: errs.length, quarantined: Object.keys(quarantine).length, filtered: filtered.length - 1 };
  fs.writeFileSync(path.join(OUT, 'universe_quote_quality.json'), JSON.stringify({ ...result, quarantine, checked_at: now.toISOString() }, null, 2));
  // Keep the Cboe denominator, including unavailable names. Transient failures
  // retry; at most 5% explicitly unusable names may be quarantined for this cohort.
  if (errs.length || result.done < result.expected * 0.95) throw new Error(`Universe quote import incomplete: ${result.done}/${result.expected}; saved successful quotes and will retry missing tickers`);
  return result;
}

// Step 3: option chains + IV summary (resumable via _chains_state.json).
async function runChains(OUT, EXPIRY_ISO, { chunkLimit = 999999 } = {}) {
  const universeFile = path.join(OUT, 'universe_8to40.csv');
  if (!fs.existsSync(universeFile)) throw new Error(`missing ${universeFile}`);
  const lines = fs.readFileSync(universeFile, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  const tIdx = header.indexOf('ticker');
  const pIdx = header.indexOf('price');
  const allTickers = lines.slice(1).map((l) => {
    const c = l.split(','); return { ticker: c[tIdx], price: parseFloat(c[pIdx]) };
  }).filter((t) => t.ticker && Number.isFinite(t.price));

  const stateFile = path.join(OUT, '_chains_state.json');
  let state = { done: [], errors: [] };
  if (fs.existsSync(stateFile)) state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  // A refreshed primary universe can remove old symbols. They must not inflate
  // chain coverage for the currently eligible, price-filtered universe.
  const expected = new Set(allTickers.map(row => row.ticker));
  state.done = [...new Set(state.done)].filter(ticker => expected.has(ticker));
  const doneSet = new Set(state.done);
  // Errors are retried on the next run, never counted as completed.
  state.errors = [];

  const chainsFile = path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`);
  const summaryFile = path.join(OUT, 'chain_summary_v2.csv');
  const CHAIN_HEADER = 'ticker,strike,type,bid,ask,last,iv,volume,oi,delta_est,distance_pct';
  const SUMMARY_HEADER = 'ticker,price,atm_iv,atm_iv_pct,hv20_now,hv20_min,hv20_max,hv_rank,atr14,call_otm_vol_total,put_otm_vol_total,best_call_strike_d18,best_call_credit,best_call_iv,best_put_strike_d18,best_put_credit,best_put_iv,mom1d_pct,mom3d_pct,mom10d_pct';
  if (!fs.existsSync(chainsFile)) fs.writeFileSync(chainsFile, CHAIN_HEADER + '\n');
  if (!fs.existsSync(summaryFile)) fs.writeFileSync(summaryFile, SUMMARY_HEADER + '\n');

  const now = new Date();
  const histStart = new Date(now.getTime() - 365 * 86400 * 1000);
  const expiryDate = new Date(EXPIRY_ISO + 'T00:00:00Z');
  const T = Math.max((sessionClose(EXPIRY_ISO).getTime() - now.getTime()) / (365 * 86400 * 1000), 1 / (365 * 24));
  const r = 0.043;

  const remaining = allTickers.filter((t) => !doneSet.has(t.ticker));
  const work = remaining.slice(0, chunkLimit);
  let processed = 0;
  for (const { ticker, price } of work) {
    try {
      const hist = await yf.chart(ticker, { period1: histStart, period2: now, interval: '1d' });
      const closes = hist.quotes.map((q) => q.close).filter((c) => c != null && c > 0);
      const ohlc = hist.quotes.filter((q) => q.high != null && q.low != null && q.close != null)
        .map((q) => ({ high: q.high, low: q.low, close: q.close }));
      const hv20Series = rollingRV(closes, 20);
      const hv20Now = realizedVol(closes, 20);
      const rank = hvRank(hv20Series, hv20Now);
      const atr = atr14(ohlc);

      // Pre-entry thrust (frenzy-guard inputs). Every ITM call loss through
      // 2026-07-20 entered right after a violent up-move; see
      // docs/trade_autopsy_2026-05-11.md.
      const momPct = (w) =>
        closes.length > w && closes.at(-1 - w) > 0
          ? ((closes.at(-1) / closes.at(-1 - w) - 1) * 100)
          : null;
      const mom1d = momPct(1), mom3d = momPct(3), mom10d = momPct(10);

      const chain = await yf.options(ticker, { date: expiryDate });
      const expiryChain = chain?.options?.find(o => new Date(o.expirationDate).toISOString().slice(0, 10) === EXPIRY_ISO);
      if (!expiryChain) throw new Error('Requested expiry unavailable; refusing a different contract date');
      const calls = expiryChain.calls ?? [];
      const puts = expiryChain.puts ?? [];

      let atmSum = 0, atmN = 0, bestCall = null, bestPut = null, cVol = 0, pVol = 0;
      const chainOut = [];
      for (const c of calls) {
        const iv = c.impliedVolatility;
        const delta = iv ? bsDelta(price, c.strike, T, r, iv, 'call') : null;
        const dist = ((c.strike - price) / price) * 100;
        const mid = c.bid != null && c.ask != null ? (c.bid + c.ask) / 2 : c.lastPrice ?? null;
        chainOut.push(csvRow([ticker, c.strike, 'call', c.bid, c.ask, c.lastPrice, iv, c.volume, c.openInterest, delta?.toFixed(3), dist.toFixed(2)]));
        if (Math.abs(c.strike - price) / price < 0.03 && iv) { atmSum += iv; atmN++; }
        if (c.strike > price) cVol += c.volume ?? 0;
        if (delta != null && delta >= 0.13 && delta <= 0.22 && mid != null && mid > 0.01 && c.bid != null && c.bid > 0) {
          if (!bestCall || Math.abs(delta - 0.18) < Math.abs(bestCall.delta - 0.18)) bestCall = { strike: c.strike, mid, iv, delta };
        }
      }
      for (const p of puts) {
        const iv = p.impliedVolatility;
        const delta = iv ? bsDelta(price, p.strike, T, r, iv, 'put') : null;
        const dist = ((p.strike - price) / price) * 100;
        const mid = p.bid != null && p.ask != null ? (p.bid + p.ask) / 2 : p.lastPrice ?? null;
        chainOut.push(csvRow([ticker, p.strike, 'put', p.bid, p.ask, p.lastPrice, iv, p.volume, p.openInterest, delta?.toFixed(3), dist.toFixed(2)]));
        if (Math.abs(p.strike - price) / price < 0.03 && iv) { atmSum += iv; atmN++; }
        if (p.strike < price) pVol += p.volume ?? 0;
        if (delta != null && delta <= -0.13 && delta >= -0.22 && mid != null && mid > 0.01 && p.bid != null && p.bid > 0) {
          if (!bestPut || Math.abs(Math.abs(delta) - 0.18) < Math.abs(Math.abs(bestPut.delta) - 0.18)) bestPut = { strike: p.strike, mid, iv, delta };
        }
      }
      const atmIv = atmN ? atmSum / atmN : null;
      fs.appendFileSync(chainsFile, chainOut.join('\n') + '\n');
      fs.appendFileSync(summaryFile, csvRow([
        ticker, price, atmIv?.toFixed(4), atmIv ? (atmIv * 100).toFixed(1) : null,
        hv20Now?.toFixed(4),
        hv20Series.length ? Math.min(...hv20Series).toFixed(4) : null,
        hv20Series.length ? Math.max(...hv20Series).toFixed(4) : null,
        rank?.toFixed(1), atr?.toFixed(3), cVol, pVol,
        bestCall?.strike, bestCall?.mid?.toFixed(3), bestCall?.iv?.toFixed(4),
        bestPut?.strike, bestPut?.mid?.toFixed(3), bestPut?.iv?.toFixed(4),
        mom1d?.toFixed(1), mom3d?.toFixed(1), mom10d?.toFixed(1),
      ]) + '\n');
      state.done.push(ticker);
      doneSet.add(ticker);
      processed++;
    } catch (e) {
      state.errors.push({ ticker, err: e.message });
    }
    if (processed % 10 === 0) fs.writeFileSync(stateFile, JSON.stringify(state));
    await new Promise((r) => setTimeout(r, 80));
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
  return { total: allTickers.length, done: state.done.length, errors: state.errors.length, processed };
}

export async function runRefresh({ OUT, EXPIRY_ISO, chunkLimit, force = false }) {
  const manifestFile = path.join(OUT, 'data_refresh.json');
  let manifest = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* first run */ }
  const age = Date.now() - new Date(manifest.started_at).getTime();
  if (force || !Number.isFinite(age) || age < 0 || age > 2 * 3600000 || manifest.expiry !== EXPIRY_ISO) {
    // Preserve previous source artifacts before creating a coherent fresh run.
    const archive = path.join(OUT, 'refresh_history', new Date().toISOString().replaceAll(':', '-'));
    fs.mkdirSync(archive, { recursive: true });
    for (const file of ['universe_quotes.csv', 'universe_8to40.csv', 'universe_quote_state.json', 'universe_quote_errors.json', 'universe_quote_quality.json', '_chains_state.json', `chains_${EXPIRY_ISO}_v2.csv`, 'chain_summary_v2.csv', 'data_refresh.json']) {
      const old = path.join(OUT, file);
      if (fs.existsSync(old)) fs.renameSync(old, path.join(archive, file));
    }
    manifest = { started_at: new Date().toISOString(), expiry: EXPIRY_ISO };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  }
  const stepMacro = await runMacro(OUT);
  const stepQ = await runUniverseQuotes(OUT);
  const stepChains = await runChains(OUT, EXPIRY_ISO, { chunkLimit });
  manifest.completed_at = new Date().toISOString();
  manifest.chains = stepChains;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  if (!stepChains.total || stepChains.done < stepChains.total * 0.95 || stepChains.processed >= (chunkLimit ?? Infinity) && stepChains.done < stepChains.total) throw new Error('Incomplete chain coverage; saved progress for retry');
  return { macro: stepMacro, universe: stepQ, chains: stepChains };
}
