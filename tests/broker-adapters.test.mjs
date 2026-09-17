import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EventName } from '@stoqey/ib';
import { TwsBroker } from '../scripts/broker/tws.mjs';
import { WebApiBroker } from '../scripts/broker/web-api.mjs';
import { normalizeOrderStatus } from '../scripts/broker/adapter-utils.mjs';
import { normalizePriceIncrements, roundPrice, tickForPrice } from '../shared/price-increments.mjs';

const account = 'U_TEST';
const increments = [{ lowEdge: 0, increment: .01 }, { lowEdge: 3, increment: .05 }];
const contract = { conid: 123, symbol: 'ABC', strike: 25, expiry: '2026-09-11', side: 'call', multiplier: 100, tick: .01, priceIncrements: increments, raw: { conId: 123, exchange: 'SMART' } };

test('TWS subscribed option quotes wait for valid underlying and Greeks and record their receipt time', async () => {
  const client = new EventEmitter();
  let cancelled = 0;
  client.reqMarketDataType = type => assert.equal(type, 1);
  client.cancelMktData = () => cancelled++;
  client.reqMktData = (id, raw, ticks, snapshot, regulatory) => {
    assert.equal(snapshot, false); assert.equal(regulatory, false);
    client.emit(EventName.marketDataType, id, 1);
    client.emit(EventName.tickPrice, id, 1, .45); client.emit(EventName.tickPrice, id, 2, .55);
    client.emit(EventName.tickSize, id, 0, 10); client.emit(EventName.tickSize, id, 3, 10);
    client.emit(EventName.tickOptionComputation, id, 13, 0, -1, -2, 0, 0, 0, 0, 0, -1);
    client.emit(EventName.tickOptionComputation, id, 13, 0, .48, .18, .5, 0, .01, .02, -.1, 20);
  };
  const q = await new TwsBroker({ account, client }).quote(contract);
  assert.equal(q.underlyingPrice, 20); assert.equal(q.delta, .18); assert.equal(q.optionIv, .48);
  assert.equal(q.realtime, true); assert.equal(cancelled, 1);
  assert.ok(Number.isFinite(q.underlyingObservedAt), 'Underlying receipt timestamp is required');
  assert.ok(q.observedAt <= q.underlyingObservedAt, 'Freshness includes underlying data');
  assert.equal(client.listenerCount(EventName.tickPrice), 0);
});

test('TWS joins commission callbacks that arrive before or after execDetailsEnd', async () => {
  for (const late of [false, true]) {
    const client = new EventEmitter();
    client.reqExecutions = id => {
      client.emit(EventName.execDetails, id, { conId: 123 }, { acctNumber: account, execId: 'trade.01', orderId: 9, orderRef: 'pt-one', shares: 1, price: .5, side: 'SLD', time: '20260909-14:00:00' });
      const fee = () => client.emit(EventName.commissionReport, { execId: 'trade.01', commission: 1.25, currency: 'USD' });
      if (!late) fee();
      client.emit(EventName.execDetailsEnd, id);
      if (late) setTimeout(fee, 10);
    };
    const broker = new TwsBroker({ account, client, commissionWaitMs: 100 });
    const rows = await broker.executions();
    assert.equal(rows[0].commission, 1.25);
    assert.equal(rows[0].time, '2026-09-09T14:00:00Z');
    assert.equal(broker.nextOrderId, 10);
  }
});

test('TWS missing or non-USD fees stay unknown instead of becoming zero', async () => {
  const client = new EventEmitter();
  client.reqExecutions = id => {
    client.emit(EventName.execDetails, id, { conId: 123 }, { acctNumber: account, execId: 'trade.01', orderId: 9, orderRef: 'pt-one', shares: 1, price: .5, side: 'SLD', time: '20260909-14:00:00' });
    client.emit(EventName.commissionReport, { execId: 'trade.01', commission: 1.25, currency: 'EUR' });
    client.emit(EventName.execDetailsEnd, id);
  };
  const broker = new TwsBroker({ account, client, commissionWaitMs: 1 });
  assert.equal((await broker.executions())[0].commission, null);
});

