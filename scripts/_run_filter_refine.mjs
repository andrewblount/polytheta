// Run the existing filter_shortlist + refine_shortlist logic against the refreshed data.
// Writes shortlist_calls.csv, shortlist_puts.csv,
// shortlist_calls_refined.csv, shortlist_puts_refined.csv.

import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

const OUT = path.join(REPO_ROOT, 'baskets', '2026-04-20', 'data');

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    // need csv-aware split for name column with commas
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
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
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
  const q = qByT[r.ticker];
  r.avg_volume = q ? parseInt(q.avg_volume || '0', 10) : 0;
  r.market_cap = q ? parseFloat(q.market_cap || '0') : 0;
  r.name = q ? q.name : r.ticker;
  r.call_atr_buf = r.atr14 && r.best_call_strike ? (r.best_call_strike - r.price) / r.atr14 : null;
  r.put_atr_buf = r.atr14 && r.best_put_strike ? (r.price - r.best_put_strike) / r.atr14 : null;
}

const outCols = ['ticker','name','price','atm_iv_pct','hv_rank','atr14','avg_volume','market_cap',
                 'best_call_strike','best_call_credit','best_call_iv','call_atr_buf','call_otm_vol_total',
                 'best_put_strike','best_put_credit','best_put_iv','put_atr_buf','put_otm_vol_total'];

// Stage 1 (filter_shortlist)
const MIN_ATM_IV_S1 = 0.55, MIN_HV_RANK_S1 = 60, MIN_AVG_VOL = 1_500_000;
const highVol1 = (r) => (r.atm_iv ?? 0) >= MIN_ATM_IV_S1 || (r.hv_rank ?? 0) >= MIN_HV_RANK_S1;
const callC = summary.filter((r) => r.best_call_strike && r.best_call_credit >= 0.05 && r.avg_volume >= MIN_AVG_VOL && highVol1(r) && r.call_otm_vol_total >= 100);
const putC  = summary.filter((r) => r.best_put_strike && r.best_put_credit >= 0.05 && r.avg_volume >= MIN_AVG_VOL && highVol1(r) && r.put_otm_vol_total >= 100);
callC.sort((a,b)=>(b.best_call_iv||0)-(a.best_call_iv||0));
putC.sort((a,b)=>(b.best_put_iv||0)-(a.best_put_iv||0));
writeCsv(path.join(OUT,'shortlist_calls.csv'), callC, outCols);
writeCsv(path.join(OUT,'shortlist_puts.csv'),  putC,  outCols);

// Stage 2 (refine_shortlist) — add ETF exclusion, ATR buffer, etc.
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
const MAX_OPT_IV = 2.0, MIN_CREDIT = 0.10, MIN_ATR_BUF = 1.0;
const MIN_ATM_IV = 0.55, MIN_HV_RANK = 55;
const highVol2 = (r) => (r.atm_iv ?? 0) >= MIN_ATM_IV || (r.hv_rank ?? 0) >= MIN_HV_RANK;

const calls = summary.filter((r) =>
  !isEtf(r) &&
  r.best_call_strike && r.best_call_credit >= MIN_CREDIT &&
  r.best_call_iv <= MAX_OPT_IV &&
  r.avg_volume >= MIN_AVG_VOL &&
  highVol2(r) &&
  r.call_otm_vol_total >= 300 &&
  (r.call_atr_buf ?? 0) >= MIN_ATR_BUF
);
const puts = summary.filter((r) =>
  !isEtf(r) &&
  r.best_put_strike && r.best_put_credit >= MIN_CREDIT &&
  r.best_put_iv <= MAX_OPT_IV &&
  r.avg_volume >= MIN_AVG_VOL &&
  highVol2(r) &&
  r.put_otm_vol_total >= 300 &&
  (r.put_atr_buf ?? 0) >= MIN_ATR_BUF
);
calls.sort((a,b)=>(b.best_call_iv||0)-(a.best_call_iv||0));
puts.sort((a,b)=>(b.best_put_iv||0)-(a.best_put_iv||0));

