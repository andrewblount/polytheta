#!/usr/bin/env node
// One-shot orchestrator: derive basket_date/expiry, refresh Yahoo, fetch
// TradingView macros, pull earnings, filter+refine, auto-pick, build basket,
// write run summary. Idempotent — safe to re-run; expensive steps skip if
// their outputs already exist.
//
//   node scripts/run_weekly_basket.mjs                    # auto-derive week
//   node scripts/run_weekly_basket.mjs --date 2026-07-13  # force basket date
//   node scripts/run_weekly_basket.mjs --chain-chunk 60   # smaller chain chunk
//   node scripts/run_weekly_basket.mjs --force            # ignore existing outputs

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { deriveBasketDate, expiryFromBasketDate } from './lib/basket_date.mjs';
import { runRefresh } from './lib/refresh.mjs';
import { fetchTvMacros } from './lib/tv_macros.mjs';
import { runEarnings } from './lib/earnings.mjs';
import { runFilterAndRefine } from './lib/shortlist.mjs';
import { runBuildBasket } from './lib/build_basket.mjs';
import { importProposal } from './lib/import_proposal.mjs';
import { sendBasketEmail } from './lib/basket_email.mjs';
import { buildAlertPlan } from './lib/google_alerts.mjs';

const __filename = url.fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

// Load .env.local (gitignored) so the launchd job picks up NETLIFY_DATABASE_URL
// without the credential living in the plist. Absent file is fine.
try {
  process.loadEnvFile(path.join(REPO_ROOT, '.env.local'));
} catch {
  // no .env.local — publish step will detect the missing URL and skip
}

function parseArgs(argv) {
  const out = { force: false, chainChunk: 999999 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--date') out.date = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--chain-chunk') out.chainChunk = parseInt(argv[++i], 10);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return out;
}
function printHelp() {
  console.log(`Usage: node scripts/run_weekly_basket.mjs [--date YYYY-MM-DD] [--force] [--chain-chunk N]`);
}

const args = parseArgs(process.argv);
const BASKET_DATE = args.date ?? deriveBasketDate();
const EXPIRY_ISO = expiryFromBasketDate(BASKET_DATE);
const BASKET_DIR = path.join(REPO_ROOT, 'baskets', BASKET_DATE);
const OUT = path.join(BASKET_DIR, 'data');
fs.mkdirSync(OUT, { recursive: true });

const log = (msg) => console.log(`[orch ${BASKET_DATE}] ${msg}`);
log(`start expiry=${EXPIRY_ISO} out=${OUT} force=${args.force}`);

// Seed weeklys_universe.csv from the most recent prior basket if this week's
// dir doesn't have one. TradingView Cboe-Weeklys pull would give a fresh list,
// but the universe changes slowly and the last snapshot is fine week-to-week.
function seedUniverse() {
  const target = path.join(OUT, 'weeklys_universe.csv');
  if (fs.existsSync(target) && !args.force) return { seeded: false, existing: true };
  const baskets = fs.readdirSync(path.join(REPO_ROOT, 'baskets'))
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n) && n < BASKET_DATE)
    .sort();
  for (let i = baskets.length - 1; i >= 0; i--) {
    const src = path.join(REPO_ROOT, 'baskets', baskets[i], 'data', 'weeklys_universe.csv');
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, target);
      return { seeded: true, from: baskets[i] };
    }
  }
  throw new Error('no prior weeklys_universe.csv to seed from');
}
const seed = seedUniverse();
log(`universe seed: ${JSON.stringify(seed)}`);