test('TWS order IDs exceed all observed IDs while snapshots exclude other accounts', async () => {
  const client = new EventEmitter();
  client.reqAllOpenOrders = () => {
    client.emit(EventName.openOrder, 500, { conId: 9 }, { account: 'U_OTHER', orderRef: 'external', clientId: 7 }, { status: 'Submitted' });
    client.emit(EventName.openOrder, 400, { conId: 123 }, { account, orderRef: 'pt-one', clientId: 96 }, { status: 'PreSubmitted' });
    client.emit(EventName.openOrderEnd);
  };
  client.reqCompletedOrders = () => {
    client.emit(EventName.completedOrder, { conId: 234 }, { account, orderRef: 'pt-done', filledQuantity: 1 }, { status: 'Unknown', completedStatus: 'Cancelled' });
    client.emit(EventName.completedOrdersEnd);
  };
  const broker = new TwsBroker({ account, client });
  client.emit(EventName.nextValidId, 2);
  const rows = await broker.orders();
  assert.equal(broker.nextOrderId, 501);
  client.emit(EventName.nextValidId, 3);
  assert.equal(broker.nextOrderId, 501);
  client.emit(EventName.orderStatus, 600, 'Submitted', 0, 1, 0);
  assert.equal(broker.nextOrderId, 601);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'PreSubmitted');
  assert.equal(rows[1].status, 'Cancelled');
  assert.equal(Object.hasOwn(rows[1], 'orderId'), false);
});

test('TWS cancellation waits through PendingCancel and cannot cancel another client order', async () => {
  const client = new EventEmitter();
  const broker = new TwsBroker({ account, client });
  client.emit(EventName.openOrder, 1, { conId: 123 }, { account, clientId: 96 }, { status: 'Submitted' });
  let confirmed = false;
  client.cancelOrder = id => {
    client.emit(EventName.orderStatus, id, 'PendingCancel', 1, 1, .5);
    client.emit(EventName.error, new Error('Order cancelled'), 202, id);
    setTimeout(() => { confirmed = true; client.emit(EventName.orderStatus, id, 'Cancelled', 1, 1, .5); }, 10);
  };
  assert.equal((await broker.cancel('1')).status, 'Cancelled');
  assert.equal(confirmed, true);
  client.emit(EventName.openOrder, 2, { conId: 123 }, { account, clientId: 97 }, { status: 'Submitted' });
  await assert.rejects(broker.cancel('2'), /not controllable/);
});

test('TWS resolves the SMART price rule, rather than the minimum tick alone', async () => {
  const client = new EventEmitter();
  client.reqContractDetails = id => {
    client.emit(EventName.contractDetails, id, { contract: { conId: 123, symbol: 'ABC', right: 'C', currency: 'USD', multiplier: '100', strike: 25, lastTradeDateOrContractMonth: '20260911' }, validExchanges: 'CBOE,SMART', marketRuleIds: '7,8', minTick: .01, underConId: 456 });
    client.emit(EventName.contractDetailsEnd, id);
  };
  client.reqMarketRule = id => { assert.equal(id, 8); client.emit(EventName.marketRule, id, increments); };
  const broker = new TwsBroker({ account, client });
  const resolved = await broker.resolve({ ticker: 'ABC', side: 'call', K: 25 }, '2026-09-11');
  assert.deepEqual(resolved.priceIncrements, increments);
  assert.equal(resolved.tick, .01);
  assert.equal(broker.payload({ action: 'entry', contract: resolved, limit: .15, quantity: 1, ref: 'pt-test' }).lmtPrice, .15);
  assert.throws(() => broker.payload({ action: 'entry', contract: resolved, limit: 3.01, quantity: 1 }), /price increment/);
});

test('price rounding handles penny and nickel bands at their boundary', () => {
  assert.equal(roundPrice(.155, contract, 'floor'), .15);
  assert.equal(roundPrice(.155, contract, 'ceil'), .16);
  assert.equal(roundPrice(2.999, contract, 'ceil'), 3);
  assert.equal(roundPrice(3.01, contract, 'floor'), 3);
  assert.equal(roundPrice(3.01, contract, 'ceil'), 3.05);
  assert.equal(tickForPrice(3, contract), .05);
  assert.throws(() => normalizePriceIncrements([{ lowEdge: 1, increment: .01 }]), /invalid/);
});

