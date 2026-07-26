import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const OUT = path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data');

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    // naive split – no embedded commas in our data
    const cells = l.split(',');
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
}

const summary = readCsv(path.join(OUT, 'chain_summary_v2.csv'));
const quotes = readCsv(path.join(OUT, 'universe_quotes.csv'));
const qByT = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

// Parse numerics
for (const r of summary) {
  r.price = parseFloat(r.price);
  r.atm_iv = r.atm_iv ? parseFloat(r.atm_iv) : null;
  r.atm_iv_pct = r.atm_iv_pct ? parseFloat(r.atm_iv_pct) : null;
  r.hv20_now = r.hv20_now ? parseFloat(r.hv20_now) : null;
  r.hv_rank = r.hv_rank ? parseFloat(r.hv_rank) : null;
  r.atr14 = r.atr14 ? parseFloat(r.atr14) : null;
  r.call_otm_vol_total = parseInt(r.call_otm_vol_total || '0', 10);
  r.put_otm_vol_total = parseInt(r.put_otm_vol_total || '0', 10);
  r.best_call_strike = r.best_call_strike_d18 ? parseFloat(r.best_call_strike_d18) : null;
  r.best_call_credit = r.best_call_credit ? parseFloat(r.best_call_credit) : null;
  r.best_call_iv = r.best_call_iv ? parseFloat(r.best_call_iv) : null;
  r.best_put_strike = r.best_put_strike_d18 ? parseFloat(r.best_put_strike_d18) : null;
  r.best_put_credit = r.best_put_credit ? parseFloat(r.best_put_credit) : null;
  r.best_put_iv = r.best_put_iv ? parseFloat(r.best_put_iv) : null;
}

// Liquidity floor via underlying avg volume
for (const r of summary) {
  const q = qByT[r.ticker];
  r.avg_volume = q ? parseInt(q.avg_volume || '0', 10) : 0;
  r.market_cap = q ? parseFloat(q.market_cap || '0') : 0;
  r.name = q ? q.name : r.ticker;
}

// Filter: high IV (atm_iv>=55%) AND liquid
const MIN_ATM_IV = 0.55;  // lowered from 0.70 to expand set
const MIN_HV_RANK = 60;   // alt path
const MIN_AVG_VOL = 1_500_000;
const MIN_OPT_VOL = 100;  // min OTM option volume on the side we're trading

const callCandidates = summary.filter((r) =>
  r.best_call_strike && r.best_call_credit >= 0.05 &&
  r.avg_volume >= MIN_AVG_VOL &&
  ((r.atm_iv ?? 0) >= MIN_ATM_IV || (r.hv_rank ?? 0) >= MIN_HV_RANK) &&
  r.call_otm_vol_total >= MIN_OPT_VOL
);

const putCandidates = summary.filter((r) =>
  r.best_put_strike && r.best_put_credit >= 0.05 &&
  r.avg_volume >= MIN_AVG_VOL &&
  ((r.atm_iv ?? 0) >= MIN_ATM_IV || (r.hv_rank ?? 0) >= MIN_HV_RANK) &&
  r.put_otm_vol_total >= MIN_OPT_VOL
);

// Compute ATR buffer check: strike should be at least 1.5x ATR away from spot
function atrBuffer(r, side) {
  if (!r.atr14) return null;
  const strike = side === 'call' ? r.best_call_strike : r.best_put_strike;
  const dist = side === 'call' ? (strike - r.price) : (r.price - strike);
  return dist / r.atr14;
}

for (const r of summary) {
  r.call_atr_buf = atrBuffer(r, 'call');
  r.put_atr_buf = atrBuffer(r, 'put');
}

// Sort: by IV desc then credit desc
const sortKey = (side) => (a, b) => {
  const ka = side === 'call' ? a.best_call_iv : a.best_put_iv;
  const kb = side === 'call' ? b.best_call_iv : b.best_put_iv;
  return (kb || 0) - (ka || 0);
};

callCandidates.sort(sortKey('call'));
putCandidates.sort(sortKey('put'));

console.log('=== CALL candidates (sell OTM calls) — sorted by IV ===');
console.log('ticker  price  atm_iv  hvrank  strike  credit  IV    delta_from_18  ATR_buf  OTMvol  avgVol(M)  name');
for (const r of callCandidates.slice(0, 40)) {
  console.log([
    r.ticker.padEnd(6),
    r.price.toFixed(2).padStart(6),
    (r.atm_iv * 100).toFixed(1).padStart(5),
    r.hv_rank?.toFixed(1).padStart(5) || '  -',
    r.best_call_strike.toFixed(1).padStart(5),
    r.best_call_credit.toFixed(2).padStart(5),
    (r.best_call_iv * 100).toFixed(0).padStart(4),
    r.call_atr_buf?.toFixed(2).padStart(5) || ' -',
    r.call_otm_vol_total.toString().padStart(6),
    (r.avg_volume / 1e6).toFixed(1).padStart(6),
    r.name?.slice(0, 40),
  ].join('  '));
}

console.log('\n=== PUT candidates (sell OTM puts) — sorted by IV ===');
console.log('ticker  price  atm_iv  hvrank  strike  credit  IV    ATR_buf  OTMvol  avgVol(M)  name');
for (const r of putCandidates.slice(0, 40)) {
  console.log([
    r.ticker.padEnd(6),
    r.price.toFixed(2).padStart(6),
    (r.atm_iv * 100).toFixed(1).padStart(5),
    r.hv_rank?.toFixed(1).padStart(5) || '  -',
    r.best_put_strike.toFixed(1).padStart(5),
    r.best_put_credit.toFixed(2).padStart(5),
    (r.best_put_iv * 100).toFixed(0).padStart(4),
    r.put_atr_buf?.toFixed(2).padStart(5) || ' -',
    r.put_otm_vol_total.toString().padStart(6),
    (r.avg_volume / 1e6).toFixed(1).padStart(6),
    r.name?.slice(0, 40),
  ].join('  '));
}

console.log(`\nTotal summary: ${summary.length}`);
console.log(`Call candidates: ${callCandidates.length}`);
console.log(`Put candidates: ${putCandidates.length}`);

// Write shortlist CSVs
function writeCsv(p, rows, cols) {
  const header = cols.join(',');
  const body = rows.map((r) => cols.map((c) => r[c] ?? '').join(',')).join('\n');
  fs.writeFileSync(p, header + '\n' + body);
}

const cols = ['ticker', 'name', 'price', 'atm_iv_pct', 'hv_rank', 'atr14', 'avg_volume', 'market_cap',
              'best_call_strike', 'best_call_credit', 'best_call_iv', 'call_atr_buf', 'call_otm_vol_total',
              'best_put_strike', 'best_put_credit', 'best_put_iv', 'put_atr_buf', 'put_otm_vol_total'];

writeCsv(path.join(OUT, 'shortlist_calls.csv'), callCandidates, cols);
writeCsv(path.join(OUT, 'shortlist_puts.csv'), putCandidates, cols);
console.log('\nWrote shortlist_calls.csv and shortlist_puts.csv');
