// Builds basket_proposal.json for 2026-07-13 Monday entry / 2026-07-17 Friday weekly expiry.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = '2026-07-13';
const EXPIRY_ISO = '2026-07-17';
const HOLD_START = BASKET_DATE;
const HOLD_END = EXPIRY_ISO;
const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');

function readCsv(p) {
  const lines = fs.readFileSync(p,'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map(l=>{
    const cells=[];let cur='',inQ=false;
    for(let i=0;i<l.length;i++){const c=l[i];
      if(inQ){if(c==='"'&&l[i+1]==='"'){cur+='"';i++;}else if(c==='"')inQ=false;else cur+=c;}
      else{if(c==='"')inQ=true;else if(c===','){cells.push(cur);cur='';}else cur+=c;}
    }
    cells.push(cur);
    const o={};header.forEach((h,i)=>o[h]=cells[i]);return o;
  });
}

const chains = readCsv(path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`));
const summary = readCsv(path.join(OUT, 'chain_summary_v2.csv'));
const macroRows = readCsv(path.join(OUT, 'macro_quotes.csv'));
const macroByT = Object.fromEntries(macroRows.map(m=>[m.ticker,m]));
const earningsByT = JSON.parse(fs.readFileSync(path.join(OUT,'earnings_dates.json'),'utf8'));

function findStrike(t,type,K){return chains.find(r=>r.ticker===t&&r.type===type&&parseFloat(r.strike)===K);}
function getSummary(t){return summary.find(s=>s.ticker===t);}
function earningsConflict(t){const e=earningsByT[t];if(!e||!e.next_date)return null;return(e.next_date>=HOLD_START&&e.next_date<=HOLD_END)?e.next_date:null;}

// Curated picks for week of 2026-07-13 (expiry Fri 2026-07-17).
// Method: top of refined shortlists, sector-diverse, earnings-clear, ATR buf >= 1.0x.
const candidates = [
  // ---------- CALLS (sell OTM calls — bearish thesis on hyped / speculative names) ----------
  { side: 'call', ticker: 'CIFR', K: 25.0,
    thesis: 'Cipher Digital — 123% option IV, 1.12x ATR buf ((25-22.11)/2.58), enormous liquidity (24,465 OTM call vol), MC $9.0B. BTC miner + HPC narrative, repeat name. Earnings 2026-08-06 — past expiry.' },
  { side: 'call', ticker: 'POET', K: 9.5,
    thesis: 'POET Technologies — 131% option IV, 1.22x ATR buf ((9.5-8.31)/0.97), 5,561 OTM call vol. Silicon-photonics speculative name, repeat from prior weeks. Earnings 2026-08-11 — clear.' },
  { side: 'call', ticker: 'RGTI', K: 18.5,
    thesis: 'Rigetti Computing — 99% option IV, 1.32x ATR buf ((18.5-16.54)/1.49), 10,237 OTM call vol. Quantum-compute speculation. Yahoo calendarEvents returned stale (2026-05-11); no future earnings reported in holding window, hard filter passes.' },
  { side: 'call', ticker: 'SMCI', K: 31.0,
    thesis: 'Super Micro Computer — $18.3B MC large-cap AI server infra, 94% option IV, 1.19x ATR buf ((31-28.31)/2.27), massive liquidity (104,957 OTM call vol). Sector diversifier (AI hardware) versus crypto-miner + quantum overweight. Earnings 2026-08-04 — clear.' },

  // ---------- PUTS (sell OTM puts — bullish thesis on real / strong names) ----------
  { side: 'put', ticker: 'NOK', K: 11.5,
    thesis: 'Nokia Oyj — $69.4B MC large-cap telecom-equipment, 82% option IV, 1.15x ATR buf ((12.44-11.5)/0.82), 3,996 OTM put vol, HV rank 69. Tier-1 large-cap defensive; repeat name. Earnings 2026-07-23 — past expiry.' },
  { side: 'put', ticker: 'HIMS', K: 31.5,
    thesis: 'Hims & Hers Health — $8.0B MC consumer health/telemedicine, 91% option IV, 1.08x ATR buf ((34.38-31.5)/2.66), 10,124 OTM put vol. Real cash-flowing business, option vol skewed by news-flow. Earnings 2026-08-10 — clear.' },
  { side: 'put', ticker: 'SOFI', K: 17.5,
    thesis: 'SoFi Technologies — $24.1B MC large-cap consumer fintech, 69% option IV, 1.36x ATR buf ((18.78-17.5)/0.94), enormous liquidity (33,445 OTM put vol). Tier-1 fintech, still overpriced tail. Earnings 2026-07-29 — past expiry.' },
  { side: 'put', ticker: 'WBD', K: 25.0,
    thesis: 'Warner Bros. Discovery — $66.7B MC large-cap media, 65% option IV, 3.4x ATR buf ((26.59-25)/0.47 — deepest put-side buffer in basket), massive liquidity (23,046 OTM put vol). Defensive tier-1 large-cap. Earnings 2026-08-06 — clear.' },
];

// Hard earnings filter
const picks=[],blocked=[];
for (const p of candidates) {
  const c = earningsConflict(p.ticker);
  if (c) blocked.push({...p, earnings_date:c}); else picks.push(p);
}
if (blocked.length) {
  console.error('[FATAL] earnings filter blocked:');
  for (const b of blocked) console.error(`  ${b.ticker} (${b.side}) earnings ${b.earnings_date}`);
  process.exit(1);
}

function naked_margin_per_contract(price, strike, premium, side) {
  const otm = side==='call' ? Math.max(strike-price,0) : Math.max(price-strike,0);
  const a = (0.20*price - otm) * 100;
  const b = 0.10 * strike * 100;
  return Math.max(a,b) + premium*100;
}

const NAME_BUDGET = 55000;
const enriched = picks.map(p => {
  const row = findStrike(p.ticker, p.side, p.K);
  const sm = getSummary(p.ticker);
  if (!row || !sm) { console.warn(`missing chain row for ${p.ticker} ${p.K} ${p.side}`); return null; }
  const px = parseFloat(sm.price);
  const bid = parseFloat(row.bid);
  const ask = parseFloat(row.ask);
  const mid = +((bid+ask)/2).toFixed(3);
  const iv = parseFloat(row.iv);
  const delta = parseFloat(row.delta_est);
  const atr = parseFloat(sm.atr14);
  const ivAtm = parseFloat(sm.atm_iv);
  const hvR = parseFloat(sm.hv_rank);
  const buf = +((p.side==='call'? p.K-px : px-p.K)/atr).toFixed(2);
  const margin_per = naked_margin_per_contract(px, p.K, mid, p.side);
  const contracts = Math.max(1, Math.round(NAME_BUDGET/margin_per));
  const margin = Math.round(contracts*margin_per);
  const credit = Math.round(contracts*mid*100);
  const earningsDate = earningsByT[p.ticker]?.next_date ?? null;
  return {
    side:p.side, ticker:p.ticker, px:+px.toFixed(2), K:p.K,
    bid, ask, cr:mid, iv:+iv.toFixed(3), delta:+delta.toFixed(3),
    atr:+atr.toFixed(2), buf, hvR:Number.isFinite(hvR)?Math.round(hvR):null,
    ivAtm:Number.isFinite(ivAtm)?+ivAtm.toFixed(2):null,
    earnings_date:earningsDate, earnings_clear:!earningsConflict(p.ticker),
    thesis:p.thesis, contracts, credit, margin, spread:+(ask-bid).toFixed(2),
  };
});

const valid = enriched.filter(Boolean);
const totals = valid.reduce((acc,r)=>{
  if (r.side==='call'){acc.callCredit+=r.credit;acc.callMargin+=r.margin;}
  else{acc.putCredit+=r.credit;acc.putMargin+=r.margin;}
  return acc;
},{callCredit:0,putCredit:0,callMargin:0,putMargin:0});

function macro(t){return parseFloat(macroByT[t]?.price);}
function macro_prev(t){return parseFloat(macroByT[t]?.prev_close);}
const VIX=macro('^VIX'), VIX_prev=macro_prev('^VIX');
const SPY=macro('SPY'), SPX=macro('^GSPC'), SKEW=macro('^SKEW'), MOVE=macro('^MOVE');
// Prefer live values from tv_macros.json (written by scripts/_fetch_tv_macros.mjs,
// which opens the TradingView desktop app and pulls HY_OAS from FRED and P/C
// from CBOE — the same primary feeds TradingView relays on those symbols).
// If the file is missing or a value is unusable, fall back to a documented
// carry-forward default.
const TV_CARRY_HY_OAS = 2.86;
const TV_CARRY_PC = 0.55;
let HY_OAS = TV_CARRY_HY_OAS;
let PC = TV_CARRY_PC;
let TV_MACROS_SOURCE = { hy_oas: 'carried', pc: 'carried' };
try {
  const tv = JSON.parse(fs.readFileSync(path.join(OUT, 'tv_macros.json'), 'utf8'));
  if (Number.isFinite(tv?.hy_oas?.value)) {
    HY_OAS = tv.hy_oas.value;
    TV_MACROS_SOURCE.hy_oas = `FRED:BAMLH0A0HYM2 ${tv.hy_oas.date}`;
  }
  const pcVal = tv?.pc_ratio?.total;
  if (Number.isFinite(pcVal)) {
    PC = pcVal;
    TV_MACROS_SOURCE.pc = `CBOE total P/C${tv?.pc_ratio?.as_of ? ` ${tv.pc_ratio.as_of}` : ''}`;
  }
} catch (_) { /* leave carry-forward defaults */ }

const vix_change = VIX-VIX_prev;
const vix_norm = Math.max(0,Math.min(10,(VIX-10)/4 + Math.max(0,vix_change)*0.5));
const skew_norm = Math.max(0,Math.min(10,(SKEW-100)/10));
const hyoas_avg5 = 3.59;
const hyoas_norm = Math.max(0,Math.min(10,((HY_OAS-1.5)/(hyoas_avg5-1.5))*5));
const move_norm = Math.max(0,Math.min(10,(MOVE-50)/10));
const pc_norm = Math.max(0,Math.min(10,(1-PC)*7));
const gsrs = +(0.40*vix_norm + 0.20*skew_norm + 0.20*hyoas_norm + 0.10*move_norm + 0.10*pc_norm).toFixed(2);

const proposal = {
  basket_date: BASKET_DATE,
  expiry: EXPIRY_ISO,
  expiry_note: 'Standard Friday weekly expiry.',
  generated_ts: new Date().toISOString(),
  entry_note: 'Monday 2026-07-13 entry / Friday 2026-07-17 weekly expiry. Macro snapshot from Yahoo at last close (Fri 2026-07-10).',
  hold_window: { start: HOLD_START, end: HOLD_END },
  earnings_filter_applied: true,
  earnings_in_window_count_universe: Object.values(earningsByT).filter(e=>e.next_date && e.next_date>=HOLD_START && e.next_date<=HOLD_END).length,
  macro: { SPY:+SPY?.toFixed(2), SPX:+SPX?.toFixed(2), VIX:+VIX?.toFixed(2), VIX_prev:+VIX_prev?.toFixed(2), VIX_change_1d:+vix_change?.toFixed(2), SKEW:+SKEW?.toFixed(2), MOVE:+MOVE?.toFixed(2), HY_OAS, PC },
  tv_macros_source: TV_MACROS_SOURCE,
  gsrs_components: { vix:+vix_norm.toFixed(2), skew:+skew_norm.toFixed(2), hyoas:+hyoas_norm.toFixed(2), move:+move_norm.toFixed(2), pc:+pc_norm.toFixed(2) },
  gsrs,
  filter_note: 'Strikes filtered to bid > 0 AND ticker has no earnings between basket_date and expiry (inclusive).',
  picks: valid,
  totals,
};

const outFile = path.join(OUT,'basket_proposal.json');
fs.writeFileSync(outFile, JSON.stringify(proposal,null,2));
console.log(`wrote ${outFile}`);
console.log('GSRS:',gsrs,'components:',proposal.gsrs_components);
console.log('Totals:',totals);
console.log('---');
for (const r of valid) {
  console.log(`${r.side.padEnd(4)} ${r.ticker.padEnd(5)} px=${String(r.px).padStart(6)} K=${String(r.K).padStart(5)} cr=${r.cr.toFixed(2)} d=${r.delta.toFixed(2)} buf=${r.buf}x n=${r.contracts} mgn=${r.margin} earns=${r.earnings_date??'-'}`);
}
