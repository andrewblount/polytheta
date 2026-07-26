// Rescreen candidates with two strict rules:
//   (1) bid > 0 — no phantom Yahoo asks. credit = bid (conservative, tradable).
//   (2) Earnings blackout — ticker is INELIGIBLE if its next earnings release
//       falls anywhere in [2026-04-20, 2026-04-24] inclusive.
//
// Reads existing Yahoo chain + summary + TradingView earnings dates.
// Cross-verifies earnings against Yahoo quoteSummary.calendarEvents for any
// ticker making it past the other gates.
//
// Writes:
//   baskets/2026-04-20/data/shortlist_calls_refined_v3.csv
//   baskets/2026-04-20/data/shortlist_puts_refined_v3.csv
//   baskets/2026-04-20/data/rescreen_exclusions.csv
//   baskets/2026-04-20/data/rescreen_basket_proposal.json

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import YahooFinance from 'yahoo-finance2';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'baskets/2026-04-20/data');
const TV_CSV_DIR = path.join(ROOT, 'data_trading_view');

const SALE_DATE = new Date('2026-04-20T00:00:00Z');
const EXPIRY_DATE = new Date('2026-04-24T23:59:59Z');
const EXPIRY_STR = '2026-04-24';

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

// --- csv helpers -------------------------------------------------------------
function readCsv(p) {
  const raw = fs.readFileSync(p, 'utf8').trim();
  const lines = raw.split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });
}
function splitCsvLine(l) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (inQ) {
      if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
  }
  cells.push(cur);
  return cells;
}
function writeCsv(p, rows, cols) {
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(','));
  fs.writeFileSync(p, lines.join('\n'));
}

// --- load existing data ------------------------------------------------------
const chains  = readCsv(path.join(DATA, 'chains_2026-04-24_v2.csv'));
const summary = readCsv(path.join(DATA, 'chain_summary_v2.csv'));
const quotes  = readCsv(path.join(DATA, 'universe_quotes.csv'));
const qByT = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

// Parse numeric columns in summary / quotes
for (const r of summary) {
  r.price = parseFloat(r.price);
  r.atm_iv = r.atm_iv ? parseFloat(r.atm_iv) : null;
  r.atm_iv_pct = r.atm_iv_pct ? parseFloat(r.atm_iv_pct) : null;
  r.hv_rank = r.hv_rank ? parseFloat(r.hv_rank) : null;
  r.atr14 = r.atr14 ? parseFloat(r.atr14) : null;
  r.call_otm_vol_total = parseInt(r.call_otm_vol_total || '0', 10);
  r.put_otm_vol_total  = parseInt(r.put_otm_vol_total  || '0', 10);
  const q = qByT[r.ticker] || {};
  r.avg_volume = parseInt(q.avg_volume || '0', 10);
  r.market_cap = parseFloat(q.market_cap || '0');
  r.name = q.name || r.ticker;
}

// Parse chain numerics
for (const c of chains) {
  c.strike = parseFloat(c.strike);
  c.bid = c.bid !== '' ? parseFloat(c.bid) : null;
  c.ask = c.ask !== '' ? parseFloat(c.ask) : null;
  c.last = c.last !== '' ? parseFloat(c.last) : null;
  c.iv = c.iv !== '' ? parseFloat(c.iv) : null;
  c.volume = parseInt(c.volume || '0', 10);
  c.oi = parseInt(c.oi || '0', 10);
  c.delta_est = c.delta_est !== '' ? parseFloat(c.delta_est) : null;
}

