#!/usr/bin/env node
// Reconstruct a week's MODEL basket when no option-chain snapshot survived.
// Builds a synthetic research snapshot (real intraday underlying prices,
// modeled option quotes from neighbouring weeks' IV surfaces), then runs the
// ordinary selection and entry math through rebuild_model_basket.mjs, which
// publishes it labelled `data_provenance: 'reconstructed'`.
//
//   node scripts/reconstruct_model_basket.mjs --week 2026-09-07 --entry-time 2026-09-08T13:45:00Z \
//     --reference <dir>:<chains csv> [--reference <dir>:<chains csv>] \
//     --quote-fields <universe_quotes.csv> --universe <weeklys_universe.csv> \
//     --hy-oas 2.63:2026-09-04 --pc 0.76:2026-09-04 [--si-from file] [--earnings-from a,b] [--exclude A,B] [--publish]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadReference, readCsv, synthesizeSnapshot, synthesizeMacro } from './lib/synthetic_chain.mjs';
import { entrySchedule } from '../shared/entry-schedule.mjs';
import { validateBrokerSettings } from '../shared/broker-settings.mjs';

const root = path.resolve(import.meta.dirname, '..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply values */ }
const args = process.argv.slice(2);
const arg = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
const all = key => args.flatMap((a, i) => a === key ? [args[i + 1]] : []);
const flag = key => args.includes(key);
if (flag('--help') || !arg('--week') || !arg('--entry-time') || !all('--reference').length || !arg('--quote-fields') || !arg('--universe') || !arg('--hy-oas') || !arg('--pc')) {
  console.log('Usage: see the header of scripts/reconstruct_model_basket.mjs'); process.exit(flag('--help') ? 0 : 1);
}
const week = arg('--week'), asOf = new Date(arg('--entry-time'));
const settings = validateBrokerSettings({});
const expiry = entrySchedule(week, settings).expiry;
const outDir = path.resolve(arg('--out') ?? path.join(root, 'baskets', week, 'reconstruction', asOf.toISOString().replaceAll(':', '-')));
const snapshotDir = path.join(outDir, 'synthetic');
fs.mkdirSync(snapshotDir, { recursive: true });
const references = all('--reference').map(spec => { const [dir, chainFile] = spec.split(':'); return loadReference(path.resolve(dir), chainFile); });
const quoteFields = Object.fromEntries(readCsv(path.resolve(arg('--quote-fields'))).map(r => [r.ticker, r]));
const universeTickers = fs.readFileSync(path.resolve(arg('--universe')), 'utf8').trim().split(/\r?\n/).slice(1).filter(t => /^[A-Z]{1,5}$/.test(t));
const macro = await synthesizeMacro({ OUT: snapshotDir, asOf });
console.log(`[reconstruct] macro at ${asOf.toISOString()}: ${JSON.stringify(macro)}`);
await synthesizeSnapshot({ OUT: snapshotDir, expiry, asOf, universeTickers, references, quoteFields, vixNow: macro.VIX });
const [hy, hyDate] = arg('--hy-oas').split(':'), [pc, pcDate] = arg('--pc').split(':');
fs.writeFileSync(path.join(snapshotDir, 'tv_macros.json'), JSON.stringify({ fetched_ts: asOf.toISOString(), basket_date: week, tv_desktop_opened: { opened: false, reason: 'reconstruction' },
  hy_oas: { date: hyDate, value: Number(hy), note: arg('--hy-oas-note') ?? null }, pc_ratio: { total: Number(pc), as_of: pcDate }, error: null, reconstructed: true }, null, 2));
if (arg('--si-from')) fs.copyFileSync(path.resolve(arg('--si-from')), path.join(snapshotDir, 'short_interest.json'));
fs.writeFileSync(path.join(snapshotDir, 'weeklys_universe_source.json'), JSON.stringify({ source: 'https://www.cboe.com/available_weeklys/get_csv_download/', fetched_at: asOf.toISOString(), count: universeTickers.length, reconstructed: true }));
const rebuild = ['scripts/rebuild_model_basket.mjs', '--week', week, '--snapshot', snapshotDir, '--prepared-time', asOf.toISOString(), '--entry-time', asOf.toISOString(),
  '--assume-radar-clean', '--fetch-earnings', '--provenance', 'reconstructed', '--out', outDir,
  ...(arg('--earnings-from') ? ['--earnings-from', arg('--earnings-from')] : []), ...(arg('--exclude') ? ['--exclude', arg('--exclude')] : []),
  ...(flag('--default-settings') ? ['--default-settings'] : []), ...(flag('--publish') ? ['--publish'] : []),
  '--note', arg('--note') ?? `Reconstructed: option quotes modeled from ${references.map(r => path.basename(path.dirname(r.dir)) + '/' + path.basename(r.dir)).join(' and ')}; HY OAS ${hy} (${hyDate}), Cboe P/C ${pc} (${pcDate})`];
console.log(`[reconstruct] node ${rebuild.join(' ')}`);
const result = spawnSync(process.execPath, rebuild, { cwd: root, stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
