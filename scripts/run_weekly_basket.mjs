#!/usr/bin/env node
// Weekly MODEL basket runner.
//
// The model comes first. Every week's basket is built from the model's own
// data (Yahoo, Cboe, FRED, news radar) and sized against model equity, then
// published to the database. Nothing here depends on the IB account: not the
// execution computer selection, not IB equity, not IB market data, not the
// account mode. The execution service (scripts/broker/worker.mjs) reads the
// published basket from the database and applies its own live checks and its
// own strict entry window. Comparing the two is the model-versus-account
// performance report.
//
// Timeline (all configurable in Settings):
//   Friday, preparationLeadMinutes before the close  -> prepare next week
//   Entry day, finalizeLeadMinutes before the window -> finalize + publish
//   After the window, any session before expiry      -> still publish, marked late
// A late basket carries its true pricing time; it is never discarded.
import fs from 'node:fs';
import path from 'node:path';
import { runRefresh, refreshWeeklyUniverse } from './lib/refresh.mjs';
import { fetchTvMacros } from './lib/tv_macros.mjs';
import { runEarnings } from './lib/earnings.mjs';
import { runFilterAndRefine } from './lib/shortlist.mjs';
import { runBuildBasket } from './lib/build_basket.mjs';
import { finalizeBasket, preparationPolicy, preparationMatches, freezeFinalProposal, requireCurrentModelPolicy } from './lib/finalize_basket.mjs';
import { importProposal, findPublishedProposal, publishedBasketForWeek } from './lib/import_proposal.mjs';
import { sendBasketEmail } from './lib/basket_email.mjs';
import { buildAlertPlan } from './lib/google_alerts.mjs';
import { loadBrokerSettings, loadBrokerEquity, loadModelPolicy } from './lib/broker_settings.mjs';
import { acquireLock } from './lib/file_lock.mjs';
import { localWorkerIdentity } from './broker/host-runtime.mjs';
import { assertCurrentDelivery, currentWeek, addDays } from '../shared/market-calendar.mjs';
import { buildContext, entrySchedule, modelPublicationWindow } from '../shared/entry-schedule.mjs';
const root = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
if (process.argv.includes('--help')) { console.log('Usage: node scripts/run_weekly_basket.mjs [--force] [--date YYYY-MM-DD] [--chain-chunk N]'); process.exit(0); }
// Broker settings shape the basket (split, timing, strikes); the model's own
// equity, share, margin and side toggles size it.
const settings = await loadModelPolicy();
const host = localWorkerIdentity();
const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
let context = buildContext(settings);
// A delivery retry can run after the entry window. It only sends the original
// published basket and must never prepare, reprice or publish a new entry.
for (const candidate of [currentWeek(), addDays(currentWeek(), 7)]) {
  const folder = path.join(root, 'baskets', candidate), receipt = read(path.join(folder, 'delivery.json'));
  if (receipt?.published && receipt.emailed) continue;
  const proposal = read(path.join(folder, 'data', 'basket_proposal.json'));
  if (!receipt?.published && proposal?.phase !== 'final') continue;
  if (!proposal || receipt?.published && proposal.generated_ts !== receipt.generated_ts || proposal.basket_date !== candidate) throw new Error('Published basket/delivery identity mismatch');
  try { assertCurrentDelivery(proposal); } catch { continue; }
  let recoveredReceipt;
  if (!receipt?.published) {
    const stored = await findPublishedProposal(proposal);
    if (!stored) continue;
    recoveredReceipt = { basket_date: candidate, generated_ts: proposal.generated_ts, published: stored.publishedAt, slug: stored.slug, reconciled_at: new Date().toISOString() };
  }
  context = { week: candidate, prepare: false, deliveryOnly: true, recoveredReceipt, schedule: entrySchedule(candidate, proposal.allocation_settings ?? settings) };
  break;
}
if (!context) { console.log('Skipped: outside the configured preparation/finalization session'); process.exit(0); }
const arg = key => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : undefined;
if (arg('--date') && arg('--date') !== context.week) throw new Error('Requested date does not match the configured basket entry window');
const week = context.week, expiry = context.schedule.expiry, directory = path.join(root, 'baskets', week), OUT = path.join(directory, 'data');
fs.mkdirSync(OUT, { recursive: true });
const release = acquireLock(path.join(directory, '.build.lock')); process.once('exit', release);
const finalFile = path.join(OUT, 'basket_proposal.json'), preparedFile = path.join(OUT, 'prepared_basket.json'), deliveryFile = path.join(directory, 'delivery.json');
const write = (file, value) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2)); fs.renameSync(`${file}.tmp`, file); };
const status = (phase, details = {}) => write(path.join(directory, 'entry_preparation.json'), { week, phase, hostId: host.id, checkedAt: new Date().toISOString(), late: Boolean(context.late), entryWindow: { start: context.schedule.start.toISOString(), end: context.schedule.end.toISOString() }, ...details });
let delivery = read(deliveryFile);
if (!delivery?.published && context.recoveredReceipt) { delivery = context.recoveredReceipt; write(deliveryFile, delivery); }
// Another computer (or an earlier run whose receipt was lost) may already have
// published this week. The database is the source of truth; never publish twice.
if (!delivery?.published && !context.deliveryOnly) {
  const stored = await publishedBasketForWeek(week);
  if (stored) {
    const frozen = read(finalFile);
    delivery = { basket_date: week, generated_ts: frozen?.generated_ts ?? null, published: stored.publishedAt, slug: stored.slug, reconciled_at: new Date().toISOString(), publishedElsewhere: !frozen };
    write(deliveryFile, delivery);
    if (!frozen) { status('published-elsewhere'); console.log(`Week ${week} is already published (${stored.slug}); nothing to build on this computer`); process.exit(0); }
  }
}
if (delivery?.published && delivery?.emailed) { console.log(`Week ${week} already published and delivered`); process.exit(0); }
if (delivery?.published) {
  const proposal = read(finalFile);
  if (!proposal) { console.log(`Week ${week} already published elsewhere; delivery is that computer's job`); process.exit(0); }
  if (proposal?.generated_ts !== delivery.generated_ts || proposal?.basket_date !== week) throw new Error('Published basket/delivery identity mismatch');
  await requireCurrentModelPolicy(proposal, { loadSettings: loadModelPolicy, deliveryOnly: true });
  const mail = await sendBasketEmail(proposal, { deliveryRetry: true });
  if (!mail.sent) throw new Error(`Delivery incomplete: ${mail.reason ?? mail.status}`);
  write(deliveryFile, { ...delivery, emailed: new Date().toISOString() }); process.exit(0);
}
function runSummary(proposal) {
  const late = proposal.late ? `\n\n**Late model entry:** ${proposal.late_note}\n` : '';
  return `# Basket ${week}\n\nEntry window: ${proposal.entry_window.start} to ${proposal.entry_window.end}. Expiry: ${expiry}. Model entry: ${proposal.entry_timestamp}.${late}\n\nFinalized: ${proposal.finalized_at}. GSRS: ${proposal.gsrs}. Model equity: ${proposal.model_equity} (${proposal.model_equity_source}).\n\n|Ticker|Side|Strike|Adjusted modeled credit|IV source|\n|---|---|---:|---:|---|\n${proposal.picks.map(p => `|${p.ticker}|${p.side}|${p.K}|${p.cr}|${p.entry_pricing.ivSource}|`).join('\n')}\n\nModeled premiums are estimates; actual IB fills and fees determine live results.\n`;
}
async function publish(proposal) {
  if (context.deliveryOnly || proposal.phase !== 'final' || proposal.basket_date !== week || proposal.expiry !== expiry || proposal.preparation_policy !== preparationPolicy(settings)) throw new Error('Final basket does not match the current publication policy');
  await requireCurrentModelPolicy(proposal, { loadSettings: loadModelPolicy });
  const window = modelPublicationWindow(week, settings);
  if (!window.open) throw new Error(`Cannot publish now: ${window.reason}`);
  freezeFinalProposal(finalFile, proposal);
  const imported = await importProposal(finalFile, { publish: true });
  const receipt = { basket_date: week, generated_ts: proposal.generated_ts, published: new Date().toISOString(), slug: imported.slug, late: Boolean(proposal.late) };
  write(deliveryFile, receipt);
  fs.writeFileSync(path.join(directory, 'RUN_SUMMARY.md'), runSummary(proposal));
  status('published', { generatedAt: proposal.generated_ts, late: Boolean(proposal.late) });
  console.log(`Published model basket ${week}${proposal.late ? ` (late by ${proposal.late_minutes} min)` : ''}: ${imported.slug}`);
  // Delivery is a courtesy on top of publication. A mail outage retries on the
  // next cycle through the delivery-only path; it never unpublishes anything.
  const mail = await sendBasketEmail(proposal);
  if (!mail.sent) throw new Error(`Delivery incomplete: ${mail.reason ?? mail.status}`);
  write(deliveryFile, { ...receipt, emailed: new Date().toISOString() });
  console.log(`Delivered finalized basket ${week}`);
}
try {
  // The import might have committed before a process/network failure. Retry
  // that exact artifact; never replace its contracts or pricing reference.
  const frozen = read(finalFile);
  if (frozen?.phase === 'final') { await publish(frozen); process.exit(0); }
  let prepared = read(preparedFile);
  const force = process.argv.includes('--force');
  let rebuild = false;
  const matching = preparationMatches(prepared, settings, week);
  if (!force && matching && context.prepare) { status('prepared'); console.log('Dated preparation retained; awaiting the final refresh window'); process.exit(0); }
  if (!force && matching && !context.prepare) {
    try { await publish(await finalizeBasket(prepared, settings, { OUT })); process.exit(0); }
    catch (error) {
      if (error.code === 'MODEL_POLICY_CHANGED' || read(deliveryFile)?.published || read(finalFile)?.phase === 'final') throw error;
      rebuild = true;
      status('rebuilding', { message: error.message }); console.warn(`Final checks require a fresh selection: ${error.message}`);
    }
  }
  status('preparing');
  await refreshWeeklyUniverse(OUT, { force: force || rebuild });
  await runRefresh({ OUT, EXPIRY_ISO: expiry, chunkLimit: Number(arg('--chain-chunk') ?? 999999), force: force || rebuild });
  await fetchTvMacros({ OUT, BASKET_DATE: week });
  runFilterAndRefine(OUT);
  await runEarnings({ OUT, force: force || rebuild });
  let accountReference = null;
  try { accountReference = await loadBrokerEquity(); } catch { /* the account is reference only; the model never waits for it */ }
  const result = await runBuildBasket({ BASKET_DATE: week, EXPIRY_ISO: expiry, OUT, brokerSettings: settings, brokerEquity: accountReference, outFileName: 'prepared_candidate.json' });
  // The candidate lands in prepared_basket.json only after it proves to have picks;
  // a failed rebuild must not destroy the dated preparation already on disk.
  prepared = read(result.outFile);
  if (!prepared?.picks?.length) throw new Error('No complete qualifying basket in this snapshot; retrying on the next cycle');
  write(preparedFile, prepared);
  write(path.join(OUT, 'google_alert_plan.json'), buildAlertPlan(prepared));
  // Re-evaluate after slow reads. The model publishes whenever a session of the
  // week is open before expiry; only the flag changes if the window has passed.
  const current = buildContext(settings);
  if (!current || current.week !== week) throw new Error('Session ended while preparing; the next open session continues');
  if (current.prepare) { status('prepared'); console.log(`Prepared ${week}; final refresh is scheduled before entry`); }
  else await publish(await finalizeBasket(prepared, settings, { OUT }));
} catch (error) {
  status('retry-needed', { message: String(error.message) });
  console.error(error.message); process.exitCode = 1;
}
