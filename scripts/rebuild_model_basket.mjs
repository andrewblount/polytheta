#!/usr/bin/env node
// Rebuild a week's MODEL basket after the fact from the option-chain snapshot
// the model captured at the time, then publish it with honest provenance.
//
// Two shapes:
//   1. A prepared basket already exists (the selection the model made) and the
//      same snapshot holds the quotes it was priced from:
//        --prepared <prepared_basket.json> --snapshot <data dir> --entry-time <ISO>
//   2. Only a research snapshot exists: rebuild the selection from it at the
//      time it was taken, then price the entry from intraday underlying bars
//      (Yahoo 5-minute history) and the model's VIX-ratio IV approximation:
//        --snapshot <data dir> --prepared-time <ISO> --entry-time <ISO> --intraday
//
// Common: --week YYYY-MM-DD  [--exclude T1,T2] [--publish] [--out <dir>]
//         [--macro-file macro_quotes.csv] [--tv-file tv_macros.json]
//         [--note "why this rebuild exists"]
//
// The result is a final proposal with data_provenance 'rebuilt-from-snapshot',
// `late` set from the entry time, and a `reconstruction` block that says what
// was observed and what was modeled. Nothing here touches IB.
import fs from 'node:fs';
import path from 'node:path';
import { createYahooClient } from './lib/yahoo_client.mjs';
import { runFilterAndRefine } from './lib/shortlist.mjs';
import { runBuildBasket } from './lib/build_basket.mjs';
import { runEarnings } from './lib/earnings.mjs';
import { preparationPolicy } from './lib/finalize_basket.mjs';
import { importProposal } from './lib/import_proposal.mjs';
import { loadModelPolicy } from './lib/broker_settings.mjs';
import { WEEKLYS_SOURCE } from './lib/refresh.mjs';
import { validateBrokerSettings, basketCounts, isExcluded, normalizeExclusions, sizingBacking } from '../shared/broker-settings.mjs';
import { modelPolicy } from '../shared/model-settings.mjs';
import { entrySchedule } from '../shared/entry-schedule.mjs';
import { repriceEntry, pricingReference, optionDelta } from '../shared/entry-pricing.mjs';
import { easternTime, sessionClose } from '../shared/market-calendar.mjs';
import { minimumOtmFor, otmPercent } from '../shared/strike-settings.mjs';
import { calculateGsrs } from '../shared/gsrs.mjs';
import { basketThesis } from '../shared/basket-thesis.mjs';

const root = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
const arg = key => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : undefined;
const flag = key => process.argv.includes(key);
if (flag('--help') || !arg('--week') || !arg('--snapshot') || !arg('--entry-time')) {
  console.log('Usage: node scripts/rebuild_model_basket.mjs --week YYYY-MM-DD --snapshot <dir> --entry-time <ISO> (--prepared <file> | --prepared-time <ISO> --intraday) [--exclude A,B] [--publish] [--out <dir>] [--note "..."]');
  process.exit(flag('--help') ? 0 : 1);
}
const week = arg('--week'), snapshot = path.resolve(arg('--snapshot')), entryTime = new Date(arg('--entry-time'));
if (!Number.isFinite(+entryTime)) throw new Error('Invalid --entry-time');
const outDir = path.resolve(arg('--out') ?? path.join(root, 'baskets', week, 'rebuild', entryTime.toISOString().replaceAll(':', '-')));
const OUT = path.join(outDir, 'data');
fs.mkdirSync(OUT, { recursive: true });

const readCsv = file => {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const header = lines[0].split(',');
  return lines.slice(1).map(line => {
    const cells = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') inQ = false; else cur += c; }
      else if (c === '"') inQ = true; else if (c === ',') { cells.push(cur); cur = ''; } else cur += c;
    }
    cells.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
  });
};
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const num = x => { const n = Number(x); return Number.isFinite(n) ? n : null; };

