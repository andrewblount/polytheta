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
test('paper entry week is explicit, validated and never restricts the live runtime', () => {
  const env = { POLYTHETA_PAPER_ENTRY_WEEK: '2026-09-21' };
  assert.equal(brokerModule.brokerRuntime({ accountMode: 'paper' }, env).authorizedEntryWeek, '2026-09-21');
  assert.equal(brokerModule.brokerRuntime({ accountMode: 'live' }, env).authorizedEntryWeek, undefined);
  for (const week of ['2026-09-22', 'invalid', '2026-02-30']) {
    assert.throws(() => brokerModule.brokerRuntime({ accountMode: 'paper' }, { POLYTHETA_PAPER_ENTRY_WEEK: week }), /Monday/);
  }
});

test('IB basket market reads use a separate client, matching account mode, and always disconnect', async () => {
  assert.equal(typeof brokerModule.readBasketMarketData, 'function');
  const settings = validateBrokerSettings({ accountMode: 'paper' });
  let disconnected = 0, mode = 'paper';
  const contract = { conid: 123 }, quote = { conid: 123, realtime: true };
  const factory = config => {
    assert.equal(config.twsClientId, 97); assert.equal(config.accountMode, 'paper');
    return { connect: async () => ({ mode }), resolve: async () => contract, quote: async () => quote, disconnect: () => disconnected++ };
  };
  const picks = [{ ticker: 'ABC', side: 'call', K: 20 }];
  assert.deepEqual(await brokerModule.readBasketMarketData(picks, '2026-09-25', settings, { factory, env: {} }), [{ contract, quote }]);
  mode = 'live';
  await assert.rejects(brokerModule.readBasketMarketData(picks, '2026-09-25', settings, { factory, env: {} }), /account mode/);
  assert.equal(disconnected, 2);
  await assert.rejects(brokerModule.readBasketMarketData(picks, '2026-09-25', settings, { factory, env: { IBKR_MARKET_DATA_CLIENT_ID: '96' } }), /different/);
  await assert.rejects(brokerModule.readBasketMarketData(picks, '2026-09-25', settings, { factory: () => ({ connect: async () => { throw new Error('disconnected'); }, disconnect: () => disconnected++ }), env: {} }), /disconnected/);
  assert.equal(disconnected, 3);
});

test('IB market probe reports genuine data readiness without submitting or changing an account', async () => {
  assert.equal(typeof brokerModule.marketDataReadiness, 'function');
  const settings = validateBrokerSettings({ accountMode: 'paper' }), now = new Date('2026-09-21T14:00:00Z');
  const quote = { conid: 123, source: 'IB TWS', realtime: true, observedAt: +now, bid: .4, ask: .5, bidSize: 10, askSize: 10, delta: .18, optionIv: .48, underlyingPrice: 20 };
  const data = [{ contract: { conid: 123, symbol: 'ABC', side: 'call', strike: 21, expiry: '2026-09-25' }, quote }];
  assert.equal(brokerModule.marketDataReadiness(data, settings, now).ready, true);
  for (const bad of [{ realtime: false }, { observedAt: +now - 16000 }, { optionIv: -1 }, { underlyingPrice: -1 }]) {
    assert.throws(() => brokerModule.marketDataReadiness([{ ...data[0], quote: { ...quote, ...bad } }], settings, now), /IB/);
  }
  assert.throws(() => brokerModule.marketDataReadiness([], settings, now), /empty/);
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
