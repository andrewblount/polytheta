#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { createBroker } from './index.mjs';
import { executionCycle } from './execution-engine.mjs';
import { readJournal, saveJournal } from './journal.mjs';
import { acquireLock } from '../lib/file_lock.mjs';
import { scanRadar } from '../lib/news_radar.mjs';
import { easternTime } from '../../shared/market-calendar.mjs';
import { entryWeek } from '../../shared/entry-schedule.mjs';
import { validateBrokerSettings } from '../../shared/broker-settings.mjs';
import { localWorkerIdentity, directDatabaseUrl, restartWindow, createExecutionFence, chooseJournal } from './host-runtime.mjs';
import { createYahooClient } from '../lib/yahoo_client.mjs';
import { brokerEquitySnapshot } from '../../shared/model-equity.mjs';
const root = path.resolve(import.meta.dirname, '../..');
try { process.loadEnvFile(path.join(root, '.env.local')); } catch { /* environment may supply secrets */ }
const runtime = path.join(root, 'runtime'); fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
const release = acquireLock(path.join(runtime, '.execution.lock'));
process.once('exit', release);
const journalPath = path.join(runtime, 'ib-execution.json');
const checkOnly = process.argv.includes('--check');
const enabled = !checkOnly && process.env.POLYTHETA_EXECUTION_ENABLED === 'true';
// Paper trading is an explicit local opt-in; a DU account is otherwise refused.
const allowPaper = process.env.IBKR_ALLOW_PAPER === 'true';
const host = localWorkerIdentity();
let fence;
const pool = postgres(directDatabaseUrl(process.env.IBKR_WORKER_DATABASE_URL ?? process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL), {
  max: 1, connect_timeout: 15,
  // postgres.js can reconnect its reserved connection. The old worker must
  // never continue under the new backend after its singleton lock is gone.
  onclose: () => fence?.invalidate(),
});
const sql = await pool.reserve();
let broker, settings, journal, lockHeld = false, selected = false, backendPid;
let connectedThisCycle = false;
try {
  await sql`insert into app_settings(key,value,updated_at) values (${`ib_host:${host.id}`},${sql.json({ id: host.id, label: host.label, lastSeen: new Date().toISOString() })},now()) on conflict(key) do update set value=excluded.value,updated_at=now()`;
  const [lock] = await sql`select pg_try_advisory_lock(72762414) as acquired, pg_backend_pid() as pid`;
  if (!lock.acquired) { console.log('Another execution worker is active'); process.exitCode = 0; }
  else {
  lockHeld = true; backendPid = lock.pid;
  fence = createExecutionFence({ sql, backendPid, hostId: host.id });
  let [saved] = await sql`select value, updated_at::text as revision from app_settings where key='broker'`;
  settings = validateBrokerSettings(saved?.value ?? {});
  if (!settings.executionHostId && process.argv.includes('--select-this-host')) {
    settings.executionHostId = host.id;
    await fence.assert({ allowUnselected: true });
    const rows = await sql`insert into app_settings(key,value,updated_at)
      select 'broker',${sql.json(settings)},now() where ${fence.predicate({ allowUnselected: true })}
      on conflict(key) do update set value=app_settings.value || ${sql.json({ executionHostId: host.id })},updated_at=now()
      where coalesce(app_settings.value->>'executionHostId','')='' returning key`;
    fence.checkedWrite(rows);
    // Reload in case another Settings field changed while registration ran.
    [saved] = await sql`select value, updated_at::text as revision from app_settings where key='broker'`;
    settings = validateBrokerSettings(saved?.value ?? {});
  }
  if (settings.executionHostId !== host.id) { console.log(`Execution computer registered: ${host.label}; select it in Settings to connect`); }
  else {
  fence.bindSettingsRevision(saved.revision);
  await fence.assert();
  selected = true; broker = createBroker(settings);
  const [hosted] = await sql`select value from app_settings where key='ib_execution_journal'`;
  journal = chooseJournal(hosted?.value, readJournal(journalPath));
  const beforeWrite = () => fence.assert();
  const persistSetting = async (key, value) => {
    await beforeWrite();
    const rows = await sql`insert into app_settings(key,value,updated_at)
      select ${key},${sql.json(value)},now() where ${fence.predicate()}
      on conflict(key) do update set value=excluded.value,updated_at=now() returning key`;
    fence.checkedWrite(rows);
  };
  const file = path.join(root, 'baskets', entryWeek(settings), 'data', 'basket_proposal.json');
  const proposal = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  const commands = enabled ? await sql`select value from app_settings where key like 'ib_exit:%' and value->>'status' in ('queued','monitoring') order by updated_at` : [];
  const result = await executionCycle({ broker, proposal, settings, journal, enabled, allowPaper, beforeWrite,
    commands: commands.map(r => r.value),
    publish: async snapshot => {
      connectedThisCycle = true;
      await persistSetting('broker_portfolio', { ...snapshot, hostId: host.id });
      for (const command of Object.values(journal.commands ?? {})) {
        await beforeWrite();
        const rows = await sql`update app_settings set value=${sql.json(command)},updated_at=now()
          where key=${`ib_exit:${command.requestId}`} and ${fence.predicate()} returning key`;
        fence.checkedWrite(rows);
      }
    },
    save: async value => {
      // Committed independently, before any broker write. This is the private
      // canonical journal when changing machines; the local file is a backup.
      await persistSetting('ib_execution_journal', value);
      saveJournal(journalPath, value);
    },
    getVix: async () => {
      const q = await createYahooClient().quote('^VIX');
      const observed = new Date(q.regularMarketTime), age = Date.now() - +observed;
      if (!Number.isFinite(age) || age < -60000 || age > 20 * 60000 || easternTime(observed).date !== easternTime().date) throw new Error('Current VIX unavailable for the IV approximation');
      return q.regularMarketPrice;
    },
    scanNews: async (pick, { signal } = {}) => {
      const result = await scanRadar([pick.ticker], null, { names: { [pick.ticker]: pick.name ?? '' }, signal });
      if (result[pick.ticker].error) throw new Error(`News feed unavailable for ${pick.ticker}`);
      return result[pick.ticker][pick.side];
    },
  });
  const mode = result.health?.mode ?? 'live';
  const status = { ...result, account: undefined, mode, hostId: host.id, hostLabel: host.label, connection: settings.connection, activated: enabled, checkedAt: new Date().toISOString(), fills: Object.keys(journal.fills).length };
  // Credentials remain local; only the dedicated worker can read the journal.
  await persistSetting('broker_status', status);
  // Account equity is the sizing basis for both basket selection and entry
  // budgets; publish it so the weekly basket selects against the real account.
  const equity = brokerEquitySnapshot(result.account, { mode, hostId: host.id });
  await persistSetting('broker_equity', equity);
  fs.writeFileSync(path.join(runtime, 'ib-equity.json'), JSON.stringify(equity, null, 2), { mode: 0o600 });
  // Only verified fills generated by this service enter the actual ledger.
  for (const fill of Object.values(journal.fills)) {
    if (checkOnly) break;
    if (fill.commission == null || !Number.isFinite(fill.commission)) continue; // await commission, never invent zero fees
    if (!fill.time) continue;
    const at = new Date(fill.time);
    if (!Number.isFinite(+at)) continue; // broker timezone must be explicit
    // IB correction suffixes replace the original execution; they must not
    // create an additional ledger fill with a second UUID.
    const executionIdentity = fill.executionId.replace(/\.\d+$/, '');
    const hex = createHash('sha256').update(`IB:${broker.account}:${executionIdentity}`).digest('hex');
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
    const c = fill.contract;
    const note = `IB execution ${fill.executionId}; modeled credit ${fill.modeledCredit ?? 'n/a'}; execution service v1`;
    await beforeWrite();
    const rows = await sql`insert into trades (id,ticker,side,action,strike,expiry,quantity,price,fees,broker,executed_at,notes)
      select ${id},${c.symbol},${c.side},${fill.action === 'entry' ? 'sell-to-open' : 'buy-to-close'},${c.strike},${c.expiry},${fill.quantity},${fill.price},${fill.commission},${mode === 'paper' ? 'IBKR paper' : 'IBKR live'},${at},${note}
      where ${fence.predicate()}
      on conflict(id) do update set price=excluded.price,fees=excluded.fees,quantity=excluded.quantity,executed_at=excluded.executed_at,notes=excluded.notes,updated_at=now() returning id`;
    fence.checkedWrite(rows);
  }
  console.log(JSON.stringify(status));
  }
  }
} catch (error) {
  const message = String(error.message).replace(/\b(?:DU|U|F)\d{5,}\b/g, '[account]');
  const status = { connected: connectedThisCycle, hostId: host.id, hostLabel: host.label, connection: settings?.connection, activated: enabled, message: selected && restartWindow(settings) ? `Expected TWS restart window; reconnecting on subsequent cycles. ${message}` : message, checkedAt: new Date().toISOString() };
  if (selected) {
    try {
      await fence.assert();
      const rows = await sql`insert into app_settings(key,value,updated_at)
        select 'broker_status',${sql.json(status)},now() where ${fence.predicate()}
        on conflict(key) do update set value=excluded.value,updated_at=now() returning key`;
      fence.checkedWrite(rows);
    } catch { /* A lost/unselected host must not overwrite the new host's status. */ }
  }
  console.error(message); process.exitCode = 1;
} finally {
  broker?.disconnect();
  if (lockHeld) { try { await sql`select pg_advisory_unlock(72762414)`; } catch { /* connection already lost */ } }
  sql.release(); await pool.end();
}