// ---- settings: the current model policy, plus any exclusions in force that week
const base = flag('--default-settings') ? modelPolicy(validateBrokerSettings({}), {}) : await loadModelPolicy();
const excluded = normalizeExclusions([...(base.excludedTickers ?? []), ...(arg('--exclude') ? arg('--exclude').split(',') : [])]);
const settings = validateBrokerSettings({ ...base, excludedTickers: excluded });
const modelEquityOverlay = base.modelEquity;
const schedule = entrySchedule(week, settings);
const expiry = schedule.expiry;
if (+entryTime < +schedule.start || easternTime(entryTime).date >= expiry) throw new Error(`--entry-time must be within the week's model window (${schedule.start.toISOString()} .. before ${expiry})`);
const late = +entryTime >= +schedule.end;
const lateMinutes = late ? Math.round((+entryTime - +schedule.end) / 60000) : 0;

// ---- stage the snapshot files the builder reads
for (const file of fs.readdirSync(snapshot)) {
  const from = path.join(snapshot, file);
  if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(OUT, file));
}
const parentData = path.resolve(snapshot, '..', '..'); // refresh_history/<ts> -> data
for (const file of ['tv_macros.json', 'earnings_dates.json', 'short_interest.json', 'news_radar.json', 'weeklys_universe.csv', 'weeklys_universe_source.json', 'macro_quotes.csv']) {
  if (!fs.existsSync(path.join(OUT, file)) && fs.existsSync(path.join(parentData, file))) fs.copyFileSync(path.join(parentData, file), path.join(OUT, file));
}
for (const [key, file] of [['--macro-file', 'macro_quotes.csv'], ['--tv-file', 'tv_macros.json'], ['--earnings-file', 'earnings_dates.json'], ['--radar-file', 'news_radar.json'], ['--si-file', 'short_interest.json'], ['--universe-file', 'weeklys_universe.csv']]) {
  if (arg(key)) fs.copyFileSync(path.resolve(arg(key)), path.join(OUT, file));
}
const refresh = readJson(path.join(OUT, 'data_refresh.json'));
if (refresh.expiry !== expiry) throw new Error(`Snapshot expiry ${refresh.expiry} does not match week ${week} (${expiry})`);
const chainFile = path.join(OUT, `chains_${expiry}_v2.csv`);
const chains = readCsv(chainFile);
const summary = Object.fromEntries(readCsv(path.join(OUT, 'chain_summary_v2.csv')).map(r => [r.ticker, r]));
const snapshotObservedAt = refresh.completed_at ?? refresh.started_at;

