#!/usr/bin/env node
// PAPER-ONLY order-plumbing test.
//
// Enters the prepared basket's calls in the IB PAPER account at whatever price
// the market gives (limit = current bid, floored to the tick), 1 contract each by
// default, purely to exercise the real execution path end to end: contract
// resolution, live quote, margin preview (whatIf), submission, order status,
// executions + commissions, and the resulting positions. It deliberately skips
// the model's strike/credit/delta entry rules — this is a plumbing test, not a
// trade. Hard-gated: refuses unless Settings.accountMode is paper, the resolved
// account is a DU/DUT paper account, and --confirm-paper-test is passed.
//
// Usage: node scripts/broker/paper_entry_test.mjs --confirm-paper-test [--qty 1]
//          [--picks SLS:call:12.5,IOVA:call:11] [--expiry YYYY-MM-DD]
//          [--preview-only] [--close-after]
import fs from 'node:fs';
import path from 'node:path';
import { loadBrokerSettings } from '../lib/broker_settings.mjs';
import { createBroker } from './index.mjs';
import { floorTick, ceilTick } from '../../shared/execution-policy.mjs';
import { currentWeek, isMarketOpen } from '../../shared/market-calendar.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* env may supply values */ }
const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const arg = name => argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
const stamp = () => new Date().toISOString();
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!flag('--confirm-paper-test')) { console.error('Refusing: pass --confirm-paper-test (this places PAPER orders that ignore the model entry rules).'); process.exit(2); }
const qty = Number(arg('--qty') ?? 1);
if (!Number.isInteger(qty) || qty < 1 || qty > 10) { console.error('--qty must be an integer 1..10 for a plumbing test'); process.exit(2); }

const settings = await loadBrokerSettings();
if (settings.accountMode !== 'paper') { console.error(`Refusing: Settings.accountMode is ${settings.accountMode}, not paper`); process.exit(2); }
if (settings.connection !== 'tws') { console.error('Refusing: this test targets the TWS socket adapter'); process.exit(2); }
if (!isMarketOpen(new Date())) { console.error('Refusing: exchange session is closed; run during regular trading hours'); process.exit(2); }

// Picks: explicit --picks, else the prepared basket for this week (calls only).
let picks, expiry = arg('--expiry');
if (arg('--picks')) {
  picks = arg('--picks').split(',').map(s => { const [ticker, side, K] = s.split(':'); return { ticker: ticker.toUpperCase(), side: side ?? 'call', K: Number(K) }; });
  if (!expiry) { console.error('--expiry is required with --picks'); process.exit(2); }
} else {
  const file = path.join(root, 'baskets', currentWeek(), 'data', 'prepared_basket.json');
  if (!fs.existsSync(file)) { console.error(`No prepared basket at ${file}; pass --picks and --expiry`); process.exit(2); }
  const prepared = JSON.parse(fs.readFileSync(file, 'utf8'));
  picks = prepared.picks.filter(p => p.side === 'call').map(p => ({ ticker: p.ticker, side: p.side, K: p.K }));
  expiry ??= prepared.expiry;
}
if (!picks.length) { console.error('No call picks to test'); process.exit(2); }
console.log(`[${stamp()}] paper entry test: ${picks.map(p => `${p.ticker} ${p.side} K${p.K}`).join(', ')} exp ${expiry}, qty ${qty}${flag('--preview-only') ? ' (PREVIEW ONLY)' : ''}`);

const clientId = Number(process.env.IBKR_TEST_CLIENT_ID ?? 95);
const broker = createBroker({ ...settings, twsClientId: clientId }, process.env);
const report = { startedAt: stamp(), account: null, expiry, qty, previewOnly: flag('--preview-only'), legs: [] };
const reportFile = path.join(root, 'baskets', currentWeek(), `paper_entry_test_${new Date().toISOString().slice(0, 10)}.json`);
const save = () => { try { fs.mkdirSync(path.dirname(reportFile), { recursive: true }); fs.writeFileSync(reportFile, JSON.stringify(report, null, 2)); } catch { /* best effort */ } };

