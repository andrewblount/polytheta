import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const OUT = path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data');

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = l.split(',');
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
}

const summary = readCsv(path.join(OUT, 'chain_summary_v2.csv'));
const quotes = readCsv(path.join(OUT, 'universe_quotes.csv'));
const qByT = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

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

for (const r of summary) {
  const q = qByT[r.ticker];
  r.avg_volume = q ? parseInt(q.avg_volume || '0', 10) : 0;
  r.market_cap = q ? parseFloat(q.market_cap || '0') : 0;
  r.name = q ? q.name : r.ticker;
}

// ATR buffers
for (const r of summary) {
  r.call_atr_buf = r.atr14 && r.best_call_strike ? (r.best_call_strike - r.price) / r.atr14 : null;
  r.put_atr_buf = r.atr14 && r.best_put_strike ? (r.price - r.best_put_strike) / r.atr14 : null;
}

// Exclude leveraged ETFs, inverse ETFs, crypto-proxy ETFs, 2x/3x products
const ETF_KEYWORDS = [
  'ProShares', 'Direxion', 'Daily Bull', 'Daily Bear', '2x', '3x', '2X', '3X',
  '2x Long', '2x Ether', 'GraniteShares', 'Leveraged', 'Grayscale', 'Inverse',
  'UltraShort', 'UltraPro', 'VIX Futures', 'Bitcoin Strategy', 'ETF'
];
const ETF_TICKERS = new Set([
  'SCO', 'SOXS', 'TSLL', 'CONL', 'ETHU', 'ETHE', 'BITX', 'TQQQ', 'SQQQ',
  'UVXY', 'SVXY', 'VXX', 'VIXY', 'TMF', 'TMV', 'TLT', 'HYG', 'JNK', 'SOXL',
  'FAS', 'FAZ', 'LABU', 'LABD', 'TNA', 'TZA', 'YINN', 'YANG', 'SPXU', 'UPRO',
  'BOIL', 'KOLD', 'GUSH', 'DRIP', 'NUGT', 'DUST', 'JNUG', 'JDST', 'ERX', 'ERY',
  'DPST', 'WEBL', 'WEBS', 'CWEB', 'BITO', 'ETHA', 'FBTC', 'IBIT', 'ETHV',
]);

function isEtf(r) {
  if (ETF_TICKERS.has(r.ticker)) return true;
  const n = (r.name || '').toLowerCase();
  if (n.includes('etf') || n.includes('ultrashort') || n.includes('ultra pro') ||
      n.includes('proshares') || n.includes('direxion') || n.includes('graniteshares') ||
      n.includes('grayscale') || n.includes('2x ') || n.includes('3x ') ||
      n.includes('leveraged') || n.includes('strategy etf') || n.includes('staking etf') ||
      n.includes('bull') || n.includes('bear') || n.includes('futures etf')) return true;
  return false;
}

// Sanity filter: reasonable IV (<= 200%) and positive credit
const MAX_OPT_IV = 2.0;
const MIN_CREDIT = 0.10;
const MIN_ATR_BUF = 1.0;  // strike at least 1x ATR away
const MIN_ATM_IV = 0.55;
const MIN_HV_RANK = 55;
const MIN_AVG_VOL = 1_500_000;

function highVol(r) {
  return (r.atm_iv ?? 0) >= MIN_ATM_IV || (r.hv_rank ?? 0) >= MIN_HV_RANK;
}

const calls = summary.filter((r) =>
  !isEtf(r) &&
  r.best_call_strike && r.best_call_credit >= MIN_CREDIT &&
  r.best_call_iv <= MAX_OPT_IV &&
  r.avg_volume >= MIN_AVG_VOL &&
  highVol(r) &&
  r.call_otm_vol_total >= 300 &&
  (r.call_atr_buf ?? 0) >= MIN_ATR_BUF
);

const puts = summary.filter((r) =>
  !isEtf(r) &&
  r.best_put_strike && r.best_put_credit >= MIN_CREDIT &&
  r.best_put_iv <= MAX_OPT_IV &&
  r.avg_volume >= MIN_AVG_VOL &&
  highVol(r) &&
  r.put_otm_vol_total >= 300 &&
  (r.put_atr_buf ?? 0) >= MIN_ATR_BUF
);

calls.sort((a, b) => (b.best_call_iv - a.best_call_iv));
puts.sort((a, b) => (b.best_put_iv - a.best_put_iv));

function table(rows, side) {
  const header = 'TKR   PX     IV%  HVR   K     CR    IV    ATR  BUF   Vol    MC($B)  Name';
  console.log(header);
  for (const r of rows) {
    const strike = side === 'call' ? r.best_call_strike : r.best_put_strike;
    const credit = side === 'call' ? r.best_call_credit : r.best_put_credit;
    const iv = side === 'call' ? r.best_call_iv : r.best_put_iv;
    const buf = side === 'call' ? r.call_atr_buf : r.put_atr_buf;
    const vol = side === 'call' ? r.call_otm_vol_total : r.put_otm_vol_total;
    console.log([
      r.ticker.padEnd(5),
      r.price.toFixed(2).padStart(6),
      (r.atm_iv * 100).toFixed(0).padStart(3),
      (r.hv_rank ?? 0).toFixed(0).padStart(3),
      strike.toFixed(1).padStart(5),
      credit.toFixed(2).padStart(4),
      (iv * 100).toFixed(0).padStart(4),
      (r.atr14 ?? 0).toFixed(2).padStart(4),
      buf.toFixed(1).padStart(4),
      vol.toString().padStart(6),
      (r.market_cap / 1e9).toFixed(1).padStart(5),
      (r.name ?? '').slice(0, 38),
    ].join('  '));
  }
}

console.log('=== CALL CANDIDATES (sell OTM calls on WEAK names) ===');
table(calls.slice(0, 40), 'call');
console.log(`\nTotal: ${calls.length} call candidates`);

console.log('\n=== PUT CANDIDATES (sell OTM puts on STRONG names) ===');
table(puts.slice(0, 40), 'put');
console.log(`\nTotal: ${puts.length} put candidates`);

// Write refined shortlist
function writeCsv(p, rows, cols) {
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => r[c] ?? '').join(','));
  fs.writeFileSync(p, lines.join('\n'));
}
const outCols = ['ticker','name','price','atm_iv_pct','hv_rank','atr14','avg_volume','market_cap',
                 'best_call_strike','best_call_credit','best_call_iv','call_atr_buf','call_otm_vol_total',
                 'best_put_strike','best_put_credit','best_put_iv','put_atr_buf','put_otm_vol_total'];
writeCsv(path.join(OUT, 'shortlist_calls_refined.csv'), calls, outCols);
writeCsv(path.join(OUT, 'shortlist_puts_refined.csv'), puts, outCols);
console.log('\nWrote refined shortlists.');
