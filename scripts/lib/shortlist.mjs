// Generic filter + refine + auto-pick logic for the weekly basket.
// Replaces per-week _filter_shortlist_*.mjs + _refine_shortlist_*.mjs + the
// curated candidate array inside _build_basket_*.mjs. Deterministic and
// idempotent — the same inputs always produce the same 8 picks.

import fs from 'node:fs';
import path from 'node:path';

function readCsv(p) {
  const lines = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map((l) => {
    const cells = []; let cur = '', inQ = false;
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
    const obj = {}; header.forEach((h, i) => obj[h] = cells[i]); return obj;
  });
}
function writeCsv(p, rows, cols) {
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => r[c] ?? '').join(','));
  fs.writeFileSync(p, lines.join('\n'));
}

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
  return /etf|ultrashort|ultra pro|proshares|direxion|graniteshares|grayscale|2x |3x |leveraged|strategy etf|staking etf|bull|bear|futures etf/.test(n);
}

// Screen thresholds. Kept identical to the historical per-week scripts so this
// generic version reproduces prior week outputs exactly.
const MAX_OPT_IV = 2.0;
const MIN_CREDIT = 0.10;
const MIN_ATR_BUF = 1.0;
const MIN_ATM_IV = 0.55;
const MIN_HV_RANK = 55;
const MIN_AVG_VOL = 1_500_000;
const MIN_SIDE_OTM_VOL = 300;

function highVol(r) {
  return (r.atm_iv ?? 0) >= MIN_ATM_IV || (r.hv_rank ?? 0) >= MIN_HV_RANK;
}

function enrich(summary, quotes) {
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
}

export function runFilterAndRefine(OUT) {
  const summary = readCsv(path.join(OUT, 'chain_summary_v2.csv'));
  const quotes = readCsv(path.join(OUT, 'universe_quotes.csv'));
  enrich(summary, quotes);

  // Basic shortlist (looser): matches historical _filter_shortlist_*.mjs.
  const callBase = summary.filter((r) =>
    r.best_call_strike && r.best_call_credit >= 0.05 &&
    r.avg_volume >= MIN_AVG_VOL &&
    highVol(r) &&
    r.call_otm_vol_total >= 100);
  const putBase = summary.filter((r) =>
    r.best_put_strike && r.best_put_credit >= 0.05 &&
    r.avg_volume >= MIN_AVG_VOL &&
    highVol(r) &&
    r.put_otm_vol_total >= 100);
  callBase.sort((a, b) => (b.best_call_iv || 0) - (a.best_call_iv || 0));
  putBase.sort((a, b) => (b.best_put_iv || 0) - (a.best_put_iv || 0));
  const cols = ['ticker','name','price','atm_iv_pct','hv_rank','atr14','avg_volume','market_cap',
                'best_call_strike','best_call_credit','best_call_iv','call_atr_buf','call_otm_vol_total',
                'best_put_strike','best_put_credit','best_put_iv','put_atr_buf','put_otm_vol_total'];
  writeCsv(path.join(OUT, 'shortlist_calls.csv'), callBase, cols);
  writeCsv(path.join(OUT, 'shortlist_puts.csv'), putBase, cols);

  // Refined shortlist (tighter): matches historical _refine_shortlist_*.mjs.
  const calls = summary.filter((r) =>
    !isEtf(r) &&
    r.best_call_strike && r.best_call_credit >= MIN_CREDIT && r.best_call_iv <= MAX_OPT_IV &&
    r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
    r.call_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.call_atr_buf ?? 0) >= MIN_ATR_BUF);
  const puts = summary.filter((r) =>
    !isEtf(r) &&
    r.best_put_strike && r.best_put_credit >= MIN_CREDIT && r.best_put_iv <= MAX_OPT_IV &&
    r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
    r.put_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.put_atr_buf ?? 0) >= MIN_ATR_BUF);
  calls.sort((a, b) => (b.best_call_iv - a.best_call_iv));
  puts.sort((a, b) => (b.best_put_iv - a.best_put_iv));
  writeCsv(path.join(OUT, 'shortlist_calls_refined.csv'), calls, cols);
  writeCsv(path.join(OUT, 'shortlist_puts_refined.csv'), puts, cols);
  return { calls_refined: calls.length, puts_refined: puts.length, all: summary };
}

// -----------------------------------------------------------------------------
// Auto-pick logic — replaces the curated candidate array from the per-week
// build scripts. Deterministic, transparent, and rooted in the same criteria
// the manual picks used: earnings-clear, ATR buf >= 1.0x, top IV, name-family
// diversity, and (for puts) tier-1 liquidity preference.
// -----------------------------------------------------------------------------

