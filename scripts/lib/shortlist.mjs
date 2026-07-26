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

// Screen thresholds. The put-side ATR floor, delta band, spread cap, and OTM
// volume floor come straight from docs/options_trading_system.md — they were
// previously looser than the documented system and every settled losing put
// (6 of 6 through 2026-07-20) had entered below the documented 2x ATR buffer.
export const MAX_OPT_IV = 2.0;
export const MIN_CREDIT = 0.10;
export const MIN_ATR_BUF_CALL = 1.0; // historical practice; spec has no call-side ATR rule
export const MIN_ATR_BUF_PUT = 2.0;  // spec: "at least 2x ATR below current price" — strict
export const DELTA_MIN = 0.15;       // spec: delta 0.15–0.20 far OTM
export const DELTA_MAX = 0.20;
export const MAX_SPREAD = 0.15;      // spec: bid-ask no wider than $0.10–0.15
const MIN_ATM_IV = 0.55;
const MIN_HV_RANK = 55;
const MIN_AVG_VOL = 1_500_000;
const MIN_SIDE_OTM_VOL = 500;        // spec: >=500 contracts ADV on OTM strikes

function highVol(r) {
  return (r.atm_iv ?? 0) >= MIN_ATM_IV || (r.hv_rank ?? 0) >= MIN_HV_RANK;
}

// -----------------------------------------------------------------------------
// Compliant strike re-selection.
//
// chain_summary_v2.csv carries a "best" strike chosen at refresh time by
// nearest-to-0.18 delta with a loose 0.13–0.22 tolerance and no spread or
// ATR-buffer constraint. That drifted outside the documented system (deltas as
// low as 0.117 got in; every settled losing put entered under 2x ATR). Given
// the full chain rows for a ticker, re-select the strike that satisfies ALL
// documented constraints, or return null so the name drops out of the pool.
// -----------------------------------------------------------------------------
export function selectCompliantStrike({ side, price, atr, rows }) {
  if (!Number.isFinite(price) || !Number.isFinite(atr) || atr <= 0) return null;
  const want = side === 'call' ? 'call' : 'put';
  const floor = side === 'call' ? MIN_ATR_BUF_CALL : MIN_ATR_BUF_PUT;
  let best = null;
  for (const r of rows) {
    if (r.type !== want) continue;
    const bid = parseFloat(r.bid), ask = parseFloat(r.ask);
    const strike = parseFloat(r.strike);
    const delta = Math.abs(parseFloat(r.delta_est));
    const iv = parseFloat(r.iv);
    if (!(bid > 0) || !Number.isFinite(ask) || !Number.isFinite(strike) || !Number.isFinite(delta)) continue;
    const spread = ask - bid;
    const mid = (bid + ask) / 2;
    if (spread > MAX_SPREAD + 1e-9) continue;
    if (delta < DELTA_MIN - 1e-9 || delta > DELTA_MAX + 1e-9) continue;
    if (mid < MIN_CREDIT) continue;
    const buf = side === 'call' ? (strike - price) / atr : (price - strike) / atr;
    if (buf < floor - 1e-9) continue;
    // Within the compliant set prefer the richest credit; the delta ceiling
    // already caps how close to the money we can get.
    if (!best || mid > best.mid) {
      best = { strike, mid: +mid.toFixed(3), bid, ask, iv, delta, buf: +buf.toFixed(2), spread: +spread.toFixed(2) };
    }
  }
  return best;
}

