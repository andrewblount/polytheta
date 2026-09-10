import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { clockMinute } from '../../shared/entry-schedule.mjs';

export function localWorkerIdentity({ directory = path.join(os.homedir(), '.polytheta'), hostname = os.hostname() } = {}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'worker.json');
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!/^[a-f0-9-]{36}$/i.test(saved.id ?? '')) throw new Error('Invalid execution computer identity');
    // A Mac rename must not silently deselect the execution computer. This file
    // lives outside the synced repository and its UUID is the stable identity.
    return { ...saved, hostname };
  }
  const identity = { id: randomUUID(), hostname, label: hostname, registeredAt: new Date().toISOString() };
  const temp = path.join(directory, `.worker-${identity.id}.tmp`);
  fs.writeFileSync(temp, JSON.stringify(identity, null, 2), { mode: 0o600, flag: 'wx' });
  try {
    // Publishing a completed file by hard link prevents two checkouts from
    // registering different IDs or reading a half-written identity.
    try { fs.linkSync(temp, file); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { fs.unlinkSync(temp); }
  return localWorkerIdentity({ directory, hostname });
}
export function directDatabaseUrl(value) {
  if (!value) throw new Error('Worker database connection is not configured');
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Worker database URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Worker requires a direct PostgreSQL connection URL');
  // Neon transaction pooling cannot hold the session-level singleton lock.
  if (url.hostname.endsWith('.neon.tech')) url.hostname = url.hostname.replace('-pooler.', '.');
  else if (url.hostname.includes('pooler')) throw new Error('Use a direct IBKR_WORKER_DATABASE_URL for the execution lock');
  return url.toString();
}
export function restartWindow(settings, now = new Date()) {
  const pieces = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: settings.twsRestartTimezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const minute = Number(pieces.hour) * 60 + Number(pieces.minute), restart = clockMinute(settings.twsRestartTime);
  const elapsed = (minute - restart + 1440) % 1440;
  return settings.connection === 'tws' && elapsed < settings.twsRestartGraceMinutes;
}
export async function assertSelectedHost(sql, hostId) {
  const rows = await sql`select value from app_settings where key='broker'`;
  if (rows[0]?.value.executionHostId !== hostId) throw new Error('Execution computer changed; this worker must stop');
}
export function createExecutionFence({ sql, backendPid, hostId, lockKey = 72762414 }) {
  let lost = false;
  let settingsRevision = null;
  const failure = () => new Error('Database execution lock or selected computer changed; stop and reconcile');
  const checkAlive = () => { if (lost) throw failure(); };
  const invalidate = () => { lost = true; };
  // A reserved postgres.js connection can reconnect. PID alone is insufficient:
  // every statement must also verify the actual advisory lock and selected host.
  // Keep the revision parameter typed as text: postgres.js serializes an inferred
  // timestamptz through JS Date, discarding PostgreSQL's microsecond precision.
  const predicate = ({ allowUnselected = false } = {}) => {
    checkAlive();
    return sql`pg_backend_pid() = ${backendPid}
      and exists (select 1 from pg_locks where locktype='advisory' and pid=pg_backend_pid() and classid=0 and objid=${lockKey} and objsubid=1 and granted)
      and (coalesce((select value->>'executionHostId' from app_settings where key='broker'),'') = ${hostId}
        or (${allowUnselected} and coalesce((select value->>'executionHostId' from app_settings where key='broker'),'') = ''))
      and (${settingsRevision}::text is null or (select updated_at from app_settings where key='broker') = ${settingsRevision}::text::timestamptz)`;
  };
  const assert = async (options) => {
    checkAlive();
    try {
      const [row] = await sql`select (${predicate(options)}) as fenced`;
      checkAlive();
      if (row?.fenced !== true) { invalidate(); throw failure(); }
    } catch (error) { invalidate(); throw error; }
  };
  const checkedWrite = rows => {
    checkAlive();
    if (!Array.isArray(rows) || !rows.length) { invalidate(); throw failure(); }
  };
  const bindSettingsRevision = revision => {
    checkAlive();
    if (typeof revision !== 'string' || !revision) throw new Error('Broker settings revision is unavailable');
    settingsRevision = revision;
  };
  return { assert, predicate, checkAlive, invalidate, checkedWrite, bindSettingsRevision };
}
export function chooseJournal(remote, local) {
  const chosen = remote ?? local;
  if (!chosen || typeof chosen !== 'object' || !chosen.intents || !chosen.fills || !chosen.signals) throw new Error('Execution journal is incomplete; reconciliation required');
  if (remote && local.account && remote.account && local.account !== remote.account) throw new Error('Local and hosted journals belong to different accounts');
  if (remote && Object.keys(local.intents ?? {}).some(ref => !Object.hasOwn(remote.intents, ref))) throw new Error('Hosted journal is missing locally recorded orders; reconcile before changing execution computers');
  return chosen;
}