// --- earnings: load TradingView csv ------------------------------------------
const tvFiles = fs.readdirSync(TV_CSV_DIR).filter((f) => f.endsWith('_tradingview_weeklys.csv')).sort();
const tvPath = path.join(TV_CSV_DIR, tvFiles[tvFiles.length - 1]);
const tvRows = readCsv(tvPath);
// TV tickers are prefixed "EXCHANGE:TICKER"
const tvEarningsByT = {};
for (const r of tvRows) {
  const t = String(r.ticker || '').split(':')[1] || r.ticker;
  const ts = r.earnings_release_next_date ? parseFloat(r.earnings_release_next_date) : null;
  if (t && ts && !Number.isNaN(ts)) {
    tvEarningsByT[t] = new Date(ts * 1000);
  }
}
function tvEarningsInWindow(ticker) {
  const d = tvEarningsByT[ticker];
  if (!d) return null;
  return d >= SALE_DATE && d <= EXPIRY_DATE ? d : false;
}

// --- per-ticker best-strike picker (bid > 0) ---------------------------------
// Targets delta ~0.18, band 0.13-0.22, requires bid > 0 and minimum liquidity.
function pickBestStrike(ticker, type) {
  const rows = chains.filter((c) => c.ticker === ticker && c.type === type);
  if (!rows.length) return null;
  const targetDelta = 0.18;
  let best = null;
  for (const c of rows) {
    if (c.bid == null || c.bid <= 0) continue;        // hard bid>0
    if (c.iv == null || !Number.isFinite(c.iv)) continue;
    if (c.delta_est == null) continue;
    const d = Math.abs(c.delta_est);
    if (d < 0.13 || d > 0.22) continue;
    if (c.oi < 25 && c.volume < 25) continue;         // strike-level liquidity floor
    const score = Math.abs(d - targetDelta);
    if (!best || score < best.score) {
      best = {
        strike: c.strike, bid: c.bid, ask: c.ask, last: c.last,
        iv: c.iv, delta: c.delta_est, volume: c.volume, oi: c.oi,
        score,
      };
    }
  }
  return best;
}

// --- main screening ----------------------------------------------------------
const ETF_TICKERS = new Set(['SCO','SOXS','TSLL','CONL','ETHU','ETHE','BITX','TQQQ','SQQQ','UVXY','SVXY','VXX','VIXY','TMF','TMV','TLT','HYG','JNK','SOXL','FAS','FAZ','LABU','LABD','TNA','TZA','YINN','YANG','SPXU','UPRO','BOIL','KOLD','GUSH','DRIP','NUGT','DUST','JNUG','JDST','ERX','ERY','DPST','WEBL','WEBS','CWEB','BITO','ETHA','FBTC','IBIT','ETHV']);
function isEtf(r) {
  if (ETF_TICKERS.has(r.ticker)) return true;
  const n = (r.name || '').toLowerCase();
  return (
    n.includes('etf') || n.includes('ultrashort') || n.includes('ultra pro') ||
    n.includes('proshares') || n.includes('direxion') || n.includes('graniteshares') ||
    n.includes('grayscale') || n.includes('2x ') || n.includes('3x ') ||
    n.includes('leveraged') || n.includes('strategy etf') || n.includes('staking etf') ||
    n.includes('bull') || n.includes('bear') || n.includes('futures etf')
  );
}

const MIN_AVG_VOL = 1_500_000;
const MIN_CREDIT = 0.10;
const MIN_ATR_BUF = 1.0;
const MIN_ATM_IV = 0.55;
const MIN_HV_RANK = 55;
const MIN_STRIKE_OTM_VOL = 300; // sum of OTM vol on that side
const highVol = (r) => (r.atm_iv ?? 0) >= MIN_ATM_IV || (r.hv_rank ?? 0) >= MIN_HV_RANK;

const exclusions = [];
const callCands = [];
const putCands  = [];

