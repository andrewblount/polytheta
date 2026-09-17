import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventName } from '@stoqey/ib';
import { validateBrokerSettings } from '../shared/broker-settings.mjs';
import settingsModule from '../src/server/services/broker-settings.ts';
import portfolioModule from '../src/server/services/broker-portfolio.ts';
import * as brokerModule from '../scripts/broker/index.mjs';
import * as journalModule from '../scripts/broker/host-runtime.mjs';
import { TwsBroker } from '../scripts/broker/tws.mjs';
import { WebApiBroker } from '../scripts/broker/web-api.mjs';
import { executionCycle } from '../scripts/broker/execution-engine.mjs';
import { resolveModelEquity } from '../shared/model-equity.mjs';

test('paper mode persists, defaults to the paper gateway port and rejects invalid modes', () => {
  const paper = validateBrokerSettings({ accountMode: 'paper' });
  assert.equal(paper.accountMode, 'paper');
  assert.equal(paper.twsPort, 4002);
  assert.equal(validateBrokerSettings({}).accountMode, 'live');
  for (const accountMode of ['both', '', null]) assert.throws(() => validateBrokerSettings({ accountMode }), /account mode/i);
});

test('switching account mode pauses entries and maps standard ports while preserving custom ports', () => {
  for (const [from, to] of [[4001, 4002], [7496, 7497], [4100, 4100]]) {
    const live = validateBrokerSettings({ twsPort: from, pauseEntries: false });
    const paper = settingsModule.mergeBrokerSettingsUpdate(live, { accountMode: 'paper', twsPort: from, pauseEntries: false });
    assert.equal(paper.twsPort, to);
    assert.equal(paper.pauseEntries, true);
    assert.equal(settingsModule.mergeBrokerSettingsUpdate(paper, { maxTrades: 6 }).accountMode, 'paper');
    assert.equal(settingsModule.mergeBrokerSettingsUpdate(paper, { accountMode: 'live' }).twsPort, from);
  }
});

test('paper runtime ignores live account and live activation and uses isolated storage', () => {
  assert.equal(typeof brokerModule.brokerRuntime, 'function');
  const env = { IBKR_ACCOUNT_ID: 'U123456', POLYTHETA_EXECUTION_ENABLED: 'true' };
  const paper = brokerModule.brokerRuntime(validateBrokerSettings({ accountMode: 'paper' }), env);
  assert.equal(paper.account, '');
  assert.equal(paper.enabled, false);
  assert.equal(paper.importLedger, false);
  const enabled = brokerModule.brokerRuntime(validateBrokerSettings({ accountMode: 'paper' }), { ...env, IBKR_PAPER_ACCOUNT_ID: 'DU123456', POLYTHETA_PAPER_EXECUTION_ENABLED: 'true' });
  assert.equal(enabled.account, 'DU123456');
  assert.equal(enabled.enabled, true);
  const live = brokerModule.brokerRuntime(validateBrokerSettings({}), env);
  assert.equal(live.account, env.IBKR_ACCOUNT_ID);
  assert.equal(live.enabled, true);
  assert.notEqual(live.journalKey, paper.journalKey);
  assert.notEqual(live.journalFile, paper.journalFile);
});

const twsSession = accounts => {
  const client = new EventEmitter();
  client.connect = () => client.emit(EventName.nextValidId, 1);
  client.reqManagedAccts = () => client.emit(EventName.managedAccounts, accounts.join(','));
  return client;
};

test('TWS attaches to the single authorized paper account without a stored login or account ID', async () => {
  const broker = new TwsBroker({ account: '', accountMode: 'paper', client: twsSession(['DU123456']) });
  assert.equal((await broker.connect()).mode, 'paper');
  assert.equal(broker.account, 'DU123456');
});

