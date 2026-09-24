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
import { scanRadar } from './news_radar.mjs';
import { calculateGsrs } from '../../shared/gsrs.mjs';
import { DEFAULT_BROKER_SETTINGS, validateBrokerSettings, basketCounts, isExcluded, sizingBacking } from '../../shared/broker-settings.mjs';
import { minimumOtmFor, otmPercent } from '../../shared/strike-settings.mjs';
import { firstSessionOfWeek, easternTime } from '../../shared/market-calendar.mjs';
import { entrySchedule } from '../../shared/entry-schedule.mjs';
import { preparationPolicy } from './finalize_basket.mjs';
import { resolveModelEquity, accountEquityReference } from '../../shared/model-equity.mjs';
import { pickSummary } from '../../shared/basket-thesis.mjs';

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

// Solve affordability before publishing a basket. Reducing the basket count
// increases each equal allocation, but may never change the configured split.
export function selectAffordableBasket({ settings, modelEquity, gsrs, select }) {
  for (let total = settings.maxTrades; total > 0; total--) {
    const counts = basketCounts({ ...settings, maxTrades: total });
    if (counts.total !== total) continue;
    const baseScale = gsrs >= 3 && counts.puts ? 0.5 : 1;
    // Notional backing: equity × share traded × margin available, split equally.
    const allocation = scale => sizingBacking(modelEquity, settings) * scale / total;
    let auto = select(counts, allocation(baseScale));
    if (auto.picks.length !== total) continue;
    if (auto.picks.some(pick => pick.frenzy === 'elevated')) auto = select(counts, allocation(baseScale * 0.5));
    if (auto.picks.filter(pick => pick.side === 'call').length !== counts.calls || auto.picks.filter(pick => pick.side === 'put').length !== counts.puts) continue;
    const allocationScale = baseScale * (auto.picks.some(pick => pick.frenzy === 'elevated') ? 0.5 : 1);
    return { auto, picks: auto.picks, allocationScale, backingPerTrade: allocation(allocationScale) };
  }
  return { auto: { picks: [], skipped: { calls: [], puts: [] }, pool_counts: { calls: 0, puts: 0 } }, picks: [], allocationScale: 1, backingPerTrade: 0 };
}

