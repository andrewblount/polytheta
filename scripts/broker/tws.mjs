import { IBApi, EventName } from '@stoqey/ib';
import { assertValidLimit, normalizeOrderStatus, normalizePriceIncrements, selectBrokerAccount } from './adapter-utils.mjs';
export class TwsBroker {
  constructor({ account = process.env.IBKR_ACCOUNT_ID, accountMode = 'live', host = process.env.IBKR_TWS_HOST ?? '127.0.0.1', port = Number(process.env.IBKR_TWS_PORT ?? 4001), clientId = Number(process.env.IBKR_TWS_CLIENT_ID ?? 96), client, commissionWaitMs = 2000 } = {}) {
    this.account = account; this.accountMode = accountMode; this.kind = 'tws'; this.id = 100000; this.nextOrderId = null;
    this.clientId = clientId; this.commissionWaitMs = commissionWaitMs;
    this.ib = client ?? new IBApi({ host, port, clientId });
    this.ib.on(EventName.error, () => {}); // request-specific errors handled below
    this.ib.on(EventName.nextValidId, n => { this.nextOrderId = Math.max(this.nextOrderId ?? n, n); });
    this.statuses = new Map(); this.fees = new Map(); this.executionRows = new Map(); this.openOrderDetails = new Map();
    this.ib.on(EventName.openOrder, (id, contract, order, state) => {
      this.observeOrderId(id);
      this.openOrderDetails.set(String(id), { contract, order, state });
    });
    this.ib.on(EventName.orderStatus, (id, status, filled, remaining, avgFillPrice) => {
      this.observeOrderId(id);
      this.statuses.set(String(id), { orderId: String(id), status: normalizeOrderStatus(status), filled: Number(filled), remaining: Number(remaining), avgFillPrice });
    });
    this.ib.on(EventName.commissionReport, report => {
      const fee = Number(report.commission);
      if (report.commission == null || !Number.isFinite(fee) || Math.abs(fee) >= 1e100 || report.currency && report.currency !== 'USD') return;
      this.fees.set(report.execId, fee);
      const row = this.executionRows.get(report.execId);
      if (row) row.commission = fee;
    });
  }
  observeOrderId(value) {
    const id = Number(value);
    if (Number.isSafeInteger(id) && id >= 0) this.nextOrderId = Math.max(this.nextOrderId ?? 0, id + 1);
  }
  collect(event, endEvent, start, { id, select = args => args, timeout = 15000, cancel = () => {}, endWhen = () => true, ignoredErrorCodes = [] } = {}) {
    return new Promise((resolve, reject) => {
      const rows = []; let finished = false;
      const finish = (error) => {
        if (finished) return; finished = true;
        clearTimeout(timer); this.ib.off(event, item); this.ib.off(endEvent, end); this.ib.off(EventName.error, failed);
        try { cancel(); } catch (err) { error ??= err; }
        if (error) reject(error); else resolve(rows);
      };
      const item = (...args) => { if (id == null || args[0] === id) { const row = select(args); if (row != null) rows.push(row); } };
      const end = (...args) => { if ((id == null || args[0] === id) && endWhen(args)) finish(); };
      const failed = (error, code, reqId) => { if (!ignoredErrorCodes.includes(code) && (code === 502 || code === 504 || reqId === id && id != null)) finish(new Error(`IB TWS request failed (${code})`)); };
      const timer = setTimeout(() => finish(new Error('IB TWS response timed out')), timeout);
      this.ib.on(event, item); this.ib.on(endEvent, end); this.ib.on(EventName.error, failed);
      try { start(); } catch (err) { finish(err); }
    });
  }
  async connect() {
    if (!this.account && this.accountMode !== 'paper') throw new Error('IBKR_ACCOUNT_ID is not configured on this Mac');
    await this.collect(EventName.nextValidId, EventName.nextValidId, () => this.ib.connect());
    const rows = await this.collect(EventName.managedAccounts, EventName.managedAccounts, () => this.ib.reqManagedAccts());
    const accounts = String(rows[0]?.[0] ?? '').split(',');
    this.account = selectBrokerAccount(accounts, this.account, this.accountMode);
    return { connected: true, mode: /^DU/.test(this.account) ? 'paper' : 'live', connection: this.kind };
  }
  async positions() {
    return this.collect(EventName.updatePortfolio, EventName.accountDownloadEnd, () => this.ib.reqAccountUpdates(true, this.account), {
      select: ([contract, quantity, marketPrice, marketValue, averageCost, , , account]) => account === this.account ? { conid: contract.conId, quantity: Number(quantity), symbol: contract.symbol, contract, marketPrice, marketValue, averageCost } : null,
      endWhen: ([account]) => account === this.account,
      cancel: () => this.ib.reqAccountUpdates(false, this.account),
    });
  }
  async accountSummary() {
    const id = ++this.id;
    const rows = await this.collect(EventName.accountSummary, EventName.accountSummaryEnd,
      () => this.ib.reqAccountSummary(id, 'All', 'NetLiquidation,AvailableFunds,ExcessLiquidity,TotalCashValue,InitMarginReq,MaintMarginReq,GrossPositionValue'), {
        id, select: ([, account, tag, value, currency]) => account === this.account ? { tag, value: Number(value), currency } : null,
        cancel: () => this.ib.cancelAccountSummary(id),
      });
    if (rows.some(r => r.currency !== 'USD')) throw new Error('Execution requires USD account summary values');
    const values = Object.fromEntries(rows.map(r => [r.tag, r.value]));
    return { netLiquidation: values.NetLiquidation, availableFunds: values.AvailableFunds, excessLiquidity: values.ExcessLiquidity, cash: values.TotalCashValue, initialMargin: values.InitMarginReq, maintenanceMargin: values.MaintMarginReq, grossPositionValue: values.GrossPositionValue };
  }
  async resolve(pick, expiry) {
    const id = ++this.id;
    const rows = await this.collect(EventName.contractDetails, EventName.contractDetailsEnd, () => this.ib.reqContractDetails(id, {
      symbol: pick.ticker, secType: 'OPT', exchange: 'SMART', currency: 'USD', lastTradeDateOrContractMonth: expiry.replaceAll('-', ''), strike: pick.K, right: pick.side === 'call' ? 'C' : 'P', multiplier: 100,
    }), { id, select: ([, details]) => details });
    const exact = rows.filter(d => d.contract.symbol === pick.ticker && d.contract.right === (pick.side === 'call' ? 'C' : 'P') && d.contract.currency === 'USD' && Number(d.contract.multiplier) === 100 && Number(d.contract.strike) === pick.K && d.contract.lastTradeDateOrContractMonth?.slice(0,8) === expiry.replaceAll('-', ''));
    if (exact.length !== 1) throw new Error(`Exact standard option unavailable or ambiguous: ${pick.ticker}`);
    const d = exact[0];
    const exchanges = String(d.validExchanges ?? '').split(',').map(x => x.trim());
    const ruleIds = String(d.marketRuleIds ?? '').split(',').map(Number);
    const ruleId = ruleIds[exchanges.indexOf('SMART')];
    if (!Number.isSafeInteger(ruleId) || ruleId <= 0) throw new Error('IB SMART price-increment rule is unavailable');
    const rules = await this.collect(EventName.marketRule, EventName.marketRule, () => this.ib.reqMarketRule(ruleId), { id: ruleId, select: ([, increments]) => increments });
    const priceIncrements = normalizePriceIncrements(rules[0]);
    return { conid: d.contract.conId, symbol: pick.ticker, expiry, side: pick.side, strike: pick.K, multiplier: 100, tick: Math.min(...priceIncrements.map(r => r.increment)), priceIncrements, underlyingConid: d.underConId, raw: { ...d.contract, exchange: 'SMART' } };
  }
  quote(contract, { entry = true } = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const q = { conid: contract.conid, source: 'IB TWS', realtime: false };
      let bidAt = 0, askAt = 0, finished = false;
      const finish = error => {
        if (finished) return; finished = true;
        clearTimeout(timer); this.ib.cancelMktData(id);
        for (const [name, fn] of listeners) this.ib.off(name, fn);
        if (error) reject(error); else resolve({ ...q, observedAt: Math.min(bidAt, askAt) });
      };
      const ready = () => { if (q.realtime && q.bid >= 0 && q.ask > 0 && q.ask >= q.bid && Number.isFinite(q.bidSize) && q.askSize > 0 && (!entry || q.bid > 0 && q.bidSize > 0 && Number.isFinite(q.delta) && Number.isFinite(q.underlyingPrice))) finish(); };
      const listeners = [
        [EventName.tickPrice, (req, field, value) => { if (req !== id) return; if (field === 1) { q.bid = value; bidAt = Date.now(); } if (field === 2) { q.ask = value; askAt = Date.now(); } ready(); }],
        [EventName.tickSize, (req, field, value) => { if (req !== id) return; if (field === 0) q.bidSize = Number(value); if (field === 3) q.askSize = Number(value); ready(); }],
        [EventName.marketDataType, (req, type) => { if (req !== id) return; q.realtime = type === 1; if (type !== 1) finish(new Error('IB option data is delayed or frozen')); else ready(); }],
        [EventName.tickOptionComputation, (req, field, ...values) => { if (req !== id || field !== 13) return; /* signature includes tickAttrib */ q.optionIv = values[1]; q.delta = values[2]; q.underlyingPrice = values[8]; ready(); }],
        [EventName.error, (error, code, req) => { if (req === id) finish(new Error(`IB market data unavailable (${code})`)); }],
      ];
      const timer = setTimeout(() => finish(new Error('IB live bid/ask/greeks unavailable')), 15000);
      for (const [name, fn] of listeners) this.ib.on(name, fn);
      this.ib.reqMarketDataType(1);
      this.ib.reqMktData(id, contract.raw ?? { conId: contract.conid, exchange: 'SMART', secType: 'OPT' }, '', false, false);
    });
  }
  payload(order, whatIf = false) {
    assertValidLimit(order);
    return { account: this.account, action: order.action === 'entry' ? 'SELL' : 'BUY', orderType: 'LMT', lmtPrice: order.limit, totalQuantity: order.quantity, tif: 'DAY', outsideRth: false, orderRef: order.ref, transmit: true, whatIf };
  }
  async preview(order) {
    const id = this.nextOrderId++;
    const rows = await this.collect(EventName.openOrder, EventName.openOrder, () => this.ib.placeOrder(id, order.contract.raw, this.payload(order, true)), { id, select: ([, , , state]) => state });
    const s = rows[0];
    return { initialMarginChange: Number(s?.initMarginChange), maintenanceMarginChange: Number(s?.maintMarginChange), warning: s?.warningText };
  }
  async submit(order) {
    const id = this.nextOrderId++;
    const rows = await this.collect(EventName.openOrder, EventName.openOrder, () => this.ib.placeOrder(id, order.contract.raw, this.payload(order)), { id, select: ([, , , state]) => state });
    return { orderId: String(id), status: this.statuses.get(String(id))?.status ?? normalizeOrderStatus(rows[0]?.status) };
  }
  async orders() {
    const rows = await this.collect(EventName.openOrder, EventName.openOrderEnd, () => this.ib.reqAllOpenOrders(), {
      select: ([id, contract, order, state]) => order.account === this.account ? { orderId: String(id), clientId: order.clientId, permId: order.permId, conid: contract.conId, ref: order.orderRef, status: normalizeOrderStatus(state.status), limit: order.lmtPrice, ...this.statuses.get(String(id)) } : null,
    });
    const completed = await this.collect(EventName.completedOrder, EventName.completedOrdersEnd, () => this.ib.reqCompletedOrders(false), {
      // completedOrder does not include an API orderId in the TWS wire format.
      select: ([contract, order, state]) => order.account === this.account ? { ...(Number.isSafeInteger(order.orderId) ? { orderId: String(order.orderId) } : {}), permId: order.permId, conid: contract.conId, ref: order.orderRef, status: normalizeOrderStatus(state.completedStatus || state.status), filled: Number(order.filledQuantity) } : null,
    });
    for (const item of completed) if (!rows.some(r => r.ref === item.ref)) rows.push(item);
    return rows;
  }
  async executions() {
    const id = ++this.id;
    const rows = await this.collect(EventName.execDetails, EventName.execDetailsEnd, () => this.ib.reqExecutions(id, { acctCode: this.account }), {
      id, select: ([, contract, x]) => {
        if (x.acctNumber !== this.account) return null;
        this.observeOrderId(x.orderId);
        const row = { executionId: x.execId, orderId: String(x.orderId), ref: x.orderRef, conid: contract.conId, quantity: Number(x.shares), price: x.price, side: x.side, time: parseIbTime(x.time), commission: this.fees.get(x.execId) ?? null };
        this.executionRows.set(x.execId, row);
        return row;
      },
    });
    // Commissions are separate callbacks and can follow execDetailsEnd. Keep
    // joining them by execId during this bounded grace period; missing fees
    // remain unknown and are fetched again on subsequent cycles.
    if (rows.some(row => row.commission == null)) await new Promise(resolve => {
      let timer;
      const done = () => { clearTimeout(timer); this.ib.off(EventName.commissionReport, check); resolve(); };
      const check = () => { if (rows.every(row => row.commission != null)) done(); };
      this.ib.on(EventName.commissionReport, check);
      timer = setTimeout(done, this.commissionWaitMs);
      check();
    });
    return rows;
  }
  async modify(orderId, order) {
    const id = Number(orderId);
    this.assertOwnedOrder(id);
    await this.collect(EventName.openOrder, EventName.openOrder, () => this.ib.placeOrder(id, order.contract.raw, this.payload(order)), { id });
  }
  async cancel(orderId) {
    const id = Number(orderId);
    this.assertOwnedOrder(id);
    await this.collect(EventName.orderStatus, EventName.orderStatus, () => this.ib.cancelOrder(id, ''), {
      id, select: args => args, endWhen: ([, status]) => ['Cancelled', 'ApiCancelled', 'Filled'].includes(normalizeOrderStatus(status)), ignoredErrorCodes: [202],
    });
    const status = this.statuses.get(String(id));
    if (!['Cancelled', 'ApiCancelled', 'Filled'].includes(status?.status)) throw new Error('IB cancellation is not yet confirmed; reconcile before another order');
    return status;
  }
  assertOwnedOrder(id) {
    const details = this.openOrderDetails.get(String(id));
    if (!Number.isSafeInteger(id) || id < 0 || !details || details.order.account !== this.account || Number(details.order.clientId) !== this.clientId) throw new Error('IB order is not controllable by the configured account and TWS client ID');
  }
  disconnect() { this.ib.disconnect(); }
}

// Configure TWS API date/time output as UTC. Ambiguous local timestamps stay
// unknown, rather than silently booking a fill to the wrong date.
export function parseIbTime(value) {
  const match = String(value).match(/^(\d{4})(\d{2})(\d{2})[ -]+(\d{2}:\d{2}:\d{2})(?:\s+(UTC|GMT))?$/);
  if (!match || !match[5] && !String(value).includes('-') && process.env.IBKR_TWS_TIME_ZONE !== 'UTC') return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}Z`;
}
