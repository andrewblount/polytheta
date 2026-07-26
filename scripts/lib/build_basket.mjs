// Generic basket builder — reads chain summary + earnings + tv_macros +
// auto-picks (from lib/shortlist.mjs) and writes basket_proposal.json.
//
// Order of operations mirrors docs/options_trading_system.md:
//   1. GSRS from macro data (it gates put-side sizing, so it comes first)
//   2. Compliant strike re-selection (delta 0.15–0.20, spread <= $0.15,
//      put strikes >= 2x ATR below spot)
//   3. Thesis signals (short interest live; buyback/fan/culture/radar from
//      baskets/thesis_overrides.json when maintained)
//   4. Auto-pick with hard disqualifiers and signal-aware ordering
//   5. GSRS-banded sizing: <3 full puts, 3–5 half puts + no doubles,
//      >=5 no new puts

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { runFilterAndRefine, autoPick, applyCompliantStrikes, MIN_ATR_BUF_PUT, DELTA_MIN, DELTA_MAX, MAX_SPREAD } from './shortlist.mjs';
import { fetchShortInterest, loadOverrides, evaluateSignals } from './thesis_signals.mjs';

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');

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

function nakedMarginPerContract(price, strike, premium, side) {
  const otm = side === 'call' ? Math.max(strike - price, 0) : Math.max(price - strike, 0);
  const a = (0.20 * price - otm) * 100;
  const b = 0.10 * strike * 100;
  return Math.max(a, b) + premium * 100;
}