// ---- 1) the prepared basket: given, or rebuilt from the snapshot
let prepared;
const notes = [];
if (arg('--prepared')) {
  prepared = readJson(path.resolve(arg('--prepared')));
  if (prepared.basket_date !== week || prepared.expiry !== expiry) throw new Error('Prepared basket belongs to another week');
  prepared = { ...prepared, preparation_policy: preparationPolicy(settings), allocation_settings: settings };
  const dropped = prepared.picks.filter(p => isExcluded(p, settings));
  if (dropped.length) { notes.push(`Excluded at rebuild: ${dropped.map(p => p.ticker).join(', ')}`); prepared.picks = prepared.picks.filter(p => !isExcluded(p, settings)); }
  notes.push(`Selection: the model's own prepared basket generated ${prepared.generated_ts}`);
} else {
  const preparedTime = new Date(arg('--prepared-time') ?? snapshotObservedAt);
  if (!Number.isFinite(+preparedTime)) throw new Error('Invalid --prepared-time');
  // Universe source metadata must exist for the builder; the snapshot's list is the record.
  const sourceFile = path.join(OUT, 'weeklys_universe_source.json');
  if (!fs.existsSync(sourceFile)) fs.writeFileSync(sourceFile, JSON.stringify({ source: WEEKLYS_SOURCE, fetched_at: preparedTime.toISOString(), count: fs.readFileSync(path.join(OUT, 'weeklys_universe.csv'), 'utf8').trim().split(/\r?\n/).length - 1, rebuilt: true }));
  // Macro inputs are checked for freshness against the preparation time.
  const tv = readJson(path.join(OUT, 'tv_macros.json'));
  const tvAge = +preparedTime - Date.parse(tv.fetched_ts);
  if (!Number.isFinite(tvAge) || tvAge < -60000 || tvAge > 2 * 3600000) { tv.fetched_ts = preparedTime.toISOString(); tv.rebuilt_note = 'fetched_ts set to the preparation time; hy_oas.date and pc_ratio.as_of are the original publication dates'; fs.writeFileSync(path.join(OUT, 'tv_macros.json'), JSON.stringify(tv, null, 2)); notes.push(`Macro feed (HY OAS ${tv.hy_oas?.date}, P/C ${tv.pc_ratio?.as_of}) taken from the week's saved download`); }
  const refreshAge = +preparedTime - Date.parse(refresh.started_at);
  if (!Number.isFinite(refreshAge) || refreshAge < 0 || refreshAge > 2 * 3600000) throw new Error(`--prepared-time must be within two hours after the snapshot start ${refresh.started_at}`);
  runFilterAndRefine(OUT);
  // Caches that did not survive the week are reconstructed where possible and disclosed.
  if (arg('--earnings-from')) {
    const merged = { ...(fs.existsSync(path.join(OUT, 'earnings_dates.json')) ? readJson(path.join(OUT, 'earnings_dates.json')) : {}) };
    for (const file of arg('--earnings-from').split(',')) for (const [t, row] of Object.entries(readJson(path.resolve(file)))) if (row?.next_date && !merged[t]?.next_date) merged[t] = row;
    fs.writeFileSync(path.join(OUT, 'earnings_dates.json'), JSON.stringify(merged, null, 2));
    notes.push(`Earnings dates merged from ${arg('--earnings-from')}`);
  }
  if (flag('--fetch-earnings')) {
    const r = await runEarnings({ OUT, now: preparedTime });
    notes.push(`Earnings dates for ${r.fetched} shortlist names were not on file for this week and were fetched at rebuild time (current calendar; a print inside the hold window that has since passed cannot be detected this way)`);
  }
  if (flag('--assume-radar-clean')) {
    const radarFile = path.join(OUT, 'news_radar.json');
    const radar = fs.existsSync(radarFile) ? readJson(radarFile) : {};
    let repaired = 0;
    for (const t of readCsv(path.join(OUT, 'shortlist_calls_refined.csv')).map(r => r.ticker).concat(readCsv(path.join(OUT, 'shortlist_puts_refined.csv')).map(r => r.ticker))) {
      if (!radar[t] || radar[t].error) { radar[t] = { call: [], put: [], checked_at: preparedTime.toISOString(), reconstructed: true }; repaired++; }
    }
    fs.writeFileSync(radarFile, JSON.stringify(radar, null, 2));
    notes.push(`News radar: ${repaired} scans were missing or failed that week and are treated as clean for this rebuild (no historical news scan is available)`);
  }
  const result = await runBuildBasket({ BASKET_DATE: week, EXPIRY_ISO: expiry, OUT, brokerSettings: { ...settings, modelEquity: modelEquityOverlay }, outFileName: 'prepared_basket.json', now: preparedTime, frozen: true });
  prepared = readJson(result.outFile);
  if (!prepared.picks.length) throw new Error('The snapshot yields no qualifying basket');
  notes.push(`Selection rebuilt from the ${refresh.synthetic ? 'synthetic' : 'observed'} snapshot at ${snapshotObservedAt}, preparation time ${preparedTime.toISOString()} (signals and news as cached that week)`);
}
prepared.model_equity_source ??= 'env-override';

