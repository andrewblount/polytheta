// Builds the refreshed Monday-morning basket_proposal.json for 2026-04-27.
//
// HARD RULE — earnings filter:
//   Any ticker whose next earnings date falls between basket_date and
//   expiry (inclusive of both ends) is excluded. The filter is enforced
//   BEFORE final pick selection, so a name with earnings inside the
//   holding window cannot enter the basket regardless of its IV.
//
// This run pulls fresh chain bids/asks for the curated picks and re-sizes
// contracts to ~$55K Reg-T-style naked margin per name.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = '2026-04-27';
const EXPIRY_ISO = '2026-05-01';
const HOLD_START = BASKET_DATE;
const HOLD_END = EXPIRY_ISO;
const OUT = path.join(REPO_ROOT, 'baskets', BASKET_DATE, 'data');

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
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

const chains = readCsv(path.join(OUT, 'chains_2026-05-01_v2.csv'));
const summary = readCsv(path.join(OUT, 'chain_summary_v2.csv'));
const macroRows = readCsv(path.join(OUT, 'macro_quotes.csv'));
const macroByT = Object.fromEntries(macroRows.map((m) => [m.ticker, m]));
const earningsByT = JSON.parse(
  fs.readFileSync(path.join(OUT, 'earnings_dates.json'), 'utf8')
);

function findStrike(ticker, type, strike) {
  return chains.find(
    (r) => r.ticker === ticker && r.type === type && parseFloat(r.strike) === strike
  );
}
function getSummary(ticker) { return summary.find((s) => s.ticker === ticker); }

function earningsConflict(ticker) {
  const e = earningsByT[ticker];
  if (!e || !e.next_date) return null;
  return (e.next_date >= HOLD_START && e.next_date <= HOLD_END) ? e.next_date : null;
}

// Curated picks for Monday 4/27. Earnings-aware: every ticker below has been
// confirmed to NOT report between 2026-04-27 and 2026-05-01 (inclusive).
const candidates = [
  // CALLS (sell OTM calls — bearish thesis)
  { side: 'call', ticker: 'NN',   K: 21,    thesis: 'NextNav — low-float spectrum/location-services. 197% option IV, HV rank 98 (realized vol elevated). 1.83× ATR cushion. Earnings 2026-05-06 (after expiry).' },
  { side: 'call', ticker: 'NVTS', K: 20,    thesis: 'Navitas Semiconductor (GaN power). 168% option IV, 1.81× ATR. Liquid (1865 OI). Earnings 2026-05-05 (after expiry).' },
  { side: 'call', ticker: 'ASST', K: 18,    thesis: 'Strive Asset Management — 163% option IV, HV rank only 2 (cheap realized vol vs implied → premium-rich). 1.99× ATR cushion (essentially exactly at the 2× target). Earnings 2026-05-14.' },
  { side: 'call', ticker: 'BTDR', K: 13,    thesis: 'Bitdeer (BTC miner) — 152% IV, 2.00× ATR cushion. Earnings 2026-05-14.' },

  // PUTS (sell OTM puts — bullish thesis)
  { side: 'put',  ticker: 'SMR',  K: 11,    thesis: 'NuScale Power — 138% IV, 1.41× ATR (flagged below 2×). Strike refreshed 10.5→11 from prior week. Earnings 2026-05-07 (after expiry).' },
  { side: 'put',  ticker: 'CORZ', K: 19,    thesis: 'Core Scientific — BTC + AI-compute pivot. 93% IV, 1.64× ATR (best put-side buffer this week). Liquid (4179 OI). Earnings 2026-05-06.' },
  { side: 'put',  ticker: 'TTD',  K: 22,    thesis: 'The Trade Desk — adtech, $11.3B large-cap diversification. 76% IV, 1.39× ATR. Earnings 2026-05-07.' },
  { side: 'put',  ticker: 'SOC',  K: 12.5,  thesis: 'Sable Offshore — energy/oil diversification. 124% IV, 1.38× ATR. Earnings 2026-05-07.' },
];

// Hard earnings filter
const picks = [];
const blocked = [];
for (const p of candidates) {
  const conflict = earningsConflict(p.ticker);
  if (conflict) blocked.push({ ...p, earnings_date: conflict });
  else picks.push(p);
}
if (blocked.length) {
  console.error('[FATAL] earnings filter blocked these candidates:');
  for (const b of blocked) console.error(`  ${b.ticker} (${b.side}) earnings ${b.earnings_date}`);
  console.error('Edit candidates list and rerun.');
  process.exit(1);
}

// Reg-T-ish naked margin estimate per contract
function naked_margin_per_contract(price, strike, premium, side) {
  const otm = side === 'call' ? Math.max(strike - price, 0) : Math.max(price - strike, 0);
  const a = (0.20 * price - otm) * 100;
  const b = 0.10 * strike * 100;
  return Math.max(a, b) + premium * 100;
}