for (const r of summary) {
  const common = (
    r.ticker && r.price && !isEtf(r) && r.avg_volume >= MIN_AVG_VOL && highVol(r)
  );
  if (!common) continue;

  // Earnings blackout — TradingView first
  const tvEarn = tvEarningsInWindow(r.ticker);
  if (tvEarn && tvEarn !== null) {
    exclusions.push({ ticker: r.ticker, reason: 'earnings_in_window_tv', detail: tvEarn.toISOString().slice(0,10) });
    continue;
  }

  // Best-strike picks with bid>0
  const bestC = pickBestStrike(r.ticker, 'call');
  const bestP = pickBestStrike(r.ticker, 'put');

  if (bestC && bestC.bid >= MIN_CREDIT) {
    const atr_buf = r.atr14 ? (bestC.strike - r.price) / r.atr14 : null;
    if (atr_buf != null && atr_buf >= MIN_ATR_BUF && r.call_otm_vol_total >= MIN_STRIKE_OTM_VOL) {
      callCands.push({
        ticker: r.ticker, name: r.name, price: r.price,
        atm_iv_pct: r.atm_iv_pct, hv_rank: r.hv_rank, atr14: r.atr14,
        avg_volume: r.avg_volume, market_cap: r.market_cap,
        strike: bestC.strike, credit_bid: bestC.bid, ask: bestC.ask, last: bestC.last,
        iv: bestC.iv, delta: bestC.delta, strike_vol: bestC.volume, strike_oi: bestC.oi,
        atr_buf, otm_vol_total: r.call_otm_vol_total,
      });
    }
  }
  if (bestP && bestP.bid >= MIN_CREDIT) {
    const atr_buf = r.atr14 ? (r.price - bestP.strike) / r.atr14 : null;
    if (atr_buf != null && atr_buf >= MIN_ATR_BUF && r.put_otm_vol_total >= MIN_STRIKE_OTM_VOL) {
      putCands.push({
        ticker: r.ticker, name: r.name, price: r.price,
        atm_iv_pct: r.atm_iv_pct, hv_rank: r.hv_rank, atr14: r.atr14,
        avg_volume: r.avg_volume, market_cap: r.market_cap,
        strike: bestP.strike, credit_bid: bestP.bid, ask: bestP.ask, last: bestP.last,
        iv: bestP.iv, delta: bestP.delta, strike_vol: bestP.volume, strike_oi: bestP.oi,
        atr_buf, otm_vol_total: r.put_otm_vol_total,
      });
    }
  }
}

// --- Yahoo earnings cross-check on the survivors -----------------------------
// For each surviving ticker, pull calendarEvents. If earnings are in window, drop.
const allSurvivors = Array.from(new Set([...callCands.map(x=>x.ticker), ...putCands.map(x=>x.ticker)]));
console.log(`Yahoo earnings cross-check on ${allSurvivors.length} tickers...`);
const yahooEarnByT = {};
const CHUNK = 20;
for (let i = 0; i < allSurvivors.length; i += CHUNK) {
  const slice = allSurvivors.slice(i, i + CHUNK);
  await Promise.all(slice.map(async (t) => {
    try {
      const qs = await yf.quoteSummary(t, { modules: ['calendarEvents'] });
      const arr = qs?.calendarEvents?.earnings?.earningsDate || [];
      const firstFuture = arr.map((d) => new Date(d)).find((d) => d >= SALE_DATE);
      if (firstFuture) yahooEarnByT[t] = firstFuture;
    } catch (e) {
      // ignore — lack of data means TV result is definitive
    }
  }));
}

const callsFinal = [];
for (const c of callCands) {
  const d = yahooEarnByT[c.ticker];
  if (d && d >= SALE_DATE && d <= EXPIRY_DATE) {
    exclusions.push({ ticker: c.ticker, reason: 'earnings_in_window_yahoo', detail: d.toISOString().slice(0,10) });
    continue;
  }
  c.yahoo_next_earnings = d ? d.toISOString().slice(0,10) : '';
  callsFinal.push(c);
}
const putsFinal = [];
for (const p of putCands) {
  const d = yahooEarnByT[p.ticker];
  if (d && d >= SALE_DATE && d <= EXPIRY_DATE) {
    if (!exclusions.find((e) => e.ticker === p.ticker)) {
      exclusions.push({ ticker: p.ticker, reason: 'earnings_in_window_yahoo', detail: d.toISOString().slice(0,10) });
    }
    continue;
  }
  p.yahoo_next_earnings = d ? d.toISOString().slice(0,10) : '';
  putsFinal.push(p);
}