// Yahoo refresh (macro + universe quotes + option chains). Resumable — the
// chain step tracks progress in _chains_state.json.
function refreshDone() {
  if (args.force) return false;
  const chainsCsv = path.join(OUT, `chains_${EXPIRY_ISO}_v2.csv`);
  const state = path.join(OUT, '_chains_state.json');
  const universeFile = path.join(OUT, 'universe_8to40.csv');
  // Any required artifact missing (including after a partial cleanup) means
  // the refresh must run — never crash here.
  if (!fs.existsSync(chainsCsv) || !fs.existsSync(state) || !fs.existsSync(universeFile)) return false;
  try {
    const s = JSON.parse(fs.readFileSync(state, 'utf8'));
    const universeLines = fs.readFileSync(universeFile, 'utf8').trim().split(/\r?\n/).length - 1;
    return (s.done.length + s.errors.length) >= universeLines;
  } catch {
    return false;
  }
}
if (!refreshDone()) {
  const rr = await runRefresh({ OUT, EXPIRY_ISO, chunkLimit: args.chainChunk });
  log(`refresh: ${JSON.stringify(rr)}`);
} else {
  log('refresh: all chains present, skipping');
}

// TradingView macros — always refresh (cheap, and market changes daily).
const tv = await fetchTvMacros({ OUT, BASKET_DATE });
log(`tv_macros: HY_OAS=${tv.hy_oas?.value ?? tv.hy_oas?.error} PC=${tv.pc_ratio?.total ?? tv.pc_ratio?.error} tv_desktop=${tv.tv_desktop_opened?.opened}`);

// Shortlist (produces refined CSVs earnings step needs).
const sl = runFilterAndRefine(OUT);
log(`shortlist: refined_calls=${sl.calls_refined} refined_puts=${sl.puts_refined}`);

// Earnings — refresh unless the file exists and is < 6 hours old.
function earningsFresh() {
  if (args.force) return false;
  const f = path.join(OUT, 'earnings_dates.json');
  if (!fs.existsSync(f)) return false;
  const ageMs = Date.now() - fs.statSync(f).mtime.getTime();
  return ageMs < 6 * 3600 * 1000;
}
if (!earningsFresh()) {
  const er = await runEarnings({ OUT });
  log(`earnings: ${JSON.stringify(er)}`);
} else {
  log('earnings: fresh, skipping');
}

// Build basket (async: fetches short interest for the candidate pool).
const bb = await runBuildBasket({ BASKET_DATE, EXPIRY_ISO, OUT });
log(`build: gsrs=${bb.gsrs} totals=${JSON.stringify(bb.totals)}`);

