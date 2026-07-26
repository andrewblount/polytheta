// Builds basket_proposal.json for the 2026-05-26 Tuesday entry / 2026-05-29
// Friday expiry. Memorial Day (Mon 2026-05-25) is a market holiday, so the
// entry day shifts to Tuesday. Mirrors _build_basket_2026_05_18_monday.mjs
// but with this week's curated picks. The earnings filter is a hard pre-pick
// gate — any ticker that reports between basket_date and expiry (inclusive)
// is rejected.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = '2026-05-26';
const EXPIRY_ISO = '2026-05-29';
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

const chains = readCsv(path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`));
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

// Curated picks for Tuesday 2026-05-26 / Friday 2026-05-29 expiry.
// Each ticker is earnings-clean for the holding window. Selection optimized
// for ATR buffer (>=1.2x, mostly >=1.5x on the call side), composite
// IV x buffer x credit, sector spread (8 distinct sectors), and contract
// liquidity (bid > 0 with reasonably tight spreads).
const candidates = [
  // CALLS (sell OTM calls -- bearish thesis)
  { side: 'call', ticker: 'NVTS', K: 36, thesis: 'Navitas Semiconductor -- 186% option IV (top call-side composite), 2.16x ATR buffer, very liquid (1139 vol). Power-semiconductor sector. Earnings 2026-08-03 (well clear of expiry).' },
  { side: 'call', ticker: 'RGTI', K: 32, thesis: 'Rigetti Computing -- 174% option IV, 2.41x ATR buffer (deepest call-side buffer in the basket). Quantum-computing sector. Last earnings 2026-05-11 already past; next reading ~Aug per cadence. Strike has 1258 vol but 0 OI -- work the limit (~33% nominal spread).' },
  { side: 'call', ticker: 'LUNR', K: 45, thesis: 'Intuitive Machines -- 155% option IV, 1.66x ATR buffer, 615 vol / 449 OI. Space/aerospace sector. Earnings 2026-08-06.' },
  { side: 'call', ticker: 'POET', K: 18, thesis: 'POET Technologies -- 196% option IV (highest in basket), 1.31x ATR buffer, tightest spread of any pick (~11%), deep liquidity (1239 vol / 1111 OI). Photonics sector. Earnings 2026-08-11.' },

  // PUTS (sell OTM puts -- bullish thesis)
  { side: 'put', ticker: 'SOC', K: 13, thesis: 'Sable Offshore -- 129% option IV, 1.73x ATR buffer (deepest put-side buffer). Offshore-oil sector. Last earnings 2026-05-06 already past; next reading ~Aug per cadence.' },
  { side: 'put', ticker: 'BTDR', K: 13, thesis: 'Bitdeer Technologies -- 117% option IV, 1.28x ATR buffer, very liquid (1389 vol). Bitcoin-mining sector. Last earnings 2026-05-14 already past; next reading ~Aug per cadence. ~50% nominal spread -- high volume should compress it at the open.' },
  { side: 'put', ticker: 'DOW', K: 34, thesis: 'Dow Inc. -- 63% option IV, 1.39x ATR buffer, 102 vol / 183 OI, ~22% spread. Chemicals sector (large-cap diversification away from high-beta names). Earnings 2026-07-23.' },
  { side: 'put', ticker: 'CCL', K: 24.5, thesis: 'Carnival -- 70% option IV, 1.26x ATR buffer, best put-side liquidity (409 vol / 790 OI). Cruise-line sector. Earnings 2026-06-24 (after expiry).' },
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

function macro(t) { return parseFloat(macroByT[t]?.price); }
function macro_prev(t) { return parseFloat(macroByT[t]?.prev_close); }
const VIX = macro('^VIX');
const VIX_prev = macro_prev('^VIX');
const SPY = macro('SPY');
const SPX = macro('^GSPC');
const SKEW = macro('^SKEW');
const MOVE = macro('^MOVE');
// HY OAS not in Yahoo macro pull; carry forward last value pending TradingView refresh.
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
  entry_note: 'Monday 2026-05-25 is Memorial Day (market holiday); entry day is Tuesday 2026-05-26.',
  hold_window: { start: HOLD_START, end: HOLD_END },
  earnings_filter_applied: true,
  earnings_in_window_count_universe: Object.values(earningsByT).filter(
    (e) => e.next_date && e.next_date >= HOLD_START && e.next_date <= HOLD_END
  ).length,
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
for (const r of valid) {
  console.log(
    `${r.side.padEnd(4)} ${r.ticker.padEnd(5)} px=${String(r.px).padStart(6)} K=${String(r.K).padStart(5)} ` +
    `cr=${r.cr.toFixed(2)} Δ=${r.delta.toFixed(2)} buf=${r.buf}x n=${r.contracts} mgn=${r.margin} earns=${r.earnings_date ?? '-'}`
  );
}
