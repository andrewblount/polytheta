// Re-pick strikes using LIVE Monday 2026-04-20 Yahoo quotes for the top v3 candidates.
// Rules (same as rescreen):
//   - bid > 0
//   - delta |d| in [0.13, 0.22]
//   - strike-level liquidity (OI>=25 or vol>=25)
//   - credit_bid >= 0.10
//   - ATR-buffer >= 1.0× (using summary ATR14)
//   - Earnings outside [2026-04-20, 2026-04-24]
// Then produce a new 4-call + 4-put basket (unique tickers, best side wins ties).

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import YahooFinance from 'yahoo-finance2';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'baskets/2026-04-20/data');

const SALE_DATE = new Date('2026-04-20T00:00:00Z');
const EXPIRY_DATE = new Date('2026-04-24T23:59:59Z');
const EXPIRY_STR = '2026-04-24';

const yf = new YahooFinance({
  validation: { logErrors: false, logOptionsErrors: false },
  suppressNotices: ['yahooSurvey'],
});

// ---- csv helpers ----
function splitCsvLine(l){const c=[];let cur='',inQ=false;for(let i=0;i<l.length;i++){const ch=l[i];if(inQ){if(ch==='"'&&l[i+1]==='"'){cur+='"';i++;}else if(ch==='"')inQ=false;else cur+=ch;}else{if(ch==='"')inQ=true;else if(ch===','){c.push(cur);cur='';}else cur+=ch;}}c.push(cur);return c;}
function readCsv(p){const l=fs.readFileSync(p,'utf8').trim().split(/\r?\n/);const h=splitCsvLine(l[0]);return l.slice(1).map(x=>{const c=splitCsvLine(x);const o={};h.forEach((k,i)=>o[k]=c[i]);return o;});}
function writeCsv(p,rows,cols){const esc=v=>{if(v==null)return'';const s=String(v);return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};const o=[cols.join(',')];for(const r of rows)o.push(cols.map(c=>esc(r[c])).join(','));fs.writeFileSync(p,o.join('\n'));}

// Load top v3 candidates (already filtered by ATR/IV/HV/Vol/ETF on Friday data)
const callsV3 = readCsv(path.join(DATA, 'shortlist_calls_refined_v3.csv'));
const putsV3  = readCsv(path.join(DATA, 'shortlist_puts_refined_v3.csv'));
const summary = readCsv(path.join(DATA, 'chain_summary_v2.csv'));
const summaryByT = Object.fromEntries(summary.map((s) => [s.ticker, s]));

// Also take top bid>0-qualifying names from summary (bid>0 might add names)
// For now: union of top 25 in each v3 list.
const TOP_N = 25;
const candidates = Array.from(new Set([
  ...callsV3.slice(0, TOP_N).map((r) => r.ticker),
  ...putsV3.slice(0, TOP_N).map((r) => r.ticker),
]));
console.log(`Re-pulling live chains for ${candidates.length} tickers...`);

// Fetch live chains in parallel chunks
const expiryDate = new Date('2026-04-24T00:00:00Z');
const chainByT = {};
const quoteByT = {};
const CHUNK = 10;
for (let i = 0; i < candidates.length; i += CHUNK) {
  const slice = candidates.slice(i, i + CHUNK);
  await Promise.all(slice.map(async (t) => {
    try {
      const [q, ch] = await Promise.all([
        yf.quote(t),
        yf.options(t, { date: expiryDate }),
      ]);
      quoteByT[t] = q;
      chainByT[t] = ch;
    } catch (e) {
      console.log(`${t} fetch err: ${e.message}`);
    }
  }));
}
console.log(`Fetched ${Object.keys(chainByT).length} live chains.`);

// Approx delta using Black-Scholes with IV + days-to-expiry + spot
function bsDelta(spot, k, iv, days, isCall) {
  if (!spot || !k || !iv || iv <= 0 || !days || days <= 0) return null;
  const t = days / 365;
  const r = 0.04;
  const d1 = (Math.log(spot / k) + (r + 0.5 * iv * iv) * t) / (iv * Math.sqrt(t));
  const N = (x) => 0.5 * (1 + erf(x / Math.SQRT2));
  return isCall ? N(d1) : N(d1) - 1;
}
function erf(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1/(1+p*x);
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return sign*y;
}

// Monday EOD-ish days-to-expiry for 24APR26: 04-20 to 04-24 ≈ 4 days
const DTE = 4;