// Re-point each summary row's best_call_/best_put_ fields at spec-compliant
// strikes. Names with no compliant strike on a side lose that side entirely.
export function applyCompliantStrikes(summary, chainsByTicker) {
  let callReplaced = 0, putReplaced = 0, callDropped = 0, putDropped = 0;
  for (const r of summary) {
    const rows = chainsByTicker.get(r.ticker) ?? [];
    const call = selectCompliantStrike({ side: 'call', price: r.price, atr: r.atr14, rows });
    const put = selectCompliantStrike({ side: 'put', price: r.price, atr: r.atr14, rows });
    if (call) {
      if (r.best_call_strike !== call.strike) callReplaced++;
      r.best_call_strike = call.strike; r.best_call_credit = call.mid; r.best_call_iv = call.iv;
      r.call_atr_buf = call.buf; r.call_spread = call.spread; r.call_delta = call.delta;
    } else {
      if (r.best_call_strike) callDropped++;
      r.best_call_strike = null; r.best_call_credit = null; r.best_call_iv = null; r.call_atr_buf = null;
    }
    if (put) {
      if (r.best_put_strike !== put.strike) putReplaced++;
      r.best_put_strike = put.strike; r.best_put_credit = put.mid; r.best_put_iv = put.iv;
      r.put_atr_buf = put.buf; r.put_spread = put.spread; r.put_delta = put.delta;
    } else {
      if (r.best_put_strike) putDropped++;
      r.best_put_strike = null; r.best_put_credit = null; r.best_put_iv = null; r.put_atr_buf = null;
    }
  }
  return { callReplaced, putReplaced, callDropped, putDropped };
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

  // Refined shortlist (tighter): spec-aligned floors per side.
  const calls = summary.filter((r) =>
    !isEtf(r) &&
    r.best_call_strike && r.best_call_credit >= MIN_CREDIT && r.best_call_iv <= MAX_OPT_IV &&
    r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
    r.call_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.call_atr_buf ?? 0) >= MIN_ATR_BUF_CALL);
  const puts = summary.filter((r) =>
    !isEtf(r) &&
    r.best_put_strike && r.best_put_credit >= MIN_CREDIT && r.best_put_iv <= MAX_OPT_IV &&
    r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
    r.put_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.put_atr_buf ?? 0) >= MIN_ATR_BUF_PUT);
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
// double-book the same name). Names carrying a hard disqualifier (call-side
// active buyback, triggered radar) never enter the basket.
function pickTop({ pool, side, n = 4, already = new Set(), signalsByT = {} }) {
  const picks = [];
  const skipped = [];
  for (const r of pool) {
    if (already.has(r.ticker)) { skipped.push({ ticker: r.ticker, reason: 'same-name-other-side' }); continue; }
    const sig = signalsByT[r.ticker];
    if (sig?.disqualified) {
      skipped.push({ ticker: r.ticker, reason: side === 'call' ? 'disqualified:buyback-or-radar' : 'disqualified:radar' });
      continue;
    }
    const fam = familyOf(r);
    // Allow at most 2 names per family in the whole basket side.
    const famCount = picks.filter((p) => p.family === fam).length;
    if (famCount >= 2) { skipped.push({ ticker: r.ticker, reason: `family-cap:${fam}` }); continue; }
    picks.push({
      side, ticker: r.ticker, family: fam,
      K: side === 'call' ? r.best_call_strike : r.best_put_strike,
      signals: sig ?? null,
      thesis: side === 'call'
        ? `Auto: ${(r.best_call_iv * 100).toFixed(0)}% option IV, ${r.call_atr_buf.toFixed(2)}x ATR buf, ${r.call_otm_vol_total.toLocaleString()} OTM call vol, MC $${(r.market_cap / 1e9).toFixed(1)}B (${fam}).`
        : `Auto: ${(r.best_put_iv * 100).toFixed(0)}% option IV, ${r.put_atr_buf.toFixed(2)}x ATR buf, ${r.put_otm_vol_total.toLocaleString()} OTM put vol, MC $${(r.market_cap / 1e9).toFixed(1)}B (${fam}).`,
    });
    if (picks.length >= n) break;
  }
  return { picks, skipped };
}

export function autoPick({ refined_summary, earningsByT, holdStart, holdEnd, n_per_side = 4, signalsBySide = { call: {}, put: {} }, putsAllowed = true }) {
  const noEarnings = (r) => {
    const e = earningsByT[r.ticker];
    if (!e || !e.next_date) return true;
    return !(e.next_date >= holdStart && e.next_date <= holdEnd);
  };
  // Signal-aware ordering: names with more confirmed thesis signals rank
  // first; ties break on the side's original criterion (IV for calls,
  // market cap for puts). Unknown signals contribute nothing either way.
  const signalRank = (side, t) => signalsBySide[side]?.[t]?.passed ?? 0;

  const callPool = refined_summary
    .filter((r) => r.best_call_strike && r.best_call_iv <= MAX_OPT_IV &&
                   !isEtf(r) && r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
                   r.call_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.call_atr_buf ?? 0) >= MIN_ATR_BUF_CALL)
    .filter(noEarnings)
    .sort((a, b) => (signalRank('call', b.ticker) - signalRank('call', a.ticker)) || (b.best_call_iv - a.best_call_iv));
  const putPool = !putsAllowed ? [] : refined_summary
    .filter((r) => r.best_put_strike && r.best_put_iv <= MAX_OPT_IV &&
                   !isEtf(r) && r.avg_volume >= MIN_AVG_VOL && highVol(r) &&
                   r.put_otm_vol_total >= MIN_SIDE_OTM_VOL && (r.put_atr_buf ?? 0) >= MIN_ATR_BUF_PUT)
    .filter(noEarnings)
    // For puts we prefer names with real market cap — tier-1 defensives.
    .sort((a, b) => (signalRank('put', b.ticker) - signalRank('put', a.ticker)) || ((b.market_cap || 0) - (a.market_cap || 0)));

  const call = pickTop({ pool: callPool, side: 'call', n: n_per_side, signalsByT: signalsBySide.call });
  const put  = pickTop({ pool: putPool,  side: 'put',  n: n_per_side, signalsByT: signalsBySide.put, already: new Set(call.picks.map((p) => p.ticker)) });
  return {
    picks: [...call.picks, ...put.picks],
    skipped: { calls: call.skipped, puts: put.skipped },
    pool_counts: { calls: callPool.length, puts: putPool.length },
  };
}
