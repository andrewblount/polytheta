import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseJournal, createExecutionFence, directDatabaseUrl, localWorkerIdentity, restartWindow } from '../scripts/broker/host-runtime.mjs';
import { executionCycle } from '../scripts/broker/execution-engine.mjs';
import { validateBrokerSettings } from '../shared/broker-settings.mjs';

function fakeFenceSql(onRead = async () => [{ fenced: true }]) {
  const calls = [];
  const sql = (strings, ...values) => {
    const query = { text: strings.join('?'), values };
    if (query.text.startsWith('select (')) { calls.push(query); return onRead(query); }
    return query;
  };
  return { sql, calls };
}

test('execution fence atomically checks backend, actual advisory lock, selected host and settings revision', async () => {
  const db = fakeFenceSql();
  const fence = createExecutionFence({ sql: db.sql, backendPid: 42, hostId: 'host-a' });
  fence.bindSettingsRevision('2026-09-09 12:00:00.123456+00');
  await fence.assert();
  assert.equal(db.calls.length, 1);
  const predicate = db.calls[0].values[0];
  assert.match(predicate.text, /pg_backend_pid\(\).*exists.*pg_locks/s);
  assert.match(predicate.text, /objsubid=1 and granted/);
  assert.match(predicate.text, /executionHostId/);
  assert.ok(predicate.values.includes(42));
  assert.ok(predicate.values.includes(72762414));
  assert.ok(predicate.values.includes('host-a'));
  assert.ok(predicate.values.includes('2026-09-09 12:00:00.123456+00'));
});

test('settings revision fencing preserves PostgreSQL microseconds through the actual driver serializer', async () => {
  const { types } = await import('../node_modules/postgres/src/types.js');
  const revision = '2026-09-10 05:03:27.055567+00';
  // A timestamp-inferred bound string takes the driver's Date serializer and
  // loses 567 microseconds before PostgreSQL compares it with updated_at.
  assert.equal(types.date.serialize(revision), '2026-09-10T05:03:27.055Z');
  const db = fakeFenceSql();
  const fence = createExecutionFence({ sql: db.sql, backendPid: 42, hostId: 'host-a' });
  fence.bindSettingsRevision(revision);
  await fence.assert();
  const predicate = db.calls[0].values[0];
  assert.match(predicate.text, /select updated_at from app_settings where key='broker'\) = \?::text::timestamptz/);
  assert.doesNotMatch(predicate.text, /\?::timestamptz/);
  const wireRevision = types.string.serialize(predicate.values.at(-1));
  assert.equal(wireRevision, revision);
  assert.notEqual(wireRevision, '2026-09-10 05:03:27.055568+00');
});

test('a closed reserved connection poisons the worker even if a later query looks valid', async () => {
  const db = fakeFenceSql();
  const fence = createExecutionFence({ sql: db.sql, backendPid: 42, hostId: 'host-a' });
  await fence.assert();
  fence.invalidate();
  await assert.rejects(fence.assert(), /lock or selected computer changed/);
  assert.equal(db.calls.length, 1);
  assert.throws(() => fence.predicate(), /stop and reconcile/);
  assert.throws(() => fence.checkedWrite([{ key: 'journal' }]), /stop and reconcile/);
});

test('connection loss while a fence query resolves also blocks subsequent broker work', async () => {
  let fence;
  const db = fakeFenceSql(async () => { fence.invalidate(); return [{ fenced: true }]; });
  fence = createExecutionFence({ sql: db.sql, backendPid: 42, hostId: 'host-a' });
  await assert.rejects(fence.assert(), /stop and reconcile/);
});

test('host switch or rejected fenced persistence cannot be silently retried', async () => {
  const db = fakeFenceSql(async () => [{ fenced: false }]);
  const fence = createExecutionFence({ sql: db.sql, backendPid: 42, hostId: 'host-a' });
  await assert.rejects(fence.assert(), /stop and reconcile/);
  assert.throws(() => fence.checkedWrite([]), /stop and reconcile/);
  const other = createExecutionFence({ sql: fakeFenceSql().sql, backendPid: 42, hostId: 'host-a' });
  assert.throws(() => other.checkedWrite([]), /stop and reconcile/);
  await assert.rejects(other.assert(), /stop and reconcile/);
});