function pickLive(ticker, type) {
  const ch = chainByT[ticker]; if (!ch) return null;
  const q = quoteByT[ticker]; if (!q) return null;
  const spot = q.regularMarketPrice;
  const summ = summaryByT[ticker];
  const atr = summ ? parseFloat(summ.atr14 || '0') : null;
  const rows = type === 'call' ? ch.options[0].calls : ch.options[0].puts;
  let best = null;
  for (const c of rows) {
    const bid = c.bid, ask = c.ask;
    if (bid == null || bid <= 0) continue;
    const iv = c.impliedVolatility; if (!iv || iv <= 0) continue;
    const d = bsDelta(spot, c.strike, iv, DTE, type === 'call');
    if (d == null) continue;
    const absD = Math.abs(d);
    if (absD < 0.13 || absD > 0.22) continue;
    const vol = c.volume ?? 0, oi = c.openInterest ?? 0;
    if (oi < 25 && vol < 25) continue;
    // ATR buffer
    const otm = type === 'call' ? c.strike - spot : spot - c.strike;
    const atr_buf = atr ? otm / atr : null;
    if (atr_buf == null || atr_buf < 1.0) continue;
    if (bid < 0.10) continue;
    const score = Math.abs(absD - 0.18);
    if (!best || score < best.score) {
      best = { ticker, side: type, spot, strike: c.strike, bid, ask, last: c.lastPrice, iv, delta: d, vol, oi, atr14: atr, atr_buf, score };
    }
  }
  return best;
}

// Pull earnings dates for all candidates
const earningsByT = {};
console.log('Pulling earnings dates for all candidates...');
for (let i = 0; i < candidates.length; i += CHUNK) {
  const slice = candidates.slice(i, i + CHUNK);
  await Promise.all(slice.map(async (t) => {
    try {
      const qs = await yf.quoteSummary(t, { modules: ['calendarEvents'] });
      const arr = (qs?.calendarEvents?.earnings?.earningsDate || []).map((d) => new Date(d));
      const future = arr.find((d) => d >= SALE_DATE);
      if (future) earningsByT[t] = future;
    } catch (e) {}
  }));
}

// Screen
const liveCalls = [];
const livePuts = [];
const excluded = [];
for (const t of candidates) {
  const ed = earningsByT[t];
  if (ed && ed >= SALE_DATE && ed <= EXPIRY_DATE) {
    excluded.push({ ticker: t, reason: 'earnings_in_window', detail: ed.toISOString().slice(0,10) });
    continue;
  }
  const c = pickLive(t, 'call'); if (c) liveCalls.push({ ...c, yahoo_next_earnings: ed ? ed.toISOString().slice(0,10) : '' });
  const p = pickLive(t, 'put');  if (p) livePuts.push({ ...p, yahoo_next_earnings: ed ? ed.toISOString().slice(0,10) : '' });
}

liveCalls.sort((a,b) => (b.bid - a.bid) || (b.iv - a.iv));
livePuts.sort((a,b) => (b.bid - a.bid) || (b.iv - a.iv));

// Ticker allocation: if present both sides, assign to higher-bid side
const bothSides = new Map();
for (const c of liveCalls) {
  const p = livePuts.find((x) => x.ticker === c.ticker);
  if (p) bothSides.set(c.ticker, c.bid >= p.bid ? 'call' : 'put');
}
const callPool = liveCalls.filter((c) => !bothSides.has(c.ticker) || bothSides.get(c.ticker) === 'call');
const putPool  = livePuts.filter ((p) => !bothSides.has(p.ticker) || bothSides.get(p.ticker) === 'put');

const used = new Set();
const basketCalls = [];
for (const c of callPool) { if (used.has(c.ticker)) continue; basketCalls.push(c); used.add(c.ticker); if (basketCalls.length >= 4) break; }
const basketPuts = [];
for (const p of putPool)  { if (used.has(p.ticker)) continue; basketPuts.push(p); used.add(p.ticker); if (basketPuts.length >= 4) break; }

function marginRegT(spot, strike, type, credit) {
  const otm = type === 'call' ? strike - spot : spot - strike;
  const a = 0.20 * spot - Math.max(otm, 0);
  const b = 0.10 * strike;
  return (Math.max(a, b) + credit) * 100;
}
function contractsForMargin(spot, strike, type, credit, target=50_000) {
  return Math.max(1, Math.round(target / marginRegT(spot, strike, type, credit)));
}

