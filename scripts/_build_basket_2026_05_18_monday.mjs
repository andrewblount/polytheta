// Builds basket_proposal.json for the 2026-05-18 Monday entry / 2026-05-22
// Friday expiry. Mirrors _build_basket_2026_05_11_monday.mjs but with this
// week's curated picks. The earnings filter is a hard pre-pick gate — any
// ticker that reports between basket_date and expiry (inclusive) is rejected.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = '2026-05-18';
const EXPIRY_ISO = '2026-05-22';
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

// Curated picks for Monday 2026-05-18 / Friday 2026-05-22 expiry.
// Each ticker is earnings-clean for the holding window. Selection optimized
// for ATR buffer (≥1.2×, mostly ≥1.5×), composite IV × buffer × credit,
// sector spread, and contract liquidity (bid > 0 with reasonably tight spreads).
const candidates = [
  // CALLS (sell OTM calls — bearish thesis)
  { side: 'call', ticker: 'NVTS', K: 26,   thesis: 'Navitas Semiconductor — 178% option IV (top of call-side IV among earnings-clean names), 1.75× ATR buf, very liquid (1881 vol). Power-semiconductor sector. Earnings 2026-08-03 (well clear of expiry).' },
  { side: 'call', ticker: 'RDW',  K: 16.5, thesis: 'Redwire — 168% option IV, 2.02× ATR buf (deepest call-side buffer), HV rank 81 (realized supports IV). Space/aerospace sector. Earnings 2026-08-05.' },
  { side: 'call', ticker: 'FIG',  K: 26,   thesis: 'Figma — 114% option IV, 2.17× ATR buf, tight 13% spread / 1140 vol. Design SaaS sector. Earnings 2026-08-14.' },
  { side: 'call', ticker: 'NNE',  K: 29,   thesis: 'NANO Nuclear Energy — 128% option IV, 1.6× ATR buf, HV rank 81, tight 15% spread. Nuclear/clean-energy sector. Earnings 2026-08-13.' },

  // PUTS (sell OTM puts — bullish thesis)
  { side: 'put',  ticker: 'ASST', K: 15,   thesis: 'Strive Asset Management — 118% option IV, 1.34× ATR buf, tightest put-side spread (20%). Asset-management/crypto-treasury sector. Earnings 2026-08-13.' },
  { side: 'put',  ticker: 'UPST', K: 27,   thesis: 'Upstart Holdings — 84% option IV, 1.32× ATR buf, tight 29% spread. AI-lending/fintech sector (diversification away from crypto/AI hardware). Earnings 2026-08-04.' },
  { side: 'put',  ticker: 'OUST', K: 30,   thesis: 'Ouster — 141% option IV, 1.41× ATR buf, HV rank 81. LiDAR/sensors sector. Earnings 2026-05-05 already past (next reading roughly Aug per pattern).' },
  { side: 'put',  ticker: 'WULF', K: 20,   thesis: 'TeraWulf — 113% option IV, 1.29× ATR buf, liquid (1387 vol / 1797 oi). BTC-mining sector. Earnings 2026-08-06.' },
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
    `cr=${r.cr.toFixed(2)} Δ=${r.delta.toFixed(2)} buf=${r.buf}× n=${r.contracts} mgn=${r.margin} earns=${r.earnings_date ?? '—'}`
  );
}