try {
  const health = await broker.connect();
  report.account = broker.account;
  if (health.mode !== 'paper' || !/^DU/.test(broker.account)) throw new Error(`Refusing: connected account ${broker.account} is not a paper account`);
  const before = await broker.accountSummary();
  console.log(`connected: ${broker.account} (paper). NLV ${before.netLiquidation}, cash ${before.cash}, availableFunds ${before.availableFunds}`);

  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  for (const pick of picks) {
    const leg = { ticker: pick.ticker, side: pick.side, strike: pick.K };
    report.legs.push(leg);
    try {
      const contract = await broker.resolve(pick, expiry);
      leg.conid = contract.conid; leg.tick = contract.tick;
      const q = await broker.quote(contract);
      leg.quote = { bid: q.bid, ask: q.ask, bidSize: q.bidSize, askSize: q.askSize, underlying: q.underlyingPrice, delta: q.delta, iv: q.optionIv, realtime: q.realtime };
      // "Whatever price you can get": sell at the bid (immediately marketable). If the
      // bid is zero there is no buyer; use one tick so the order is at least valid.
      const limit = q.bid > 0 ? floorTick(q.bid, contract) : contract.tick;
      const order = { action: 'entry', ref: `PTTEST-${day}-${contract.conid}`, contract, quantity: qty, limit };
      leg.order = { ref: order.ref, limit, quantity: qty };
      const margin = await broker.preview(order);
      leg.marginPreview = margin;
      console.log(`${pick.ticker} K${pick.K}: bid ${q.bid} / ask ${q.ask} (${q.realtime ? 'real-time' : 'DELAYED'}) → SELL ${qty} @ ${limit} | margin Δ init ${margin.initialMarginChange} maint ${margin.maintenanceMarginChange}${margin.warning ? ` | warning: ${margin.warning}` : ''}`);
      if (flag('--preview-only')) { leg.status = 'previewed'; continue; }
      const placed = await broker.submit(order);
      leg.orderId = placed.orderId; leg.status = placed.status;
      console.log(`  submitted orderId ${placed.orderId} status ${placed.status}`);
    } catch (error) { leg.error = error.message; console.error(`  ${pick.ticker}: ${error.message}`); }
    save();
  }

  if (!flag('--preview-only')) {
    // Give IB up to ~60s to work the orders, then report statuses, fills, fees, positions.
    for (let i = 0; i < 6; i++) {
      await sleep(10000);
      const orders = await broker.orders();
      const mine = orders.filter(o => String(o.ref ?? '').startsWith(`PTTEST-${day}-`));
      const pending = mine.filter(o => !['Filled', 'Cancelled', 'ApiCancelled', 'Inactive', 'Rejected'].includes(o.status));
      console.log(`[${stamp()}] orders: ${mine.map(o => `${o.ref.split('-').pop()}=${o.status}${o.filled != null ? ` filled ${o.filled}` : ''}`).join(', ') || 'none visible'}`);
      if (!pending.length && mine.length) break;
    }
    const executions = (await broker.executions()).filter(x => String(x.ref ?? '').startsWith(`PTTEST-${day}-`));
    for (const leg of report.legs) {
      leg.fills = executions.filter(x => x.conid === leg.conid).map(x => ({ price: x.price, quantity: x.quantity, time: x.time, commission: x.commission }));
    }
    const positions = await broker.positions();
    report.positions = positions.filter(p => report.legs.some(l => l.conid === p.conid)).map(p => ({ symbol: p.symbol, conid: p.conid, quantity: p.quantity, marketPrice: p.marketPrice, averageCost: p.averageCost }));
    const after = await broker.accountSummary();
    report.accountAfter = { netLiquidation: after.netLiquidation, cash: after.cash, initialMargin: after.initialMargin, maintenanceMargin: after.maintenanceMargin };
    console.log('fills:', report.legs.map(l => `${l.ticker}: ${l.fills?.length ? l.fills.map(f => `${f.quantity}@${f.price} fee ${f.commission ?? '?'}`).join('+') : 'none'}`).join(' | '));
    console.log('positions:', report.positions.map(p => `${p.symbol} ${p.quantity} @ ${p.averageCost}`).join(' | ') || 'none');
    console.log(`account after: NLV ${after.netLiquidation}, initMargin ${after.initialMargin}, maintMargin ${after.maintenanceMargin}`);

    if (flag('--close-after')) {
      // Exit plumbing: buy back each filled leg at the ask.
      for (const leg of report.legs) {
        const pos = report.positions.find(p => p.conid === leg.conid);
        if (!pos || pos.quantity >= 0) continue;
        try {
          const contract = await broker.resolve({ ticker: leg.ticker, side: leg.side, K: leg.strike }, expiry);
          const q = await broker.quote(contract, { entry: false });
          const limit = q.ask > 0 ? ceilTick(q.ask, contract) : contract.tick;
          const placed = await broker.submit({ action: 'exit', ref: `PTTESTX-${day}-${contract.conid}`, contract, quantity: Math.abs(pos.quantity), limit });
          leg.close = { orderId: placed.orderId, status: placed.status, limit };
          console.log(`  close ${leg.ticker}: BUY ${Math.abs(pos.quantity)} @ ${limit} → ${placed.status}`);
        } catch (error) { leg.closeError = error.message; console.error(`  close ${leg.ticker}: ${error.message}`); }
      }
      await sleep(15000);
      report.positionsAfterClose = (await broker.positions()).filter(p => report.legs.some(l => l.conid === p.conid)).map(p => ({ symbol: p.symbol, quantity: p.quantity }));
      console.log('positions after close:', report.positionsAfterClose.map(p => `${p.symbol} ${p.quantity}`).join(' | ') || 'flat');
    }
  }
  report.finishedAt = stamp(); save();
  console.log(`report: ${reportFile}`);
} catch (error) {
  report.error = error.message; save();
  console.error(`paper entry test failed: ${error.message}`); process.exitCode = 1;
} finally { try { broker.disconnect(); } catch { /* closed */ } setTimeout(() => process.exit(process.exitCode ?? 0), 500); }