// Write concise RUN_SUMMARY.md.
const proposal = JSON.parse(fs.readFileSync(bb.outFile, 'utf8'));
const picksMd = proposal.picks.map((p) =>
  `| ${p.side} | ${p.ticker} | ${p.family} | ${p.px} | ${p.K} | ${p.cr.toFixed(2)} | ${p.delta.toFixed(2)} | ${p.buf}x | ${p.contracts} | $${p.margin.toLocaleString()} | $${p.credit.toLocaleString()} | ${p.earnings_date ?? '-'} |`
).join('\n');
const summaryPath = path.join(BASKET_DIR, 'RUN_SUMMARY.md');
const totalMargin = proposal.totals.callMargin + proposal.totals.putMargin;
const totalCredit = proposal.totals.callCredit + proposal.totals.putCredit;
const rom = totalMargin ? (totalCredit / totalMargin * 100).toFixed(2) : 'n/a';
const cons = proposal.constraints ?? {};
const constraintsMd = [
  `- **GSRS band ${cons.gsrs_band}** — put budget $${(cons.put_budget ?? 0).toLocaleString()} per name` +
    (cons.put_doubles_allowed === false ? ', **put doubles PROHIBITED**' : '') +
    (cons.puts_allowed === false ? ', **new puts PROHIBITED**' : '') +
    (cons.hedge_recommended ? ', **hedge recommended (SPX puts / VIX calls)**' : ''),
  `- Strike compliance: delta ${cons.delta_band?.join('–')}, spread ≤ $${cons.max_spread}, put buffer ≥ ${cons.min_put_atr_buffer}x ATR, OTM vol ≥ ${cons.min_otm_volume}`,
  `- Strike re-selection: ${JSON.stringify(cons.strike_reselection ?? {})}`,
  `- Thesis signals: SI live from Yahoo; overrides file has ${cons.signal_sources?.overrides_tickers ?? 0} ticker(s)`,
].join('\n');
const signalsMd = proposal.picks.map((p) => {
  const rc = p.rule_checks ?? {};
  const ts = rc.thesis_signals ?? {};
  return `| ${p.ticker} | ${p.side} | ${p.si_pct != null ? p.si_pct + '%' : '—'} | ${ts.short_interest ?? '—'} | ${ts.buyback ?? '—'} | ${ts.radar ?? '—'} | ${rc.thesis_coverage ?? '0/5'} | ${rc.pot_proxy_pct ?? '—'}% |`;
}).join('\n');
const summary = `# Weekly Basket — ${BASKET_DATE} (expiry ${EXPIRY_ISO})

Auto-generated by \`scripts/run_weekly_basket.mjs\` at ${proposal.generated_ts}.

## Data pulls

- Yahoo macro + SPY/GSPC/VIX history (\`macro_quotes.csv\`, \`SPY_history.csv\`, \`GSPC_history.csv\`, \`VIX_history.csv\`)
- Yahoo universe quotes (\`universe_quotes.csv\`, \`universe_8to40.csv\`)
- Yahoo option chains for ${EXPIRY_ISO} (\`chains_${EXPIRY_ISO}_v2.csv\`, \`chain_summary_v2.csv\`)
- Yahoo earnings dates (\`earnings_dates.json\`)
- TradingView macros (\`tv_macros.json\`) — HY_OAS from FRED (${proposal.tv_macros_source.hy_oas}), P/C from CBOE (${proposal.tv_macros_source.pc})

## Macro / GSRS

- SPX ${proposal.macro.SPX}, SPY ${proposal.macro.SPY}, VIX ${proposal.macro.VIX} (prev ${proposal.macro.VIX_prev})
- SKEW ${proposal.macro.SKEW}, MOVE ${proposal.macro.MOVE}
- HY_OAS ${proposal.macro.HY_OAS}, P/C ${proposal.macro.PC}
- **GSRS ${proposal.gsrs}** — vix ${proposal.gsrs_components.vix}, skew ${proposal.gsrs_components.skew}, hyoas ${proposal.gsrs_components.hyoas}, move ${proposal.gsrs_components.move}, pc ${proposal.gsrs_components.pc}

## Basket picks

Pool sizes after earnings filter and family cap: ${proposal.pool_counts.calls} call candidates, ${proposal.pool_counts.puts} put candidates. Selection: top by IV per side, per-family cap of 2 names, no name repeated across sides.

| side | ticker | family | px | K | credit | Δ | ATR buf | contracts | margin | credit$ | earnings |
|------|--------|--------|---:|--:|------:|--:|--------:|---------:|-------:|--------:|----------|
${picksMd}

## Rule enforcement (docs/options_trading_system.md)

${constraintsMd}

## Thesis signals

| ticker | side | SI % float | SI check | buyback | radar | coverage | POT (~2Δ) |
|--------|------|-----------:|----------|---------|-------|----------|-----------|
${signalsMd}

Signals marked — are not evaluated. Maintain \`baskets/thesis_overrides.json\`
(buyback, fan, glassdoor, radars per ticker) to raise coverage; the 3-of-5
thesis rule is only enforceable when at least 3 signals are known.

## Totals

Credit **$${totalCredit.toLocaleString()}** on margin **$${totalMargin.toLocaleString()}** — RoM at max profit **${rom}%**.
`;
fs.writeFileSync(summaryPath, summary);
log(`wrote ${summaryPath}`);