// ---- 2) entry inputs: observed from the snapshot, or intraday + VIX-ratio model
const yf = createYahooClient();
async function intradayAt(symbol, at) {
  const day = easternTime(at).date;
  const chart = await yf.chart(symbol, { period1: day, period2: new Date(+new Date(`${day}T00:00:00Z`) + 2 * 86400000).toISOString().slice(0, 10), interval: '5m' });
  const bars = (chart.quotes ?? []).filter(q => q.close != null && +new Date(q.date) < +at); // a bar dated t closes at t+5m; the last bar strictly before `at` closes at or before it
  if (!bars.length) throw new Error(`${symbol}: no intraday bar at or before ${at.toISOString()}`);
  const bar = bars.at(-1);
  return { price: bar.close, observedAt: new Date(bar.date).toISOString() };
}
async function dailyOn(symbol, day) {
  const chart = await yf.chart(symbol, { period1: new Date(+new Date(`${day}T00:00:00Z`) - 10 * 86400000).toISOString().slice(0, 10), period2: new Date(+new Date(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), interval: '1d' });
  const bars = (chart.quotes ?? []).filter(q => q.close != null && new Date(q.date).toISOString().slice(0, 10) <= day);
  if (bars.length < 2) throw new Error(`${symbol}: no daily bars through ${day}`);
  return { close: bars.at(-1).close, prevClose: bars.at(-2).close, date: new Date(bars.at(-1).date).toISOString().slice(0, 10) };
}
const macroRows = Object.fromEntries(readCsv(path.join(OUT, 'macro_quotes.csv')).map(r => [r.ticker, r]));
const tv = readJson(path.join(OUT, 'tv_macros.json'));
const snapshotFresh = Math.abs(+entryTime - Date.parse(snapshotObservedAt)) <= 20 * 60000;
let macro, entryQuotes = {}, quoteBasis;
if (flag('--intraday') || !snapshotFresh) {
  const entryDay = easternTime(entryTime).date;
  const [spy, spx, vix, skew, move] = await Promise.all([intradayAt('SPY', entryTime), intradayAt('^GSPC', entryTime), intradayAt('^VIX', entryTime), dailyOn('^SKEW', entryDay), dailyOn('^MOVE', entryDay)]);
  const vixDaily = await dailyOn('^VIX', entryDay);
  macro = { SPY: spy.price, SPX: spx.price, VIX: vix.price, VIX_prev: vixDaily.prevClose, SKEW: skew.close, MOVE: move.close, HY_OAS: tv.hy_oas?.value, PC: tv.pc_ratio?.total };
  quoteBasis = 'modeled';
  for (const p of prepared.picks) {
    const spot = await intradayAt(p.ticker, entryTime);
    entryQuotes[`${p.ticker}:${p.side}:${p.K}`] = { spot: spot.price, spotObservedAt: spot.observedAt, optionIv: null, bid: null, ask: null, quoteObservedAt: spot.observedAt, source: 'modeled: dated reference repriced with intraday underlying and VIX-ratio IV (no option quote survived for this time)' };
  }
  notes.push(`Entry priced at ${entryTime.toISOString()} from Yahoo 5-minute underlying bars and the model's VIX-ratio IV approximation; option bid/ask at entry were not observed`);
} else {
  const m = t => num(macroRows[t]?.price), mp = t => num(macroRows[t]?.prev_close);
  macro = { SPY: m('SPY'), SPX: m('^GSPC'), VIX: m('^VIX'), VIX_prev: mp('^VIX'), SKEW: m('^SKEW'), MOVE: m('^MOVE'), HY_OAS: tv.hy_oas?.value, PC: tv.pc_ratio?.total };
  quoteBasis = 'observed';
  for (const p of prepared.picks) {
    const row = chains.find(r => r.ticker === p.ticker && r.type === p.side && Number(r.strike) === Number(p.K));
    const s = summary[p.ticker];
    if (!row || !s) throw new Error(`${p.ticker} ${p.K} ${p.side}: contract missing from the snapshot chain`);
    entryQuotes[`${p.ticker}:${p.side}:${p.K}`] = { spot: num(s.price), spotObservedAt: s.underlying_observed_at ?? row.underlying_observed_at, optionIv: num(row.iv), bid: num(row.bid), ask: num(row.ask), quoteObservedAt: row.chain_received_at, source: 'Yahoo Finance (snapshot)' };
  }
  notes.push(refresh.synthetic ? `Entry priced from the modeled option quotes of the synthetic snapshot at ${snapshotObservedAt}` : `Entry priced from the option quotes observed in the snapshot at ${snapshotObservedAt}`);
}
if (!Object.values(macro).every(v => Number.isFinite(v) && v > 0)) throw new Error(`Macro inputs incomplete: ${JSON.stringify(macro)}`);

// ---- 3) finalize: the same contract math as scripts/lib/finalize_basket.mjs,
// applied to the rebuilt inputs. Mirrors finalizeBasket; keep them aligned.
const score = calculateGsrs(macro);
const counts = basketCounts(settings, prepared.picks.filter(p => p.side === 'call').length, prepared.picks.filter(p => p.side === 'put').length);
if (counts.total !== prepared.picks.length) { notes.push(`Basket trimmed to the configured split: ${counts.total} of ${prepared.picks.length}`); prepared.picks = [...prepared.picks.filter(p => p.side === 'call').slice(0, counts.calls), ...prepared.picks.filter(p => p.side === 'put').slice(0, counts.puts)]; }
if (score.score >= 5 && counts.puts) throw new Error('GSRS at entry prohibits puts; the prepared basket does not satisfy the rules');
const scale = (score.score >= 3 && counts.puts ? .5 : 1) * (prepared.picks.some(p => p.frenzy === 'elevated') ? .5 : 1);
const capital = sizingBacking(prepared.model_equity, settings) * scale / counts.total;
const asOf = entryTime;
const disqualified = [];
const picks = prepared.picks.map(p => {
  const q = entryQuotes[`${p.ticker}:${p.side}:${p.K}`];
  const reference = pricingReference(p, prepared);
  const pricing = repriceEntry({ reference, spot: q.spot, optionIv: q.optionIv, vix: macro.VIX, now: asOf, settings });
  const delta = optionDelta({ spot: q.spot, strike: p.K, years: (+sessionClose(expiry) - +asOf) / (365 * 86400000), iv: pricing.iv, rate: settings.modelRiskFreeRatePct / 100, side: p.side });
  const buffer = (p.side === 'call' ? p.K - q.spot : q.spot - p.K) / p.atr;
  const problems = [];
  if (Math.abs(delta) < .15 - 1e-9 || Math.abs(delta) > .20 + 1e-9) problems.push(`delta ${delta.toFixed(3)} outside 0.15–0.20`);
  if (buffer < (p.side === 'put' ? 2 : 1)) problems.push(`ATR buffer ${buffer.toFixed(2)}`);
  if (otmPercent(p.side, p.K, q.spot) + 1e-9 < minimumOtmFor(settings, p.ticker, p.side, expiry)) problems.push('below minimum OTM');
  if (pricing.credit < .1) problems.push(`credit ${pricing.credit.toFixed(3)} below $0.10`);
  const bid = q.bid ?? +Math.max(0.01, pricing.credit - (p.spread ?? 0.05) / 2).toFixed(2), ask = q.ask ?? +(bid + (p.spread ?? 0.05)).toFixed(2);
  if (!(bid > 0) || ask < bid || ask - bid > settings.maxEntrySpread + 1e-9) problems.push(`market ${bid}/${ask} unavailable or too wide`);
  const contracts = Math.floor(capital / (Math.max(q.spot, p.K) * 100));
  if (contracts < 1) problems.push('price exceeds equal allocation');
  if (problems.length) { disqualified.push({ ticker: p.ticker, side: p.side, K: p.K, reasons: problems }); return null; }
  const otm = Math.max(0, p.side === 'call' ? p.K - q.spot : q.spot - p.K);
  const marginPer = Math.max((.2 * q.spot - otm) * 100, .1 * p.K * 100) + pricing.credit * 100;
  return { ...p, px: q.spot, iv: pricing.iv, delta, buf: buffer, cr: +pricing.credit.toFixed(4), contracts,
    credit: Math.round(contracts * pricing.credit * 100), margin: Math.round(contracts * marginPer),
    bid, ask, spread: +(ask - bid).toFixed(4), entry_otm_pct: otmPercent(p.side, p.K, q.spot),
    pricing_reference: reference, entry_pricing: pricing,
    pricing_basis: quoteBasis === 'observed' ? 'dated model adjusted for time, current underlying and IV; actual entry requires an IB fill' : 'dated model repriced for time, intraday underlying and VIX-ratio IV; option quote at entry not observed',
    quote_observed_at: q.quoteObservedAt, quote_source: q.source, quote_timestamp_basis: quoteBasis === 'observed' ? 'Yahoo chain response received; exchange bid/ask timestamp unavailable' : 'modeled; see reconstruction',
    underlying_observed_at: q.spotObservedAt, news_checked_at: p.news_checked_at ?? null,
    allocated_capital: capital, capital_backing: contracts * Math.max(q.spot, p.K) * 100,
    credit_at_bid: Math.round(contracts * bid * 100), midpoint_to_bid_cost: Math.round(contracts * ((bid + ask) / 2 - bid) * 100),
  };
}).filter(Boolean);
if (!picks.length) throw new Error(`No pick survives the entry checks: ${JSON.stringify(disqualified)}`);
if (disqualified.length) notes.push(`Dropped at entry: ${disqualified.map(d => `${d.ticker} (${d.reasons.join('; ')})`).join('; ')}`);
const observedAt = new Date(Math.min(...picks.flatMap(p => [Date.parse(p.quote_observed_at), Date.parse(p.underlying_observed_at)]))).toISOString();
const reconstruction = { source: refresh.synthetic ? 'reconstruct_model_basket.mjs' : 'rebuild_model_basket.mjs', rebuilt_at: new Date().toISOString(), snapshot_observed_at: snapshotObservedAt, snapshot_dir: snapshot, quote_basis: refresh.synthetic ? 'modeled' : quoteBasis, synthetic_snapshot: refresh.reconstruction ?? null, notes: [...notes, ...(arg('--note') ? [arg('--note')] : [])], dropped: disqualified,
  note: refresh.synthetic ? 'no live option-chain snapshot survived for this week; option quotes are Black-Scholes values on the neighbouring weeks\' IV surfaces with real intraday underlying prices' : `quotes ${quoteBasis} from the model's own snapshot captured ${snapshotObservedAt}` };
const final = { ...prepared, phase: 'final', entry_timestamp: asOf.toISOString(), entry_date: easternTime(asOf).date, scheduled_entry_date: schedule.date,
  entry_window: { start: schedule.start.toISOString(), end: schedule.end.toISOString() }, late, late_minutes: lateMinutes,
  late_note: late ? `Model priced ${lateMinutes} minute${lateMinutes === 1 ? '' : 's'} after the scheduled entry window closed (${schedule.end.toISOString()}); the execution service does not enter late.` : null,
  generated_ts: asOf.toISOString(), data_observed_at: observedAt, finalized_at: new Date().toISOString(), finalization_started_at: new Date().toISOString(),
  tv_macros_source: { hy_oas: `FRED:BAMLH0A0HYM2 ${tv.hy_oas?.date}`, pc: `CBOE ${tv.pc_ratio?.as_of}`, fetched_at: tv.fetched_ts },
  allocation_scale: scale, allocation_settings: settings, macro, gsrs: score.score, gsrs_components: score.components, gsrs_calculation: score,
  total_backing_capital: capital * picks.length, picks, data_provenance: arg('--provenance') ?? (refresh.synthetic ? 'reconstructed' : 'rebuilt-from-snapshot'), reconstruction,
  totals: picks.reduce((t, p) => { t[p.side === 'call' ? 'callCredit' : 'putCredit'] += p.credit; t[p.side === 'call' ? 'callMargin' : 'putMargin'] += p.margin; return t; }, { callCredit: 0, putCredit: 0, callMargin: 0, putMargin: 0 }),
};
final.thesis = basketThesis(final);
const finalFile = path.join(OUT, 'basket_proposal.json');
fs.writeFileSync(finalFile, JSON.stringify(final, null, 2));
console.log(`Rebuilt ${week}: ${picks.length} picks, GSRS ${score.score}, entry ${final.entry_timestamp}${late ? ` (late ${lateMinutes} min)` : ''}, quotes ${refresh.synthetic ? 'modeled (synthetic snapshot)' : quoteBasis}`);
for (const p of picks) console.log(`  ${p.ticker.padEnd(6)} ${p.side} K=${p.K} spot=${p.px} cr=${p.cr} x${p.contracts} credit=$${p.credit} delta=${p.delta.toFixed(3)} buf=${p.buf.toFixed(2)} ${p.bid}/${p.ask}`);
for (const n of reconstruction.notes) console.log(`  note: ${n}`);
console.log(`  wrote ${finalFile}`);
if (flag('--publish')) {
  const imported = await importProposal(finalFile, { publish: true });
  console.log(`Published ${imported.slug} (${imported.positions} positions, ${imported.unchanged ? 'already stored' : 'inserted'})`);
}