export async function runBuildBasket({ BASKET_DATE, EXPIRY_ISO, OUT, nameBudget = 55000, nPerSide = 4 }) {
  const HOLD_START = BASKET_DATE;
  const HOLD_END = EXPIRY_ISO;

  const { all: enrichedSummary } = runFilterAndRefine(OUT);
  const chains = readCsv(path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`));
  const macroRows = readCsv(path.join(OUT, 'macro_quotes.csv'));
  const macroByT = Object.fromEntries(macroRows.map((m) => [m.ticker, m]));
  const earningsByT = JSON.parse(fs.readFileSync(path.join(OUT, 'earnings_dates.json'), 'utf8'));

  // TV macros (HY_OAS + PC) — prefer live values from tv_macros.json.
  const TV_CARRY_HY_OAS = 2.86, TV_CARRY_PC = 0.55;
  let HY_OAS = TV_CARRY_HY_OAS, PC = TV_CARRY_PC;
  let tv_macros_source = { hy_oas: 'carried', pc: 'carried' };
  try {
    const tv = JSON.parse(fs.readFileSync(path.join(OUT, 'tv_macros.json'), 'utf8'));
    if (Number.isFinite(tv?.hy_oas?.value)) {
      HY_OAS = tv.hy_oas.value;
      tv_macros_source.hy_oas = `FRED:BAMLH0A0HYM2 ${tv.hy_oas.date}`;
    }
    if (Number.isFinite(tv?.pc_ratio?.total)) {
      PC = tv.pc_ratio.total;
      tv_macros_source.pc = `CBOE total P/C${tv?.pc_ratio?.as_of ? ` ${tv.pc_ratio.as_of}` : ''}`;
    }
  } catch (_) { /* keep carry defaults */ }

  // ---- GSRS first: it gates put-side participation and sizing ----
  const macro = (t) => parseFloat(macroByT[t]?.price);
  const macroPrev = (t) => parseFloat(macroByT[t]?.prev_close);
  const VIX = macro('^VIX'), VIX_prev = macroPrev('^VIX');
  const SPY = macro('SPY'), SPX = macro('^GSPC'), SKEW = macro('^SKEW'), MOVE = macro('^MOVE');
  const vix_change = VIX - VIX_prev;
  const vix_norm = Math.max(0, Math.min(10, (VIX - 10) / 4 + Math.max(0, vix_change) * 0.5));
  const skew_norm = Math.max(0, Math.min(10, (SKEW - 100) / 10));
  const hyoas_avg5 = 3.59;
  const hyoas_norm = Math.max(0, Math.min(10, ((HY_OAS - 1.5) / (hyoas_avg5 - 1.5)) * 5));
  const move_norm = Math.max(0, Math.min(10, (MOVE - 50) / 10));
  const pc_norm = Math.max(0, Math.min(10, (1 - PC) * 7));
  const gsrs = +(0.40 * vix_norm + 0.20 * skew_norm + 0.20 * hyoas_norm + 0.10 * move_norm + 0.10 * pc_norm).toFixed(2);

  // GSRS bands per the spec ("apply strictly to all put-side positions"):
  //   0–3  full sizing, doubles allowed
  //   3–5  halve initial put sizing, prohibit put doubles
  //   5–7  prohibit new put entries
  //   7–10 prohibit new puts + hedge (flagged in the summary)
  let putBudget = nameBudget;
  let putDoublesAllowed = true;
  let putsAllowed = true;
  let gsrsBand = '0-3';
  if (gsrs >= 7) { putsAllowed = false; putDoublesAllowed = false; putBudget = 0; gsrsBand = '7-10'; }
  else if (gsrs >= 5) { putsAllowed = false; putDoublesAllowed = false; putBudget = 0; gsrsBand = '5-7'; }
  else if (gsrs >= 3) { putBudget = Math.round(nameBudget / 2); putDoublesAllowed = false; gsrsBand = '3-5'; }

  // ---- Compliant strike re-selection from the full chain ----
  const chainsByTicker = new Map();
  for (const row of chains) {
    let arr = chainsByTicker.get(row.ticker);
    if (!arr) { arr = []; chainsByTicker.set(row.ticker, arr); }
    arr.push(row);
  }
  const strikeStats = applyCompliantStrikes(enrichedSummary, chainsByTicker);

  // ---- Thesis signals: live short interest + manual overrides ----
  // Fetch SI only for plausible pool members (bounded API load).
  const overrides = loadOverrides(REPO_ROOT);
  const siCandidates = enrichedSummary
    .filter((r) => (r.best_call_strike || r.best_put_strike) && r.avg_volume >= 1_500_000)
    .map((r) => r.ticker);
  const siCache = await fetchShortInterest(
    [...new Set(siCandidates)].slice(0, 120),
    path.join(OUT, 'short_interest.json'),
  );
  // Signal pass/fail thresholds differ per side, so evaluate separately.
  const signalsBySide = { call: {}, put: {} };
  for (const r of enrichedSummary) {
    if (r.best_call_strike) {
      signalsBySide.call[r.ticker] = evaluateSignals({ ticker: r.ticker, side: 'call', siCache, overrides });
    }
    if (r.best_put_strike) {
      signalsBySide.put[r.ticker] = evaluateSignals({ ticker: r.ticker, side: 'put', siCache, overrides });
    }
  }

  const auto = autoPick({
    refined_summary: enrichedSummary,
    earningsByT, holdStart: HOLD_START, holdEnd: HOLD_END, n_per_side: nPerSide,
    signalsBySide, putsAllowed,
  });

  function findStrike(t, type, K) {
    return chains.find((r) => r.ticker === t && r.type === type && parseFloat(r.strike) === K);
  }
  function getSummary(t) { return enrichedSummary.find((s) => s.ticker === t); }
  function earningsConflict(t) {
    const e = earningsByT[t];
    if (!e || !e.next_date) return null;
    return (e.next_date >= HOLD_START && e.next_date <= HOLD_END) ? e.next_date : null;
  }

  const picks = auto.picks;
  const blocked = picks.filter((p) => earningsConflict(p.ticker));
  if (blocked.length) {
    throw new Error(`earnings filter blocked auto-picks — the pool filter should have caught these: ${blocked.map((b) => b.ticker).join(',')}`);
  }

  const enriched = picks.map((p) => {
    const row = findStrike(p.ticker, p.side, p.K);
    const sm = getSummary(p.ticker);
    if (!row || !sm) { console.warn(`missing chain row for ${p.ticker} ${p.K} ${p.side}`); return null; }
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
    const sideBudget = p.side === 'put' ? putBudget : nameBudget;
    const marginPer = nakedMarginPerContract(px, p.K, mid, p.side);
    const contracts = Math.max(1, Math.round(sideBudget / marginPer));
    const margin = Math.round(contracts * marginPer);
    const credit = Math.round(contracts * mid * 100);
    const earningsDate = earningsByT[p.ticker]?.next_date ?? null;
    const spread = +(ask - bid).toFixed(2);
    const absDelta = Math.abs(delta);
    const sig = p.signals ?? null;
    return {
      side: p.side, ticker: p.ticker, family: p.family,
      px: +px.toFixed(2), K: p.K, bid, ask, cr: mid,
      iv: +iv.toFixed(3), delta: +delta.toFixed(3),
      atr: +atr.toFixed(2), buf,
      hvR: Number.isFinite(hvR) ? Math.round(hvR) : null,
      ivAtm: Number.isFinite(ivAtm) ? +ivAtm.toFixed(2) : null,
      earnings_date: earningsDate, earnings_clear: !earningsConflict(p.ticker),
      thesis: p.thesis,
      si_pct: sig?.si_pct ?? null,
      contracts, credit, margin, spread,
      doubles_allowed: p.side === 'put' ? putDoublesAllowed : true,
      rule_checks: {
        delta_band: absDelta >= DELTA_MIN - 1e-9 && absDelta <= DELTA_MAX + 1e-9 ? 'pass' : 'fail',
        atr_buffer: p.side === 'put'
          ? (buf >= MIN_ATR_BUF_PUT ? 'pass' : 'fail')
          : (buf >= 1.0 ? 'pass' : 'fail'),
        spread: spread <= MAX_SPREAD + 1e-9 ? 'pass' : 'fail',
        earnings_clear: earningsConflict(p.ticker) ? 'fail' : 'pass',
        thesis_signals: sig ? sig.checks : null,
        thesis_coverage: sig ? `${sig.known}/5` : '0/5',
        thesis_passed: sig?.passed ?? 0,
        pot_proxy_pct: Math.round(absDelta * 2 * 100), // POT ≈ 2x delta per spec
      },
    };
  }).filter(Boolean);

  const totals = enriched.reduce((acc, r) => {
    if (r.side === 'call') { acc.callCredit += r.credit; acc.callMargin += r.margin; }
    else { acc.putCredit += r.credit; acc.putMargin += r.margin; }
    return acc;
  }, { callCredit: 0, putCredit: 0, callMargin: 0, putMargin: 0 });

  const proposal = {
    basket_date: BASKET_DATE, expiry: EXPIRY_ISO,
    generated_ts: new Date().toISOString(),
    entry_note: `Monday ${BASKET_DATE} entry / Friday ${EXPIRY_ISO} weekly expiry. Auto-generated by scripts/run_weekly_basket.mjs.`,
    hold_window: { start: HOLD_START, end: HOLD_END },
    earnings_filter_applied: true,
    earnings_in_window_count_universe: Object.values(earningsByT)
      .filter((e) => e.next_date && e.next_date >= HOLD_START && e.next_date <= HOLD_END).length,
    macro: {
      SPY: +SPY?.toFixed(2), SPX: +SPX?.toFixed(2),
      VIX: +VIX?.toFixed(2), VIX_prev: +VIX_prev?.toFixed(2), VIX_change_1d: +vix_change?.toFixed(2),
      SKEW: +SKEW?.toFixed(2), MOVE: +MOVE?.toFixed(2), HY_OAS, PC,
    },
    tv_macros_source,
    gsrs_components: {
      vix: +vix_norm.toFixed(2), skew: +skew_norm.toFixed(2),
      hyoas: +hyoas_norm.toFixed(2), move: +move_norm.toFixed(2), pc: +pc_norm.toFixed(2),
    },
    gsrs,
    constraints: {
      gsrs_band: gsrsBand,
      puts_allowed: putsAllowed,
      put_budget: putBudget,
      call_budget: nameBudget,
      put_doubles_allowed: putDoublesAllowed,
      delta_band: [DELTA_MIN, DELTA_MAX],
      max_spread: MAX_SPREAD,
      min_put_atr_buffer: MIN_ATR_BUF_PUT,
      min_otm_volume: 500,
      hedge_recommended: gsrs >= 7,
      strike_reselection: strikeStats,
      signal_sources: {
        short_interest: 'Yahoo defaultKeyStatistics (cached in short_interest.json)',
        overrides_file: 'baskets/thesis_overrides.json',
        overrides_tickers: Object.keys(overrides).length,
      },
    },
    filter_note: 'Strikes re-selected for spec compliance: delta 0.15-0.20, spread <= $0.15, bid > 0, credit >= $0.10, put strikes >= 2x ATR below spot. Earnings inside the hold window excluded. Auto-picks: thesis-signal rank then IV (calls) / market cap (puts), per-family cap of 2, no name repeated across sides. GSRS band applied to put sizing.',
    pool_counts: auto.pool_counts,
    skipped: auto.skipped,
    picks: enriched,
    totals,
  };

  const outFile = path.join(OUT, 'basket_proposal.json');
  fs.writeFileSync(outFile, JSON.stringify(proposal, null, 2));
  return { outFile, gsrs, totals, picks: enriched };
}