// Loose "sector family" grouping so the basket doesn't end up 3-deep in
// crypto miners or quantum names. We only have Yahoo names to work with, so
// this is a keyword taxonomy rather than a real GICS classifier.
const FAMILY_RULES = [
  { family: 'crypto_miner', keys: ['bitcoin','btc','mining','miner','digital mining','crypto','ethereum','ether'] },
  { family: 'quantum',      keys: ['quantum','rigetti','d-wave','ionq','arqit'] },
  { family: 'space_defense',keys: ['space','satellite','defense','aerospace','rocket'] },
  { family: 'nuclear',      keys: ['nuclear','uranium','fission','fusion','nuscale','nano nuclear'] },
  { family: 'solar_energy', keys: ['solar','sunrun','sunnova','canadian solar','first solar','enphase'] },
  { family: 'ev_auto',      keys: ['electric vehicle',' ev ','xpeng','tesla','rivian','lucid','fisker','nio '] },
  { family: 'biotech',      keys: ['therapeutic','pharma','biotech','bio ','biosciences','clinical'] },
  { family: 'cannabis',     keys: ['cannabis','marijuana','cronos','tilray','canopy'] },
  { family: 'ai_infra',     keys: ['ai infra','super micro','smci','arista','marvell','amd ','nvidia'] },
  { family: 'ai_software',  keys: ['palantir','c3.ai','anthropic','openai','uipath','path robotic'] },
  { family: 'fintech',      keys: ['fintech','sofi','affirm','upstart','klarna','robinhood','payments'] },
  { family: 'telco',        keys: ['nokia','ericsson','telecom','wireless communication','at&t','verizon'] },
  { family: 'consumer_health', keys: ['hims','hers','telemedicine','telehealth','wellness','peloton'] },
  { family: 'media',        keys: ['warner bros','paramount','disney','media','streaming','warner'] },
  { family: 'gaming_betting', keys: ['draftkings','gaming','sports betting','fanduel','penn ','wynn','mgm resorts'] },
  { family: 'ecommerce',    keys: ['e-commerce','shopify','etsy','wayfair','carvana','chewy'] },
  { family: 'silicon_photonics', keys: ['photonics','poet','photonic','silicon photonic'] },
  { family: 'rare_earths_materials', keys: ['rare earth','lithium','mp materials','sigma lithium','mining'] },
];
function familyOf(r) {
  const n = (r.name || '').toLowerCase();
  for (const rule of FAMILY_RULES) {
    if (rule.keys.some((k) => n.includes(k))) return rule.family;
  }
  return 'other';
}

// Choose up to `n` picks from `pool`, biased toward diversity of family and
// avoiding names already picked in `already` (the opposite side, so we don't
// double-book the same name).
function pickTop({ pool, side, n = 4, already = new Set() }) {
  const seenFamilies = new Set();
  const picks = [];
  const skipped = [];
  for (const r of pool) {
    if (already.has(r.ticker)) { skipped.push({ ticker: r.ticker, reason: 'same-name-other-side' }); continue; }
    const fam = familyOf(r);
    // Allow at most 2 names per family in the whole basket side.
    const famCount = picks.filter((p) => p.family === fam).length;
    if (famCount >= 2) { skipped.push({ ticker: r.ticker, reason: `family-cap:${fam}` }); continue; }
    picks.push({
      side, ticker: r.ticker, family: fam,
      K: side === 'call' ? r.best_call_strike : r.best_put_strike,
      thesis: side === 'call'
        ? `Auto: ${(r.best_call_iv * 100).toFixed(0)}% option IV, ${r.call_atr_buf.toFixed(2)}x ATR buf, ${r.call_otm_vol_total.toLocaleString()} OTM call vol, MC $${(r.market_cap / 1e9).toFixed(1)}B (${fam}).`
        : `Auto: ${(r.best_put_iv * 100).toFixed(0)}% option IV, ${r.put_atr_buf.toFixed(2)}x ATR buf, ${r.put_otm_vol_total.toLocaleString()} OTM put vol, MC $${(r.market_cap / 1e9).toFixed(1)}B (${fam}).`,
    });
    if (picks.length >= n) break;
  }
  return { picks, skipped };
}

export function autoPick({ refined_summary, earningsByT, holdStart, holdEnd, n_per_side = 4 }) {
  const callPool = refined_summary
    .filter((r) => r.best_call_strike && r.best_call_iv <= MAX_OPT_IV &&
                   !isEtf(r) && r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
                   r.call_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.call_atr_buf ?? 0) >= MIN_ATR_BUF)
    .filter((r) => {
      const e = earningsByT[r.ticker];
      if (!e || !e.next_date) return true;
      return !(e.next_date >= holdStart && e.next_date <= holdEnd);
    })
    .sort((a, b) => b.best_call_iv - a.best_call_iv);
  const putPool = refined_summary
    .filter((r) => r.best_put_strike && r.best_put_iv <= MAX_OPT_IV &&
                   !isEtf(r) && r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
                   r.put_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.put_atr_buf ?? 0) >= MIN_ATR_BUF)
    .filter((r) => {
      const e = earningsByT[r.ticker];
      if (!e || !e.next_date) return true;
      return !(e.next_date >= holdStart && e.next_date <= holdEnd);
    })
    // For puts we prefer names with real market cap — tier-1 defensives.
    .sort((a, b) => (b.market_cap || 0) - (a.market_cap || 0));

  const call = pickTop({ pool: callPool, side: 'call', n: n_per_side });
  const put  = pickTop({ pool: putPool,  side: 'put',  n: n_per_side, already: new Set(call.picks.map((p) => p.ticker)) });
  return {
    picks: [...call.picks, ...put.picks],
    skipped: { calls: call.skipped, puts: put.skipped },
    pool_counts: { calls: callPool.length, puts: putPool.length },
  };
}