writeCsv(path.join(OUT,'shortlist_calls_refined.csv'), calls, outCols);
writeCsv(path.join(OUT,'shortlist_puts_refined.csv'),  puts,  outCols);

console.log('=== CALL refined (top 20) ===');
console.log('TKR   PX     IV%  HVR   K     CR    IV    ATR  BUF   Vol    MC($B)');
for (const r of calls.slice(0, 20)) {
  console.log([
    r.ticker.padEnd(5),
    r.price.toFixed(2).padStart(6),
    (r.atm_iv * 100).toFixed(0).padStart(3),
    (r.hv_rank ?? 0).toFixed(0).padStart(3),
    r.best_call_strike.toFixed(1).padStart(5),
    r.best_call_credit.toFixed(2).padStart(4),
    (r.best_call_iv * 100).toFixed(0).padStart(4),
    (r.atr14 ?? 0).toFixed(2).padStart(4),
    (r.call_atr_buf ?? 0).toFixed(1).padStart(4),
    r.call_otm_vol_total.toString().padStart(6),
    (r.market_cap / 1e9).toFixed(1).padStart(5),
  ].join('  '));
}
console.log(`\nTotal calls: ${calls.length}`);

console.log('\n=== PUT refined (top 20) ===');
console.log('TKR   PX     IV%  HVR   K     CR    IV    ATR  BUF   Vol    MC($B)');
for (const r of puts.slice(0, 20)) {
  console.log([
    r.ticker.padEnd(5),
    r.price.toFixed(2).padStart(6),
    (r.atm_iv * 100).toFixed(0).padStart(3),
    (r.hv_rank ?? 0).toFixed(0).padStart(3),
    r.best_put_strike.toFixed(1).padStart(5),
    r.best_put_credit.toFixed(2).padStart(4),
    (r.best_put_iv * 100).toFixed(0).padStart(4),
    (r.atr14 ?? 0).toFixed(2).padStart(4),
    (r.put_atr_buf ?? 0).toFixed(1).padStart(4),
    r.put_otm_vol_total.toString().padStart(6),
    (r.market_cap / 1e9).toFixed(1).padStart(5),
  ].join('  '));
}
console.log(`\nTotal puts: ${puts.length}`);

// Also dump the basket-specific 8 rows for verification
const BASKET = {
  calls: ['GTLB','DOW','DBX','HIMS'],
  puts:  ['PL','SMR','LUNR','RIOT'],
};
console.log('\n=== BASKET TICKERS (after refresh) ===');
for (const t of BASKET.calls) {
  const r = summary.find(x => x.ticker === t);
  if (r) console.log(`CALL ${t}: px=${r.price} atm_iv=${(r.atm_iv*100).toFixed(0)}% hvR=${(r.hv_rank ?? 0).toFixed(0)} bestK=${r.best_call_strike} cr=${r.best_call_credit} d=${r.best_call_iv ? (r.best_call_iv*100).toFixed(0)+'%' : 'n/a'} atr=${r.atr14?.toFixed(2)} buf=${r.call_atr_buf?.toFixed(1)}×`);
  else console.log(`CALL ${t}: NOT IN UNIVERSE`);
}
for (const t of BASKET.puts) {
  const r = summary.find(x => x.ticker === t);
  if (r) console.log(`PUT  ${t}: px=${r.price} atm_iv=${(r.atm_iv*100).toFixed(0)}% hvR=${(r.hv_rank ?? 0).toFixed(0)} bestK=${r.best_put_strike} cr=${r.best_put_credit} d=${r.best_put_iv ? (r.best_put_iv*100).toFixed(0)+'%' : 'n/a'} atr=${r.atr14?.toFixed(2)} buf=${r.put_atr_buf?.toFixed(1)}×`);
  else console.log(`PUT  ${t}: NOT IN UNIVERSE`);
}