// Sort by credit_bid (desc) then IV
callsFinal.sort((a,b) => (b.credit_bid - a.credit_bid) || (b.iv - a.iv));
putsFinal.sort((a,b) => (b.credit_bid - a.credit_bid) || (b.iv - a.iv));

const cols = ['ticker','name','price','atm_iv_pct','hv_rank','atr14','avg_volume','market_cap',
  'strike','credit_bid','ask','last','iv','delta','strike_vol','strike_oi','atr_buf','otm_vol_total','yahoo_next_earnings'];
writeCsv(path.join(DATA, 'shortlist_calls_refined_v3.csv'), callsFinal, cols);
writeCsv(path.join(DATA, 'shortlist_puts_refined_v3.csv'), putsFinal, cols);
writeCsv(path.join(DATA, 'rescreen_exclusions.csv'), exclusions, ['ticker','reason','detail']);

// --- basket proposal: 4 calls + 4 puts ---------------------------------------
// Rules:
//  - Each ticker appears at most once across the whole basket; if a ticker
//    qualifies on both sides, assign it to the side with higher credit_bid.
//  - Sort by credit_bid (then IV) and take the top 4 remaining on each side.

function marginNakedRegT(spot, strike, type, credit) {
  const otm = type === 'call' ? strike - spot : spot - strike;
  const a = 0.20 * spot - Math.max(otm, 0);
  const b = 0.10 * strike;
  return (Math.max(a, b) + credit) * 100;
}

// Contract sizing: target 5% of $1M equity = $50,000 margin per leg.
function contractsForMargin(spot, strike, type, credit, targetMargin = 50_000) {
  const perContract = marginNakedRegT(spot, strike, type, credit);
  return Math.max(1, Math.round(targetMargin / perContract));
}

// Build a map of the best-side assignment for any ticker that appears on both.
const bothSides = new Map();
for (const c of callsFinal) {
  const p = putsFinal.find((x) => x.ticker === c.ticker);
  if (p) bothSides.set(c.ticker, c.credit_bid >= p.credit_bid ? 'call' : 'put');
}
const callPool = callsFinal.filter((c) => !bothSides.has(c.ticker) || bothSides.get(c.ticker) === 'call');
const putPool  = putsFinal.filter ((p) => !bothSides.has(p.ticker) || bothSides.get(p.ticker) === 'put');

const usedTickers = new Set();
const basketCalls = [];
for (const c of callPool) {
  if (usedTickers.has(c.ticker)) continue;
  basketCalls.push(c); usedTickers.add(c.ticker);
  if (basketCalls.length >= 4) break;
}
const basketPuts = [];
for (const p of putPool) {
  if (usedTickers.has(p.ticker)) continue;
  basketPuts.push(p); usedTickers.add(p.ticker);
  if (basketPuts.length >= 4) break;
}

let totCred = 0, totMargin = 0;
const basket = [];
for (const c of basketCalls) {
  const n = contractsForMargin(c.price, c.strike, 'call', c.credit_bid);
  const cr = c.credit_bid * 100 * n;
  const mg = marginNakedRegT(c.price, c.strike, 'call', c.credit_bid) * n;
  totCred += cr; totMargin += mg;
  basket.push({ side: 'call', ...c, contracts: n, leg_credit_usd: cr, leg_margin_usd: mg });
}
for (const p of basketPuts) {
  const n = contractsForMargin(p.price, p.strike, 'put', p.credit_bid);
  const cr = p.credit_bid * 100 * n;
  const mg = marginNakedRegT(p.price, p.strike, 'put', p.credit_bid) * n;
  totCred += cr; totMargin += mg;
  basket.push({ side: 'put', ...p, contracts: n, leg_credit_usd: cr, leg_margin_usd: mg });
}

