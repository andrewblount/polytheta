#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readBasketMarketData, marketDataReadiness } from './index.mjs';
import { loadBrokerSettings } from '../lib/broker_settings.mjs';
import { localWorkerIdentity } from './host-runtime.mjs';
import { parseDate } from '../../shared/market-calendar.mjs';
const root = path.resolve(import.meta.dirname, '../..');
const usage = 'Usage: npm run ib:data -- --ticker SYMBOL --strike PRICE --expiry YYYY-MM-DD [--side call|put]\nReads one exact IB option and its underlying/Greeks; never previews or submits an order. Run during US market hours.';
if (process.argv.includes('--help')) { console.log(usage); process.exit(0); }
const arg = key => process.argv[process.argv.indexOf(key) + 1];
const ticker = process.argv.includes('--ticker') ? arg('--ticker') : '';
const K = process.argv.includes('--strike') ? Number(arg('--strike')) : NaN;
const expiry = process.argv.includes('--expiry') ? arg('--expiry') : '';
const side = process.argv.includes('--side') ? arg('--side') : 'call';
let settings;
try {
  if (!/^[A-Z][A-Z0-9.\-]{0,19}$/.test(ticker) || !Number.isFinite(K) || K <= 0 || !['call', 'put'].includes(side)) throw new Error(usage);
  parseDate(expiry);
  try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
  settings = await loadBrokerSettings();
  fs.mkdirSync(path.join(root, 'runtime'), { recursive: true, mode: 0o700 });
  if (settings.executionHostId !== localWorkerIdentity().id) throw new Error('Run this check on the selected execution computer');
  const markets = await readBasketMarketData([{ ticker, K, side }], expiry, settings);
  const result = marketDataReadiness(markets, settings);
  const directory = path.join(root, 'runtime');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'ib-market-data-check.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result));
} catch (error) {
  const result = { ready: false, mode: settings?.accountMode, checkedAt: new Date().toISOString(), message: String(error.message).replace(/\b(?:DU|U|F)\d{5,}\b/g, '[account]') };
  // A failed check must not leave a previous successful probe looking current.
  if (settings) fs.writeFileSync(path.join(root, 'runtime', 'ib-market-data-check.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.error(JSON.stringify(result)); process.exitCode = 1;
}