// `now` and `frozen` support after-the-fact rebuilds from a saved snapshot:
// age checks are evaluated at the snapshot's own time and cached signal files
// are used as they were, never refetched.
export async function runBuildBasket({ BASKET_DATE, EXPIRY_ISO, OUT, nameBudget = 55000, nPerSide = 4, brokerSettings = DEFAULT_BROKER_SETTINGS, brokerEquity = null, outFileName = 'basket_proposal.json', now = new Date(), frozen = false }) {
  // brokerSettings may carry the model policy overlay (shared/model-settings.mjs
  // modelPolicy): its modelEquity is read before validation strips it.
  const equity = resolveModelEquity({ settings: brokerSettings });
  const settings = validateBrokerSettings(brokerSettings);
  const schedule = entrySchedule(BASKET_DATE, settings);
  if (EXPIRY_ISO !== schedule.expiry) throw new Error('Basket expiry does not match the selected exchange week');
  const HOLD_START = schedule.date;
  const HOLD_END = EXPIRY_ISO;

  const { all } = runFilterAndRefine(OUT);
  const enrichedSummary = all.filter(row => !isExcluded(row, settings));
  const chains = readCsv(path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`));
  const macroRows = readCsv(path.join(OUT, 'macro_quotes.csv'));
  const macroByT = Object.fromEntries(macroRows.map((m) => [m.ticker, m]));
  const earningsByT = JSON.parse(fs.readFileSync(path.join(OUT, 'earnings_dates.json'), 'utf8'));

  const tv = JSON.parse(fs.readFileSync(path.join(OUT, 'tv_macros.json'), 'utf8'));
  const HY_OAS = tv.hy_oas?.value, PC = tv.pc_ratio?.total;
  const tvAge = +now - Date.parse(tv.fetched_ts);
  if (!Number.isFinite(HY_OAS) || HY_OAS <= 0 || !Number.isFinite(PC) || PC <= 0 || tv.error ||
      !Number.isFinite(tvAge) || tvAge < -60000 || tvAge > 2 * 3600000) throw new Error('Macro inputs are unavailable or stale; retry data import');
  const tv_macros_source = { hy_oas: `FRED:BAMLH0A0HYM2 ${tv.hy_oas.date}`, pc: `CBOE ${tv.pc_ratio.as_of}` };
  const refresh = JSON.parse(fs.readFileSync(path.join(OUT, 'data_refresh.json'), 'utf8'));
  const refreshAge = +now - Date.parse(refresh.started_at);
  if (refresh.expiry !== EXPIRY_ISO || !Number.isFinite(refreshAge) || refreshAge < -60000 || refreshAge > 2 * 3600000) throw new Error('Yahoo source snapshot is stale');

  // ---- GSRS first: it gates put-side participation and sizing ----
  const macro = (t) => parseFloat(macroByT[t]?.price);
  const macroPrev = (t) => parseFloat(macroByT[t]?.prev_close);
  const VIX = macro('^VIX'), VIX_prev = macroPrev('^VIX');
  const SPY = macro('SPY'), SPX = macro('^GSPC'), SKEW = macro('^SKEW'), MOVE = macro('^MOVE');
  if (![SPY, SPX, VIX, VIX_prev, SKEW, MOVE].every(x => Number.isFinite(x) && x > 0)) throw new Error('Missing required Yahoo macro values');
  const vix_change = VIX - VIX_prev;
  const score = calculateGsrs({ VIX, VIX_prev, SKEW, HY_OAS, MOVE, PC });
  const { vix: vix_norm, skew: skew_norm, hyoas: hyoas_norm, move: move_norm, pc: pc_norm } = score.components;
  const gsrs = score.score;

  // GSRS bands per the spec ("apply strictly to all put-side positions"):
  //   0–3  full sizing, doubles allowed
  //   3–5  halve initial put sizing, prohibit put doubles
  //   5–7  prohibit new put entries
  //   7–10 prohibit new puts + hedge (flagged in the summary)
  let putBudget = nameBudget;
  let putDoublesAllowed = false;
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
  const strikeStats = applyCompliantStrikes(enrichedSummary, chainsByTicker, (ticker, side) => minimumOtmFor(settings, ticker, side, EXPIRY_ISO));

  // ---- Thesis signals: live short interest + manual overrides ----
  // Fetch SI only for plausible pool members (bounded API load).
  const overrides = loadOverrides(REPO_ROOT);
  const siCandidates = enrichedSummary
    .filter((r) => (r.best_call_strike || r.best_put_strike) && r.avg_volume >= 1_500_000)
    .map((r) => r.ticker);
  const boundedCandidates = [...new Set(siCandidates)].slice(0, 120);
  const siCache = await fetchShortInterest(
    boundedCandidates,
    path.join(OUT, 'short_interest.json'),
    { now, frozen },
  );
  // Pre-entry news radar: fresh M&A chatter disqualifies call candidates,
  // fresh downside-gap news disqualifies put candidates. Clean scans feed
  // the thesis scorecard (manual overrides still win).
  const radarCache = await scanRadar(boundedCandidates, path.join(OUT, 'news_radar.json'), { names: Object.fromEntries(enrichedSummary.map(r => [r.ticker, r.name ?? ''])), now, frozen });
  const autoRadarFor = (ticker, side) => {
    const scan = radarCache[ticker];
    if (!scan || scan.error) return null;
    return (scan[side] ?? []).length > 0 ? 'triggered' : 'clean';
  };
  // Signal pass/fail thresholds differ per side, so evaluate separately.
  const signalsBySide = { call: {}, put: {} };
  for (const r of enrichedSummary) {
    if (r.best_call_strike) {
      signalsBySide.call[r.ticker] = evaluateSignals({
        ticker: r.ticker, side: 'call', siCache, overrides,
        autoRadar: autoRadarFor(r.ticker, 'call'),
      });
    }
    if (r.best_put_strike) {
      signalsBySide.put[r.ticker] = evaluateSignals({
        ticker: r.ticker, side: 'put', siCache, overrides,
        autoRadar: autoRadarFor(r.ticker, 'put'),
      });
    }
  }

  // The model sizes against model equity only. The account it will later be
  // compared with is recorded for reference and never affects selection.
  const modelEquity = equity.modelEquity;
  const accountReference = accountEquityReference(brokerEquity);
  console.log(`[basket ${BASKET_DATE}] model equity ${modelEquity.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} (${equity.source})${accountReference ? `; account reference ${accountReference.mode ?? ''} ${accountReference.netLiquidation.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} as of ${accountReference.observedAt}` : ''}`);
  const { auto, picks, allocationScale, backingPerTrade } = selectAffordableBasket({ settings, modelEquity, gsrs,
    select: (counts, perTrade) => autoPick({
      refined_summary: enrichedSummary.map(row => ({ ...row,
        best_call_strike: Math.max(Number(row.price), Number(row.best_call_strike)) * 100 <= perTrade ? row.best_call_strike : null,
        best_put_strike: Math.max(Number(row.price), Number(row.best_put_strike)) * 100 <= perTrade ? row.best_put_strike : null,
      })),
      earningsByT, holdStart: HOLD_START, holdEnd: HOLD_END, n_per_side: nPerSide, callCount: counts.calls, putCount: counts.puts,
      signalsBySide, putsAllowed,
    }),
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

  const blocked = picks.filter((p) => earningsConflict(p.ticker));
  if (blocked.length) {
    throw new Error(`earnings filter blocked auto-picks — the pool filter should have caught these: ${blocked.map((b) => b.ticker).join(',')}`);
  }

  const enriched = picks.map((p) => {
    const row = findStrike(p.ticker, p.side, p.K);
    const sm = getSummary(p.ticker);
    if (!row || !sm) throw new Error(`Selected trade lost its source chain: ${p.ticker} ${p.K} ${p.side}`);
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
    // Frenzy guard: elevated pre-entry thrust halves the allocation (mirrors
    // the spec's Fan-Score >= 8 half-sizing rule, applied mechanically).
    const sideBudget = backingPerTrade;
    const marginPer = nakedMarginPerContract(px, p.K, mid, p.side);
    const contracts = Math.floor(sideBudget / (Math.max(px, p.K) * 100));
    if (contracts < 1) throw new Error(`Selected trade exceeds its equal capital allocation: ${p.ticker}`);
    const margin = Math.round(contracts * marginPer);
    const credit = Math.round(contracts * mid * 100);
    const earningsDate = earningsByT[p.ticker]?.next_date ?? null;
    const spread = +(ask - bid).toFixed(2);
    const absDelta = Math.abs(delta);
    const sig = p.signals ?? null;
    return {
      side: p.side, ticker: p.ticker, family: p.family,
      // Company name drives Google Alert queries — a bare ticker is useless
      // as a news query ("SLS" is also the Space Launch System).
      name: sm.name && sm.name !== p.ticker ? sm.name : null,
      px: +px.toFixed(2), K: p.K, bid, ask, cr: mid,
      pricing_reference: { observedAt: row.chain_received_at ?? sm.chain_received_at ?? refresh.started_at, underlyingObservedAt: row.underlying_observed_at ?? sm.underlying_observed_at ?? null,
        observationBasis: row.chain_received_at ? 'Yahoo chain response received' : 'legacy refresh start; exact quote time unavailable', ticker: p.ticker,
        spot: px, iv, vix: VIX, vixObservedAt: macroByT['^VIX']?.market_time ?? null, credit: mid, strike: p.K, side: p.side, expiry: EXPIRY_ISO },
      minimum_otm_pct: minimumOtmFor(settings, p.ticker, p.side, EXPIRY_ISO),
      entry_otm_pct: +otmPercent(p.side, p.K, px).toFixed(3),
      iv: +iv.toFixed(3), delta: +delta.toFixed(3),
      atr: +atr.toFixed(2), buf,
      hvR: Number.isFinite(hvR) ? Math.round(hvR) : null,
      ivAtm: Number.isFinite(ivAtm) ? +ivAtm.toFixed(2) : null,
      earnings_date: earningsDate, earnings_clear: !earningsConflict(p.ticker),
      thesis: p.thesis,
      thesis_summary: null, // filled after enrichment below
      si_pct: sig?.si_pct ?? null,
      contracts, credit, margin, spread,
      allocated_capital: backingPerTrade,
      capital_backing: contracts * Math.max(px, p.K) * 100,
      credit_at_bid: Math.round(contracts * bid * 100),
      midpoint_to_bid_cost: Math.round(contracts * (mid - bid) * 100),
      pricing_basis: "modeled midpoint; executable credit requires broker fill",
      doubles_allowed: false,
      frenzy: p.frenzy ?? 'unknown',
      mom: p.mom ?? null,
      rule_checks: {
        frenzy_guard: p.frenzy === 'elevated' ? 'half-size' : p.frenzy ?? 'unknown',
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
  for (const row of enriched) row.thesis_summary = pickSummary(row);

  const totals = enriched.reduce((acc, r) => {
    if (r.side === 'call') { acc.callCredit += r.credit; acc.callMargin += r.margin; }
    else { acc.putCredit += r.credit; acc.putMargin += r.margin; }
    return acc;
  }, { callCredit: 0, putCredit: 0, callMargin: 0, putMargin: 0 });

  const proposal = {
    basket_date: BASKET_DATE, entry_date: schedule.date, first_session: firstSessionOfWeek(BASKET_DATE), expiry: EXPIRY_ISO,
    phase: 'prepared', preparation_policy: preparationPolicy(settings),
    entry_window: { start: schedule.start.toISOString(), end: schedule.end.toISOString() },
    data_observed_at: refresh.started_at,
    policy: 'v3-news-only-no-doubling',
    allocation_settings: settings, allocation_scale: allocationScale, model_equity: modelEquity,
    model_equity_source: equity.source, model_equity_observed_at: equity.observedAt,
    sizing: { accountTradedPct: settings.entryCapitalPct, marginAvailablePct: settings.marginAvailablePct, sellCalls: settings.sellCalls, sellPuts: settings.sellPuts, backing: sizingBacking(modelEquity, settings) },
    account_equity_reference: accountReference,
    data_provenance: 'live-snapshot',
    total_backing_capital: picks.length * backingPerTrade,
    gsrs_calculation: score,
    generated_ts: now.toISOString(),
    entry_note: `Week ${BASKET_DATE}; entry ${schedule.date}; exchange-adjusted expiry ${EXPIRY_ISO}. Auto-generated by scripts/run_weekly_basket.mjs.`,
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
        news_radar: 'Yahoo headlines, 96h lookback, keyword match (cached in news_radar.json); hits disqualify',
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

  const outFile = path.join(OUT, outFileName);
  fs.writeFileSync(outFile, JSON.stringify(proposal, null, 2));
  return { outFile, gsrs, totals, picks: enriched };
}