const proposal = {
  run_ts: new Date().toISOString(),
  expiry: EXPIRY_STR,
  filters: {
    bid_gt_zero: true,
    credit_formula: 'bid',
    earnings_blackout_window: [SALE_DATE.toISOString().slice(0,10), EXPIRY_STR],
    min_credit: MIN_CREDIT, min_atr_buf: MIN_ATR_BUF, min_atm_iv: MIN_ATM_IV,
    min_hv_rank: MIN_HV_RANK, min_avg_vol: MIN_AVG_VOL, min_strike_otm_vol_side: MIN_STRIKE_OTM_VOL,
  },
  counts: {
    calls_refined_v3: callsFinal.length,
    puts_refined_v3: putsFinal.length,
    exclusions: exclusions.length,
  },
  totals: {
    total_credit_usd: Math.round(totCred),
    total_margin_usd: Math.round(totMargin),
    margin_pct_of_1M: +(totMargin / 1_000_000 * 100).toFixed(1),
    max_profit_weekly_pct_on_1M: +(totCred / 1_000_000 * 100).toFixed(2),
  },
  basket,
  exclusions,
};
fs.writeFileSync(path.join(DATA, 'rescreen_basket_proposal.json'), JSON.stringify(proposal, null, 2));

// --- print summary -----------------------------------------------------------
console.log(`\nV3 CALLS (${callsFinal.length}): top 15`);
console.log('TKR    PX     K     BID    ASK    DELT  IV%  ATRb  EARN');
for (const c of callsFinal.slice(0,15)) {
  console.log([
    c.ticker.padEnd(6), c.price.toFixed(2).padStart(6), c.strike.toFixed(1).padStart(5),
    c.credit_bid.toFixed(2).padStart(4), (c.ask??0).toFixed(2).padStart(4),
    c.delta.toFixed(3).padStart(5), (c.iv*100).toFixed(0).padStart(3),
    c.atr_buf.toFixed(1).padStart(4), (c.yahoo_next_earnings||'').padStart(10),
  ].join('  '));
}

console.log(`\nV3 PUTS (${putsFinal.length}): top 15`);
console.log('TKR    PX     K     BID    ASK    DELT  IV%  ATRb  EARN');
for (const p of putsFinal.slice(0,15)) {
  console.log([
    p.ticker.padEnd(6), p.price.toFixed(2).padStart(6), p.strike.toFixed(1).padStart(5),
    p.credit_bid.toFixed(2).padStart(4), (p.ask??0).toFixed(2).padStart(4),
    p.delta.toFixed(3).padStart(5), (p.iv*100).toFixed(0).padStart(3),
    p.atr_buf.toFixed(1).padStart(4), (p.yahoo_next_earnings||'').padStart(10),
  ].join('  '));
}

console.log(`\nEXCLUSIONS (${exclusions.length}):`);
for (const e of exclusions) console.log(`  ${e.ticker.padEnd(6)}  ${e.reason}  ${e.detail || ''}`);

console.log('\nBASKET PROPOSAL (top 4 each side, bid-based credits):');
console.log('SIDE  TKR    K      BID    N    LEG_CR    LEG_MG    IV%  ATRb  EARN');
for (const l of basket) {
  console.log([
    l.side.toUpperCase().padEnd(5), l.ticker.padEnd(6),
    l.strike.toFixed(1).padStart(5),
    l.credit_bid.toFixed(2).padStart(4),
    String(l.contracts).padStart(4),
    `$${Math.round(l.leg_credit_usd).toLocaleString()}`.padStart(8),
    `$${Math.round(l.leg_margin_usd).toLocaleString()}`.padStart(9),
    (l.iv*100).toFixed(0).padStart(3),
    l.atr_buf.toFixed(1).padStart(4),
    (l.yahoo_next_earnings||'').padStart(10),
  ].join('  '));
}
console.log(`\nTOTAL credit: $${Math.round(totCred).toLocaleString()}`);
console.log(`TOTAL margin: $${Math.round(totMargin).toLocaleString()} (${(totMargin/1_000_000*100).toFixed(1)}% of $1M)`);
console.log(`If all expire worthless: +${(totCred/1_000_000*100).toFixed(2)}% weekly on $1M`);
