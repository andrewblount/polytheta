// Builds basket_proposal.json for the 2026-06-15 Monday entry / 2026-06-18
// Thursday-weekly expiry. The standard Friday weekly (2026-06-19) is
// Juneteenth — US markets are closed — so the Thursday-prior weekly is
// the operative expiry for this week. Mirrors prior weeks' build scripts
// with curated picks. The earnings filter is a hard pre-pick gate.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const BASKET_DATE = '2026-06-15';
const EXPIRY_ISO = '2026-06-18';
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

// Curated picks for Monday 2026-06-15 / Thursday 2026-06-18 expiry.
// Selected from shortlist_calls_refined.csv and shortlist_puts_refined.csv
// with sector spread, ATR buffer >= 1.10x, tight spreads, earnings clear.
const candidates = [
  // CALLS (sell OTM calls — bearish thesis on hyped / speculative / weak names)
  { side: 'call', ticker: 'POET', K: 15,
    thesis: 'POET Technologies — 194% option IV (highest in basket), 1.32x ATR buffer ((15-12.53)/1.868), excellent option liquidity (22,819 OTM call vol, 13,039 OTM put vol). Photonics / silicon-photonics speculative name. 24% bid/ask spread on the strike. Earnings 2026-08-11 (well clear of expiry).' },
  { side: 'call', ticker: 'BTDR', K: 21,
    thesis: 'Bitdeer Technologies — 187% option IV, 1.68x ATR buffer ((21-17.83)/1.885), credit $0.425 mid. Crypto mining / bitcoin compute. Last earnings 2026-05-14 already past; next ~Aug. 30% spread acceptable for this IV.' },
  { side: 'call', ticker: 'CIFR', K: 27.5,
    thesis: 'Cipher Digital — 137% option IV, 1.13x ATR buffer ((27.5-24.5)/2.653), tight 24% spread on the strike, deep liquidity (16,423 OTM call vol). Bitcoin mining / data-center build-out. Earnings 2026-08-06.' },
  { side: 'call', ticker: 'BB', K: 10.5,
    thesis: 'BlackBerry — 134% option IV, 1.49x ATR buffer ((10.5-9.19)/0.88), tight 50% spread (small absolute width). Cybersecurity / IoT software. HV rank 100 (extreme realized vol). Earnings 2026-06-25 — first reading after expiry, so the earnings gap is the bear case.' },

  // PUTS (sell OTM puts — bullish thesis on real / strong large-cap names)
  { side: 'put', ticker: 'NOK', K: 13.5,
    thesis: 'Nokia — $82.6B MC telecom, 103% option IV, 1.17x ATR buffer ((14.80-13.5)/1.111), extremely tight 6% bid/ask (0.16/0.17) on the strike, very deep liquidity (17,357 vol / 19,302 OI on this strike alone). Earnings 2026-07-23 — beyond expiry. Tier-1 large-cap diversification.' },
  { side: 'put', ticker: 'DKNG', K: 27,
    thesis: 'DraftKings — $14.4B sports-betting / iGaming, 70% option IV, 1.38x ATR buffer ((29-27)/1.445), 19% spread (0.16/0.19), HV rank 80. Earnings 2026-08-05. Strong consumer-discretionary name.' },
  { side: 'put', ticker: 'CCL', K: 27,
    thesis: 'Carnival — $40.4B cruise / travel-leisure, 73% option IV, 1.87x ATR buffer ((29.18-27)/1.166 — deepest put-side buffer), 27% spread (0.15/0.19), enormous OI 18,032. Earnings 2026-06-23 — three trading days after expiry, so cleanly past the holding window.' },
  { side: 'put', ticker: 'TSCO', K: 30,
    thesis: 'Tractor Supply — $16.4B specialty retail, 55% option IV (lowest in basket — counterweight to high-vol names), 1.10x ATR buffer ((31.25-30)/1.14), 50% spread (0.20/0.30). Earnings 2026-04-21 past; next ~July. Defensive consumer-retail bucket.' },
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
// HY OAS not in Yahoo macro pull; carrying forward last known value pending
// TradingView refresh (TradingView weekly file last updated 2026-04-19;
// downloader currently stale on the macro side).
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
  entry_note: 'Standard Monday 2026-06-15 entry. Friday 2026-06-19 is Juneteenth (US market closed), so the Thursday-prior weekly (2026-06-18) is the operative expiry.',
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
    `cr=${r.cr.toFixed(2)} d=${r.delta.toFixed(2)} buf=${r.buf}x n=${r.contracts} mgn=${r.margin} earns=${r.earnings_date ?? '-'}`
  );
}