test('worker identity survives a Mac rename and is stored outside a checkout', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'polytheta-host-test-'));
  try {
    const first = localWorkerIdentity({ directory, hostname: 'Trading-Mac' });
    const second = localWorkerIdentity({ directory, hostname: 'Renamed-Mac' });
    assert.equal(first.id, second.id);
    assert.equal(second.hostname, 'Renamed-Mac');
    assert.equal(fs.statSync(path.join(directory, 'worker.json')).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(directory), ['worker.json']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('canonical journal cannot discard locally recorded order intents', () => {
  const local = { account: 'U_TEST', intents: { ref: { status: 'uncertain' } }, fills: {}, signals: {} };
  assert.throws(() => chooseJournal({ account: 'U_TEST', intents: {}, fills: {}, signals: {} }, local), /missing locally recorded orders/);
  const remote = { ...local, intents: { ...local.intents, other: { status: 'Submitted' } } };
  assert.equal(chooseJournal(remote, local), remote);
  assert.throws(() => chooseJournal({ ...remote, account: 'U_OTHER' }, local), /different accounts/);
});

test('database URLs use Neon direct endpoints and errors do not expose credentials', () => {
  assert.equal(new URL(directDatabaseUrl('postgres://test:placeholder@ep-example-pooler.us-east-2.aws.neon.tech/db?sslmode=require')).hostname, 'ep-example.us-east-2.aws.neon.tech');
  assert.throws(() => directDatabaseUrl('postgres://test:placeholder@custom-pooler.example/db'), /direct/);
  assert.throws(() => directDatabaseUrl('https://example.com/db'), /PostgreSQL/);
  assert.throws(() => directDatabaseUrl('broken secret placeholder'), error => !String(error.stack).includes('secret placeholder'));
});

test('expected TWS restart grace handles midnight and does not apply to Web API', () => {
  const settings = validateBrokerSettings({ twsRestartTime: '23:55', twsRestartGraceMinutes: 10, twsRestartTimezone: 'America/New_York' });
  assert.equal(restartWindow(settings, new Date('2026-09-10T04:01:00Z')), true);
  assert.equal(restartWindow(settings, new Date('2026-09-10T04:05:00Z')), false);
  assert.equal(restartWindow({ ...settings, connection: 'web-api' }, new Date('2026-09-10T04:01:00Z')), false);
});

function engineFixture(now) {
  const contract = { conid: 123, symbol: 'ABC', side: 'call', strike: 25, expiry: '2026-09-11', multiplier: 100, tick: .01 };
  const pick = { ticker: 'ABC', side: 'call' };
  const journal = { intents: { entry: { ref: 'entry', action: 'entry', contract, pick, week: '2026-09-07', quantity: 1, status: 'Filled' } },
    fills: { fill: { ref: 'entry', action: 'entry', contract, quantity: 1, price: 1, commission: 1 } }, signals: {} };
  const broker = { account: 'U_TEST', connect: async () => ({ mode: 'live' }), positions: async () => [{ conid: 123, quantity: -1 }], orders: async () => [], executions: async () => [],
    accountSummary: async () => ({ grossPositionValue: 100, netLiquidation: 10000 }), quote: async () => ({ conid: 123, bid: .45, ask: .55, bidSize: 10, askSize: 10, realtime: true, observedAt: +now }),
    submit: async () => { throw new Error('A broker submit must not occur'); }, modify: async () => { throw new Error('A broker modify must not occur'); }, cancel: async () => {},
  };
  return { broker, journal, contract, pick, settings: validateBrokerSettings({}), now, save: async () => {}, scanNews: async () => [], enabled: true };
}

test('an exit is not submitted if fencing finishes after the exchange closes', async t => {
  const now = new Date('2026-09-09T19:59:59Z');
  let wall = 0;
  t.mock.method(Date, 'now', () => wall);
  const args = engineFixture(now);
  args.journal.signals[123] = { manual: true };
  await assert.rejects(executionCycle({ ...args, beforeWrite: async () => { wall += 2000; } }), /Exchange session closed before submission/);
  const exit = Object.values(args.journal.intents).find(i => i.action === 'exit');
  assert.equal(exit.status, 'Cancelled');
  assert.match(exit.reconciledReason, /no order sent/);
});

test('an exit is not repriced if fencing finishes after the exchange closes', async t => {
  const now = new Date('2026-09-09T19:59:59Z');
  let wall = 0;
  t.mock.method(Date, 'now', () => wall);
  const args = engineFixture(now);
  args.journal.intents.exit = { ref: 'exit', action: 'exit', contract: args.contract, week: '2026-09-07', quantity: 1, status: 'Submitted', orderId: '2', submittedAt: '2026-09-09T19:55:00Z', limit: .5, ceiling: 1 };
  await executionCycle({ ...args, beforeWrite: async () => { wall += 2000; } });
  assert.equal(args.journal.intents.exit.status, 'Submitted');
  assert.equal(args.journal.intents.exit.limit, .5);
});

test('a stored entry deadline is enforced after the configured window is extended', async () => {
  const now = new Date('2026-09-08T14:31:00Z');
  const args = engineFixture(now);
  const entry = args.journal.intents.entry;
  Object.assign(entry, { status: 'Submitted', orderId: '1', quantity: 2, submittedAt: '2026-09-08T14:29:00Z', entryWindowEnd: '2026-09-08T14:30:00Z' });
  args.settings = validateBrokerSettings({ pauseEntries: false, mondayEntryEnd: '11:00', entryTimeoutSeconds: 900 });
  let cancelled = 0;
  args.broker.cancel = async () => { cancelled++; };
  await executionCycle(args);
  assert.equal(cancelled, 1);
  assert.equal(entry.status, 'PendingCancel');
});

test('a disabled execution check does not invoke write fencing or broker mutations', async () => {
  const args = engineFixture(new Date('2026-09-09T14:00:00Z'));
  args.journal.signals[123] = { manual: true };
  await executionCycle({ ...args, enabled: false, beforeWrite: async () => { throw new Error('Write fence must not be invoked'); } });
});