test('Web API resolves price rules on both sides using the configured account', async () => {
  const paths = [];
  const broker = new WebApiBroker({ account, requestImpl: async (method, path) => {
    assert.equal(method, 'GET'); paths.push(path);
    if (path.includes('secdef/search')) return [{ symbol: 'ABC', conid: 456, sections: [{ secType: 'OPT' }] }];
    if (path.includes('secdef/strikes')) return { call: [25] };
    if (path.includes('secdef/info')) return [{ conid: 123, maturityDate: '20260911', strike: 25, right: 'C', multiplier: '100', currency: 'USD' }];
    if (path.includes('info-and-rules')) return { con_id: 123, currency: 'USD', rules: { canTradeAcctIds: [account], incrementRules: increments.map(r => ({ lowerEdge: r.lowEdge, increment: r.increment })) } };
    throw new Error(`Unexpected mocked endpoint: ${path}`);
  } });
  const resolved = await broker.resolve({ ticker: 'ABC', side: 'call', K: 25 }, '2026-09-11');
  assert.deepEqual(resolved.priceIncrements, increments);
  assert.equal(paths.filter(p => p.includes('info-and-rules')).length, 2);
  assert.equal(broker.orderPayload({ action: 'entry', contract: resolved, quantity: 1, limit: .15 }).price, .15);
  assert.throws(() => broker.orderPayload({ action: 'entry', contract: resolved, quantity: 1, limit: 3.01 }), /price increment/);
});

test('Web API does not accept a different session-selected account', async () => {
  const broker = new WebApiBroker({ account, requestImpl: async (method, path) => {
    assert.equal(method, 'GET');
    if (path === 'iserver/auth/status') return { authenticated: true, connected: true };
    if (path === 'portfolio/accounts') return [{ id: account }, { id: 'U_OTHER' }];
    return { selectedAccount: 'U_OTHER' };
  } });
  await assert.rejects(broker.connect(), /Select the configured/);
});

test('Web API requires a complete order snapshot and normalizes pending states', async () => {
  let calls = 0;
  const broker = new WebApiBroker({ account, requestImpl: async () => ++calls === 1
    ? { orders: [], snapshot: false }
    : { snapshot: true, orders: [{ acct: account, orderId: 9, order_ref: 'pt-one', conid: 123, status: 'pre_cancelled' }, { acct: 'U_OTHER', orderId: 8 }] } });
  const rows = await broker.orders();
  assert.equal(calls, 2); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'PendingCancel');
  assert.equal(normalizeOrderStatus('WarnState'), 'uncertain');
  const incomplete = new WebApiBroker({ account, requestImpl: async () => ({ orders: [], snapshot: false }) });
  await assert.rejects(incomplete.orders(), /Incomplete/);
});

test('both summaries expose actual margin fields without treating missing data as zero', async () => {
  const client = new EventEmitter();
  client.reqAccountSummary = (id, group, tags) => {
    assert.ok(tags.includes('InitMarginReq,MaintMarginReq,GrossPositionValue'));
    for (const [tag, value] of Object.entries({ NetLiquidation: 10000, AvailableFunds: 9000, ExcessLiquidity: 9200, TotalCashValue: 9500, InitMarginReq: 1000, MaintMarginReq: 800, GrossPositionValue: 5000 })) client.emit(EventName.accountSummary, id, account, tag, String(value), 'USD');
    client.emit(EventName.accountSummaryEnd, id);
  };
  client.cancelAccountSummary = () => {};
  const tws = await new TwsBroker({ account, client }).accountSummary();
  const web = await new WebApiBroker({ account, requestImpl: async () => Object.fromEntries(Object.entries({ netliquidation: 10000, availablefunds: 9000, excessliquidity: 9200, totalcashvalue: 9500, initmarginreq: 1000, maintmarginreq: 800, grosspositionvalue: 5000 }).map(([key, amount]) => [key, { amount, currency: 'USD' }])) }).accountSummary();
  assert.deepEqual(web, tws);
  const missing = await new WebApiBroker({ account, requestImpl: async () => ({}) }).accountSummary();
  assert.equal(Number.isNaN(missing.initialMargin), true);
});