// Zero picks = something is wrong (data outage, over-filtering, or a genuine
// no-trade week). Never silently publish an empty basket over last week's —
// alarm loudly on every channel and stop.
if (proposal.picks.length === 0) {
  log('ALARM: 0 picks — NOT publishing, NOT emailing instructions.');
  const msg = `🚨 Polytheta: Monday build produced ZERO picks (pools ${JSON.stringify(proposal.pool_counts)}). No basket published — investigate before trading.`;
  try {
    const { execFileSync } = await import('node:child_process');
    if (process.env.ALERT_IMESSAGE_TO) {
      execFileSync('osascript', ['-e',
        `tell application "Messages" to send ${JSON.stringify(msg)} to participant ${JSON.stringify(process.env.ALERT_IMESSAGE_TO)} of (1st account whose service type = iMessage)`,
      ]);
    }
    if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: process.env.STOP_ALERT_EMAIL || 'ablount@bluecielo.com' }], subject: `FAILED: weekly basket ${BASKET_DATE} — zero picks` }],
          from: { email: process.env.SENDGRID_FROM_EMAIL },
          content: [{ type: 'text/plain', value: msg + `\n\nSee ${summaryPath} and scripts/launchd logs.` }],
        }),
      });
    }
  } catch (err) { log(`alarm delivery failed: ${err.message}`); }
  log('done (failed)');
  process.exit(1);
}

// TradingView artifacts: an importable watchlist and the alert levels.
// (TradingView has no public write API — the watchlist file drag-imports in
// one step, and the Monday scheduled assistant task sets alerts via the
// browser from these levels.)
const tvWatchlist = proposal.picks.map((p) => p.ticker).join(',');
fs.writeFileSync(path.join(BASKET_DIR, 'tradingview_watchlist.txt'), tvWatchlist + '\n');
const tvAlerts = [
  '# TradingView alerts — ' + BASKET_DATE,
  '',
  '| ticker | side | alert | level | meaning |',
  '|--------|------|-------|------:|---------|',
  ...proposal.picks.map((p) =>
    `| ${p.ticker} | ${p.side} | crossing ${p.side === 'call' ? 'up' : 'down'} | ${p.K} | short strike — attention only, policy is hold to expiry; exits on radar signals |`),
].join('\n');
fs.writeFileSync(path.join(BASKET_DIR, 'tradingview_alerts.md'), tvAlerts + '\n');
log(`tradingview artifacts: watchlist (${proposal.picks.length} symbols) + alert levels`);

// Google Alerts plan — created Monday and deleted after settlement by the
// scheduled assistant tasks (Google retired the Alerts API).
const alertPlan = buildAlertPlan(proposal);
fs.writeFileSync(
  path.join(BASKET_DIR, 'google_alerts.json'),
  JSON.stringify(alertPlan, null, 2) + '\n',
);
log(`google alerts plan: ${alertPlan.alerts.length} queries, remove after ${alertPlan.remove_after}`);

// Email the trading instructions (independent of DB publish — the basket
// should reach the inbox even if the site is down).
try {
  const mail = await sendBasketEmail(proposal);
  log(mail.sent ? `basket email sent to ${mail.to}` : `basket email skipped/failed: ${mail.reason ?? mail.status}`);
} catch (err) {
  log(`WARNING: basket email failed — ${err.message}`);
}

// Publish to the Neon DB behind polytheta.com. Without this the site keeps
// serving whatever was last loaded, regardless of what the orchestrator built.
// Non-fatal: a DB outage should not lose the basket we just computed on disk.
if (process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL) {
  try {
    const imported = await importProposal(bb.outFile, { publish: true });
    log(`published to site: ${imported.slug} (${imported.positions} positions)`);
  } catch (err) {
    log(`WARNING: site publish failed — ${err.message}`);
    log('  basket is safe on disk; re-run: node scripts/import_baskets.mjs --latest');
    process.exitCode = 1;
  }
} else {
  log('site publish skipped — no NETLIFY_DATABASE_URL/DATABASE_URL in environment');
}

log('done');
