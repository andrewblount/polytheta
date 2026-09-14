#!/usr/bin/env node
// Build ahead of the selected entry window, finalize shortly before it, and
// publish once. No weekend run or late-session order is implied by a retry.
import fs from 'node:fs';
import path from 'node:path';
import { runRefresh, refreshWeeklyUniverse } from './lib/refresh.mjs';
import { fetchTvMacros } from './lib/tv_macros.mjs';
import { runEarnings } from './lib/earnings.mjs';
import { runFilterAndRefine } from './lib/shortlist.mjs';
import { runBuildBasket } from './lib/build_basket.mjs';
import { finalizeBasket, preparationPolicy, preparationMatches, freezeFinalProposal, requireCurrentBasketAuthority } from './lib/finalize_basket.mjs';
import { importProposal, findPublishedProposal } from './lib/import_proposal.mjs';
import { sendBasketEmail } from './lib/basket_email.mjs';
import { buildAlertPlan } from './lib/google_alerts.mjs';
import { loadBrokerSettings, loadBrokerEquity } from './lib/broker_settings.mjs';
import { acquireLock } from './lib/file_lock.mjs';
import { localWorkerIdentity } from './broker/host-runtime.mjs';
import { assertCurrentProposal, assertCurrentDelivery, currentWeek, addDays } from '../shared/market-calendar.mjs';
import { buildContext, entrySchedule } from '../shared/entry-schedule.mjs';
const root = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
if (process.argv.includes('--help')) { console.log('Usage: node scripts/run_weekly_basket.mjs [--force] [--date YYYY-MM-DD] [--chain-chunk N]'); process.exit(0); }
const settings = await loadBrokerSettings();
const host = localWorkerIdentity();
if (settings.executionHostId && settings.executionHostId !== host.id) { console.log('Skipped: another execution computer is selected'); process.exit(0); }
const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
let context = buildContext(settings);
// A delivery retry can run after the entry window. It only sends the original
// published basket and must never prepare, reprice or publish a late entry.
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
const status = (phase, details = {}) => write(path.join(directory, 'entry_preparation.json'), { week, phase, hostId: host.id, checkedAt: new Date().toISOString(), entryWindow: { start: context.schedule.start.toISOString(), end: context.schedule.end.toISOString() }, ...details });
let delivery = read(deliveryFile);
if (!delivery?.published && context.recoveredReceipt) { delivery = context.recoveredReceipt; write(deliveryFile, delivery); }
if (delivery?.published && delivery?.emailed) { console.log(`Week ${week} already published and delivered`); process.exit(0); }
if (delivery?.published) {
  const proposal = read(finalFile);
  if (proposal?.generated_ts !== delivery.generated_ts || proposal?.basket_date !== week) throw new Error('Published basket/delivery identity mismatch');
  await requireCurrentBasketAuthority(proposal, host.id, { loadSettings: loadBrokerSettings, deliveryOnly: true });
  const mail = await sendBasketEmail(proposal, { deliveryRetry: true });
  if (!mail.sent) throw new Error(`Delivery incomplete: ${mail.reason ?? mail.status}`);
  write(deliveryFile, { ...delivery, emailed: new Date().toISOString() }); process.exit(0);
}
async function publish(proposal) {
  if (context.deliveryOnly || proposal.phase !== 'final' || proposal.basket_date !== week || proposal.expiry !== expiry || proposal.preparation_policy !== preparationPolicy(settings)) throw new Error('Final basket does not match the current publication policy');
  await requireCurrentBasketAuthority(proposal, host.id, { loadSettings: loadBrokerSettings });
  assertCurrentProposal(proposal);
  if (Date.now() >= +context.schedule.end) throw new Error('Entry window ended; no late basket published');
  freezeFinalProposal(finalFile, proposal);
  const imported = await importProposal(finalFile, { publish: true });
  const receipt = { basket_date: week, generated_ts: proposal.generated_ts, published: new Date().toISOString(), slug: imported.slug };
  write(deliveryFile, receipt);
  fs.writeFileSync(path.join(directory, 'RUN_SUMMARY.md'), `# Basket ${week}\n\nEntry window: ${proposal.entry_window.start} to ${proposal.entry_window.end}. Expiry: ${expiry}.\n\nFinalized: ${proposal.finalized_at}. GSRS: ${proposal.gsrs}.\n\n|Ticker|Side|Strike|Adjusted modeled credit|IV source|\n|---|---|---:|---:|---|\n${proposal.picks.map(p => `|${p.ticker}|${p.side}|${p.K}|${p.cr}|${p.entry_pricing.ivSource}|`).join('\n')}\n\nModeled premiums are estimates; actual IB fills and fees determine live results.\n`);
  status('published', { generatedAt: proposal.generated_ts });
  await requireCurrentBasketAuthority(proposal, host.id, { loadSettings: loadBrokerSettings });
  const mail = await sendBasketEmail(proposal);
  if (!mail.sent) throw new Error(`Delivery incomplete: ${mail.reason ?? mail.status}`);
  write(deliveryFile, { ...receipt, emailed: new Date().toISOString() });
  console.log(`Published and delivered finalized basket ${week}`);
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
      if (error.code === 'BASKET_AUTHORITY_CHANGED' || read(deliveryFile)?.published || read(finalFile)?.phase === 'final') throw error;
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
  const result = await runBuildBasket({ BASKET_DATE: week, EXPIRY_ISO: expiry, OUT, brokerSettings: settings, brokerEquity: await loadBrokerEquity(), outFileName: 'prepared_basket.json' });
  prepared = read(result.outFile);
  if (!prepared?.picks?.length) throw new Error('No complete qualifying basket; no entries or instructions published');
  write(preparedFile, prepared);
  write(path.join(OUT, 'google_alert_plan.json'), buildAlertPlan(prepared));
  // Re-evaluate after slow reads; never publish beyond the actual window.
  const current = buildContext(settings);
  if (!current || current.week !== week) throw new Error('Preparation finished after its allowed session; no basket published');
  if (current.prepare) { status('prepared'); console.log(`Prepared ${week}; final refresh is scheduled before entry`); }
  else await publish(await finalizeBasket(prepared, settings, { OUT }));
} catch (error) {
  status('retry-needed', { message: String(error.message) });
  console.error(error.message); process.exitCode = 1;
}