let totCred = 0, totMargin = 0;
const basket = [];
for (const c of [...basketCalls, ...basketPuts]) {
  const n = contractsForMargin(c.spot, c.strike, c.side, c.bid);
  const cr = c.bid * 100 * n;
  const mg = marginRegT(c.spot, c.strike, c.side, c.bid) * n;
  totCred += cr; totMargin += mg;
  basket.push({ ...c, contracts: n, leg_credit_usd: cr, leg_margin_usd: mg });
}

// Outputs
const cols = ['ticker','side','spot','strike','bid','ask','last','iv','delta','vol','oi','atr14','atr_buf','yahoo_next_earnings'];
writeCsv(path.join(DATA, 'shortlist_calls_live_monday.csv'), liveCalls, cols);
writeCsv(path.join(DATA, 'shortlist_puts_live_monday.csv'),  livePuts,  cols);
writeCsv(path.join(DATA, 'rescreen_live_exclusions.csv'), excluded, ['ticker','reason','detail']);

fs.writeFileSync(path.join(DATA, 'rescreen_live_basket_proposal.json'), JSON.stringify({
  run_ts: new Date().toISOString(),
  data_source: 'Yahoo live, Monday 2026-04-20',
  expiry: EXPIRY_STR,
  totals: {
    total_credit_usd: Math.round(totCred),
    total_margin_usd: Math.round(totMargin),
    margin_pct_of_1M: +(totMargin/1_000_000*100).toFixed(1),
    max_profit_weekly_pct_on_1M: +(totCred/1_000_000*100).toFixed(2),
  },
  basket, excluded,
}, null, 2));

console.log(`\nLIVE CALLS (${liveCalls.length}): top 15`);
console.log('TKR     SPOT   K     BID    ASK    DELT    IV%  ATRb  VOL   OI    EARN');
for (const c of liveCalls.slice(0,15)) console.log([
  c.ticker.padEnd(6), c.spot.toFixed(2).padStart(6), c.strike.toFixed(1).padStart(5),
  c.bid.toFixed(2).padStart(4), (c.ask??0).toFixed(2).padStart(4),
  c.delta.toFixed(3).padStart(6), (c.iv*100).toFixed(0).padStart(3),
  c.atr_buf.toFixed(1).padStart(4), String(c.vol).padStart(4), String(c.oi).padStart(4),
  (c.yahoo_next_earnings||'').padStart(10),
].join('  '));

console.log(`\nLIVE PUTS (${livePuts.length}): top 15`);
console.log('TKR     SPOT   K     BID    ASK    DELT    IV%  ATRb  VOL   OI    EARN');
for (const c of livePuts.slice(0,15)) console.log([
  c.ticker.padEnd(6), c.spot.toFixed(2).padStart(6), c.strike.toFixed(1).padStart(5),
  c.bid.toFixed(2).padStart(4), (c.ask??0).toFixed(2).padStart(4),
  c.delta.toFixed(3).padStart(6), (c.iv*100).toFixed(0).padStart(3),
  c.atr_buf.toFixed(1).padStart(4), String(c.vol).padStart(4), String(c.oi).padStart(4),
  (c.yahoo_next_earnings||'').padStart(10),
].join('  '));

console.log(`\nEXCLUDED (${excluded.length}):`);
for (const e of excluded) console.log(`  ${e.ticker.padEnd(6)}  ${e.reason}  ${e.detail || ''}`);

console.log('\nLIVE BASKET (4 calls + 4 puts, bid-based credits, ~5% margin/leg):');
console.log('SIDE  TKR    SPOT   K     BID    N    LEG_CR    LEG_MG    DELT    IV%  ATRb');
for (const l of basket) console.log([
  l.side.toUpperCase().padEnd(5), l.ticker.padEnd(6),
  l.spot.toFixed(2).padStart(6), l.strike.toFixed(1).padStart(5),
  l.bid.toFixed(2).padStart(4), String(l.contracts).padStart(4),
  `$${Math.round(l.leg_credit_usd).toLocaleString()}`.padStart(8),
  `$${Math.round(l.leg_margin_usd).toLocaleString()}`.padStart(9),
  l.delta.toFixed(3).padStart(6), (l.iv*100).toFixed(0).padStart(3),
  l.atr_buf.toFixed(1).padStart(4),
].join('  '));
console.log(`\nTOTAL credit: $${Math.round(totCred).toLocaleString()}`);
console.log(`TOTAL margin: $${Math.round(totMargin).toLocaleString()} (${(totMargin/1_000_000*100).toFixed(1)}% of $1M)`);
console.log(`If all expire worthless: +${(totCred/1_000_000*100).toFixed(2)}% weekly on $1M`);