test('TWS paper selection rejects live, ambiguous, or unauthorized accounts', async () => {
  for (const accounts of [['U123456'], ['DU123456', 'DU654321']]) {
    await assert.rejects(new TwsBroker({ account: '', accountMode: 'paper', client: twsSession(accounts) }).connect(), /paper account/i);
  }
  await assert.rejects(new TwsBroker({ account: 'U123456', accountMode: 'paper', client: twsSession(['U123456']) }).connect(), /paper account/i);
  await assert.rejects(new TwsBroker({ account: 'DU999999', accountMode: 'paper', client: twsSession(['DU123456']) }).connect(), /authorized/i);
  await assert.rejects(new TwsBroker({ account: 'DU123456', accountMode: 'live', client: twsSession(['DU123456']) }).connect(), /live account/i);
});

test('Web API detects paper only when it is also selected in the authenticated session', async () => {
  const requestImpl = async (_method, path) => ({
    'iserver/auth/status': { authenticated: true, connected: true },
    'portfolio/accounts': [{ id: 'DU123456' }],
    'iserver/accounts': { selectedAccount: 'DU123456' },
  })[path];
  const broker = new WebApiBroker({ account: '', accountMode: 'paper', requestImpl });
  assert.equal((await broker.connect()).mode, 'paper');
  assert.equal(broker.account, 'DU123456');
  await assert.rejects(new WebApiBroker({ account: '', accountMode: 'paper', requestImpl: async (method, path) => path === 'iserver/accounts' ? { selectedAccount: 'U123456' } : requestImpl(method, path) }).connect(), /Select the configured/);
});

test('paper settings accept paper reads and reject live sessions before portfolio reads or writes', async () => {
  const broker = { account: 'DU123456', connect: async () => ({ mode: 'paper' }), positions: async () => [], orders: async () => [], executions: async () => [], accountSummary: async () => ({ netLiquidation: 10000, grossPositionValue: 0 }) };
  const args = { broker, settings: validateBrokerSettings({ accountMode: 'paper' }), journal: {}, save: async () => {} };
  const result = await executionCycle(args);
  assert.equal(result.health.mode, 'paper');
  assert.equal(args.journal.mode, 'paper');
  broker.connect = async () => ({ mode: 'live' });
  broker.positions = async () => assert.fail('must reject before reading a live portfolio');
  await assert.rejects(executionCycle({ ...args, journal: {}, enabled: true, allowPaper: true }), /account mode/i);
  broker.connect = async () => ({ mode: 'paper' });
  await assert.rejects(executionCycle({ ...args, settings: validateBrokerSettings({}), journal: {}, allowPaper: true }), /account mode/i);
});

test('mode journals preserve legacy ownership without adopting the other mode', () => {
  assert.equal(typeof journalModule.chooseModeJournal, 'function');
  const live = { mode: 'live', account: 'U123456', intents: { live: {} }, fills: {}, signals: {} };
  const paper = { mode: 'paper', account: 'DU123456', intents: { paper: {} }, fills: {}, signals: {} };
  assert.deepEqual(journalModule.chooseModeJournal('paper', { legacyRemote: live }).intents, {});
  assert.deepEqual(journalModule.chooseModeJournal('live', { legacyRemote: live }), live);
  assert.deepEqual(journalModule.chooseModeJournal('paper', { remote: paper, legacyRemote: live }), paper);
  assert.throws(() => journalModule.chooseModeJournal('paper', { remote: live }), /account mode/i);
});

test('equity and portfolio snapshots cannot cross account modes', () => {
  const now = new Date('2026-09-17T14:00:00Z');
  const settings = { accountMode: 'live', executionHostId: 'h', connection: 'tws' };
  const paper = { mode: 'paper', hostId: 'h', connection: 'tws', observedAt: now.toISOString(), netLiquidation: 1000000 };
  assert.throws(() => resolveModelEquity({ settings, brokerEquity: paper, now, env: {} }), /account mode/i);
  assert.equal(portfolioModule.brokerPortfolioIsStale({ settings, snapshot: paper, status: { ...paper, connected: true }, settingsUpdatedAt: new Date(+now - 1000) }, now), true);
});