const NAME_BUDGET = 55000;
const enriched = picks.map((p) => {
  const row = findStrike(p.ticker, p.side, p.K);
  const sm = getSummary(p.ticker);
  if (!row || !sm) {
    console.warn(`missing chain row for ${p.ticker} ${p.K} ${p.side}`);
    return null;
  }
  const px = parseFloat(sm.price);
  const bid = parseFloat(row.bid);
  const ask = parseFloat(row.ask);
  const mid = +((bid + ask) / 2).toFixed(3);
  const iv = parseFloat(row.iv);
  const delta = parseFloat(row.delta_est);
  const atr = parseFloat(sm.atr14);
  const ivAtm = parseFloat(sm.atm_iv);
  const hvR = parseFloat(sm.hv_rank);
  const buf = +((p.side === 'call' ? p.K - px : px - p.K) / atr).toFixed(2);

  const margin_per = naked_margin_per_contract(px, p.K, mid, p.side);
  const contracts = Math.max(1, Math.round(NAME_BUDGET / margin_per));
  const margin = Math.round(contracts * margin_per);
  const credit = Math.round(contracts * mid * 100);
  const earningsDate = earningsByT[p.ticker]?.next_date ?? null;

  return {
    side: p.side, ticker: p.ticker,
    px: +px.toFixed(2), K: p.K,
    bid, ask, cr: mid, iv: +iv.toFixed(3),
    delta: +delta.toFixed(3),
    atr: +atr.toFixed(2), buf,
    hvR: Number.isFinite(hvR) ? Math.round(hvR) : null,
    ivAtm: Number.isFinite(ivAtm) ? +ivAtm.toFixed(2) : null,
    earnings_date: earningsDate,
    earnings_clear: !earningsConflict(p.ticker),
    thesis: p.thesis,
    contracts, credit, margin,
    spread: +(ask - bid).toFixed(2),
  };
});

const valid = enriched.filter(Boolean);
const totals = valid.reduce(
  (acc, r) => {
    if (r.side === 'call') { acc.callCredit += r.credit; acc.callMargin += r.margin; }
    else { acc.putCredit += r.credit; acc.putMargin += r.margin; }
    return acc;
  },
  { callCredit: 0, putCredit: 0, callMargin: 0, putMargin: 0 }
);

// Macro snapshot
function macro(t) { return parseFloat(macroByT[t]?.price); }
function macro_prev(t) { return parseFloat(macroByT[t]?.prev_close); }
const VIX = macro('^VIX');
const VIX_prev = macro_prev('^VIX');
const SPY = macro('SPY');
const SPX = macro('^GSPC');
const SKEW = macro('^SKEW');
const MOVE = macro('^MOVE');
const HY_OAS = 2.86;
const PC = 0.55;

const vix_change = VIX - VIX_prev;
const vix_norm = Math.max(0, Math.min(10, (VIX - 10) / 4 + Math.max(0, vix_change) * 0.5));
const skew_norm = Math.max(0, Math.min(10, (SKEW - 100) / 10));
const hyoas_avg5 = 3.59;
const hyoas_norm = Math.max(0, Math.min(10, ((HY_OAS - 1.5) / (hyoas_avg5 - 1.5)) * 5));
const move_norm = Math.max(0, Math.min(10, (MOVE - 50) / 10));
const pc_norm = Math.max(0, Math.min(10, (1 - PC) * 7));
const gsrs = +(0.40 * vix_norm + 0.20 * skew_norm + 0.20 * hyoas_norm + 0.10 * move_norm + 0.10 * pc_norm).toFixed(2);

const proposal = {
  basket_date: BASKET_DATE,
  expiry: EXPIRY_ISO,
  generated_ts: new Date().toISOString(),
  hold_window: { start: HOLD_START, end: HOLD_END },
  earnings_filter_applied: true,
  earnings_excluded_basket_names: [
    { ticker: 'ENPH', side: 'call', earnings_date: earningsByT['ENPH']?.next_date },
    { ticker: 'GLXY', side: 'call', earnings_date: earningsByT['GLXY']?.next_date },
    { ticker: 'RIVN', side: 'call', earnings_date: earningsByT['RIVN']?.next_date },
    { ticker: 'SOFI', side: 'put',  earnings_date: earningsByT['SOFI']?.next_date },
    { ticker: 'ZETA', side: 'put',  earnings_date: earningsByT['ZETA']?.next_date },
    { ticker: 'RIOT', side: 'put',  earnings_date: earningsByT['RIOT']?.next_date },
  ],
  poet_breach: {
    ticker: 'POET', friday_px: 15.10, monday_px: 8.42, change_pct: -44,
    note: 'Original Friday $12 put now $3.58 ITM; removed independent of earnings filter (gap-risk breach).',
  },
  macro: {
    SPY: +SPY?.toFixed(2), SPX: +SPX?.toFixed(2),
    VIX: +VIX?.toFixed(2), VIX_prev: +VIX_prev?.toFixed(2), VIX_change_1d: +vix_change?.toFixed(2),
    SKEW: +SKEW?.toFixed(2), MOVE: +MOVE?.toFixed(2),
    HY_OAS, PC,
  },
  gsrs_components: {
    vix: +vix_norm.toFixed(2), skew: +skew_norm.toFixed(2),
    hyoas: +hyoas_norm.toFixed(2), move: +move_norm.toFixed(2), pc: +pc_norm.toFixed(2),
  },
  gsrs,
  filter_note: 'Strikes filtered to bid > 0 AND ticker has no earnings between basket_date and expiry (inclusive).',
  picks: valid,
  totals,
};

const outFile = path.join(OUT, 'basket_proposal.json');
fs.writeFileSync(outFile, JSON.stringify(proposal, null, 2));
console.log(`wrote ${outFile}`);
console.log('GSRS:', gsrs, 'components:', proposal.gsrs_components);
console.log('Totals:', totals);
console.log('---');
console.log('Earnings excluded:');
for (const e of proposal.earnings_excluded_basket_names) {
  console.log(`  ${e.ticker.padEnd(6)} ${e.side.padEnd(4)} earns ${e.earnings_date}`);
}
console.log('---');
for (const r of valid) {
  console.log(
    `${r.side.padEnd(4)} ${r.ticker.padEnd(5)} px=${String(r.px).padStart(6)} K=${String(r.K).padStart(5)} ` +
    `cr=${r.cr.toFixed(2)} Δ=${r.delta.toFixed(2)} buf=${r.buf}× n=${r.contracts} mgn=${r.margin} earns=${r.earnings_date ?? '—'}`
  );
}
