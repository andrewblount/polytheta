import https from 'node:https';
import { retryRead } from '../../shared/retry.mjs';
import { assertValidLimit, normalizeOrderStatus, normalizePriceIncrements, selectBrokerAccount } from './adapter-utils.mjs';
export class WebApiBroker {
  constructor({ baseUrl = process.env.IBKR_WEB_API_URL ?? 'https://localhost:5000/v1/api', account = process.env.IBKR_ACCOUNT_ID, accountMode = 'live', token = process.env.IBKR_ACCESS_TOKEN, requestImpl, ordersPreflightDelayMs = requestImpl ? 0 : 5100 } = {}) {
    this.base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (this.base.protocol !== 'https:' || this.base.username || this.base.password) throw new Error('IB Web API requires HTTPS without embedded credentials');
    this.account = account; this.accountMode = accountMode; this.token = token; this.requestImpl = requestImpl;
    this.kind = 'web-api'; this.ordersPreflightDelayMs = ordersPreflightDelayMs;
    this.requestTurn = Promise.resolve(); this.lastRequestAt = 0;
  }
  async request(method, path, body) {
    const run = async () => {
      if (this.requestImpl) return this.requestImpl(method, path, body);
      // IB applies a username-wide 10 requests/sec limit. Space this service's
      // requests, including retries; concurrent portfolio reads share the gate.
      const turn = this.requestTurn.then(async () => {
        const delay = 110 - (Date.now() - this.lastRequestAt);
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
        this.lastRequestAt = Date.now();
      });
      this.requestTurn = turn.catch(() => {});
      await turn;
      const url = new URL(path.replace(/^\//, ''), this.base);
      return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : undefined;
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        const req = https.request(url, { method, timeout: 15000,
          rejectUnauthorized: !(local && process.env.IBKR_LOCAL_GATEWAY_INSECURE === 'true'),
          headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        }, res => {
          let data = '';
          res.on('data', chunk => { data += chunk; if (data.length > 8e6) req.destroy(new Error('IB response too large')); });
          res.on('end', () => {
            if (res.statusCode < 200 || res.statusCode >= 300) return reject(Object.assign(new Error(`IB Web API HTTP ${res.statusCode}`), { status: res.statusCode }));
            try { const value = JSON.parse(data); if (value.error) throw new Error('IB returned an API error'); resolve(value); } catch { reject(new Error('IB returned an invalid/error response')); }
          });
        });
        req.on('error', reject); req.on('timeout', () => req.destroy(new Error('IB request timed out')));
        req.end(payload);
      });
    };
    return method === 'GET' ? retryRead(run, { attempts: 3 }) : run();
  }
  async connect() {
    if (!this.account && this.accountMode !== 'paper') throw new Error('IBKR_ACCOUNT_ID is not configured on this Mac');
    const status = await this.request('GET', 'iserver/auth/status');
    if (!status.authenticated || !status.connected || status.competing) throw new Error('IB brokerage session is unavailable or competing; sign in to the selected connection');
    const accounts = await this.request('GET', 'portfolio/accounts');
    if (!Array.isArray(accounts)) throw new Error('IB account list is unavailable');
    this.account = selectBrokerAccount(accounts.map(a => a.id), this.account, this.accountMode);
    const session = await this.request('GET', 'iserver/accounts');
    // The orders/trades endpoints use the session's selected account, unlike
    // the explicit portfolio endpoint. Never report another selection as ours.
    if (session.selectedAccount !== this.account) throw new Error('Select the configured IB account in the Web API session before connecting PolyTheta');
    return { connected: true, mode: /^DU/.test(this.account) ? 'paper' : 'live', connection: this.kind };
  }
  async positions() {
    const rows = [];
    for (let page = 0; page < 100; page++) {
      const batch = await this.request('GET', `portfolio/${encodeURIComponent(this.account)}/positions/${page}`);
      if (!Array.isArray(batch)) throw new Error('Invalid IB positions');
      rows.push(...batch.map(p => ({ conid: Number(p.conid), quantity: Number(p.position), symbol: p.ticker ?? p.contractDesc, marketPrice: Number.isFinite(p.mktPrice) ? p.mktPrice : null, raw: p })));
      if (batch.length < 30) return rows;
    }
    throw new Error('IB position pagination exceeded');
  }
  async accountSummary() {
    const s = await this.request('GET', `portfolio/${encodeURIComponent(this.account)}/summary`);
    const number = key => { const item = s[key]; if (item?.currency && item.currency !== 'USD') throw new Error('Execution requires a USD account summary'); return item?.amount == null || item.amount === '' ? NaN : Number(item.amount); };
    return { netLiquidation: number('netliquidation'), availableFunds: number('availablefunds'), excessLiquidity: number('excessliquidity'), cash: number('totalcashvalue'), initialMargin: number('initmarginreq'), maintenanceMargin: number('maintmarginreq'), grossPositionValue: number('grosspositionvalue') };
  }
  async resolve(pick, expiry) {
    const matches = await this.request('GET', `iserver/secdef/search?symbol=${encodeURIComponent(pick.ticker)}&secType=STK`);
    const stocks = matches.filter(m => m.symbol === pick.ticker && m.sections?.some(s => s.secType === 'OPT'));
    if (stocks.length !== 1) throw new Error(`Ambiguous underlying: ${pick.ticker}`);
    const month = new Date(`${expiry}T12:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase() + expiry.slice(2,4);
    const query = `conid=${stocks[0].conid}&sectype=OPT&month=${month}&exchange=SMART`;
    await this.request('GET', `iserver/secdef/strikes?${query}`);
    const defs = await this.request('GET', `iserver/secdef/info?${query}&strike=${pick.K}&right=${pick.side === 'call' ? 'C' : 'P'}`);
    const exact = defs.filter(d => d.maturityDate?.replaceAll('-', '') === expiry.replaceAll('-', '') && Number(d.strike) === pick.K && d.right === (pick.side === 'call' ? 'C' : 'P') && Number(d.multiplier) === 100 && d.currency === 'USD');
    if (exact.length !== 1) throw new Error(`Exact standard option unavailable: ${pick.ticker}`);
    const d = exact[0];
    const sides = await Promise.all([false, true].map(isBuy => this.request('GET', `iserver/contract/${d.conid}/info-and-rules?isBuy=${isBuy}`)));
    const tables = sides.map(info => {
      if (Number(info.con_id) !== Number(d.conid) || info.currency !== 'USD' || !info.rules?.canTradeAcctIds?.includes(this.account)) throw new Error('IB contract trading rules are unavailable for this account');
      return normalizePriceIncrements(info.rules.incrementRules);
    });
    if (JSON.stringify(tables[0]) !== JSON.stringify(tables[1])) throw new Error('IB buy and sell increments differ; contract requires review');
    const priceIncrements = tables[0];
    return { conid: Number(d.conid), symbol: pick.ticker, expiry, side: pick.side, strike: pick.K, multiplier: 100, tick: Math.min(...priceIncrements.map(r => r.increment)), priceIncrements, underlyingConid: Number(stocks[0].conid) };
  }
  async quote(contract, { entry = true } = {}) {
    const path = `iserver/marketdata/snapshot?conids=${contract.conid}${entry ? `,${contract.underlyingConid}` : ''}&fields=84,86,88,85,6509,7308,7633`;
    await this.request('GET', path); // pre-flight subscribes; first response may be empty
    let row, underlying;
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows = await this.request('GET', path);
      row = rows.find(r => Number(r.conid) === contract.conid);
      underlying = rows.find(r => Number(r.conid) === contract.underlyingConid);
      if (row?.['84'] != null && row?.['86'] != null && (!entry || underlying?.['84'] && underlying?.['86'] && row?.['7308'] != null)) break;
      await new Promise(r => setTimeout(r, 500));
    }
    const number = v => typeof v === 'number' ? v : typeof v === 'string' && /^-?(?:\d[\d,]*(?:\.\d+)?|\.\d+)$/.test(v) ? Number(v.replaceAll(',', '')) : NaN;
    const ub = number(underlying?.['84']), ua = number(underlying?.['86']);
    const validUnderlying = String(underlying?.['6509'] ?? '').startsWith('R') && ub > 0 && ua >= ub;
    return { conid: contract.conid, bid: number(row?.['84']), ask: number(row?.['86']), bidSize: number(row?.['88']), askSize: number(row?.['85']), observedAt: entry ? Math.min(Number(row?._updated), Number(underlying?._updated)) : Number(row?._updated), realtime: String(row?.['6509'] ?? '').startsWith('R'), delta: number(row?.['7308']), optionIv: number(String(row?.['7633'] ?? '').replace(/%$/, '').trim()) / 100, underlyingPrice: validUnderlying ? (ub + ua) / 2 : NaN, source: 'IB Web API' };
  }
  orderPayload(order) {
    assertValidLimit(order);
    return { acctId: this.account, conid: order.contract.conid, cOID: order.ref, orderType: 'LMT', side: order.action === 'entry' ? 'SELL' : 'BUY', quantity: order.quantity, price: order.limit, tif: 'DAY', outsideRTH: false };
  }
  async preview(order) {
    const p = await this.request('POST', `iserver/account/${encodeURIComponent(this.account)}/orders/whatif`, { orders: [this.orderPayload(order)] });
    return { initialMarginChange: Number(p.initial?.change), maintenanceMarginChange: Number(p.maintenance?.change), warning: p.warn ?? p.error, raw: p };
  }
  async submit(order) {
    const result = await this.request('POST', `iserver/account/${encodeURIComponent(this.account)}/orders`, { orders: [this.orderPayload(order)] });
    if (!Array.isArray(result) || !result[0]?.order_id) throw new Error('IB order needs review or result is uncertain; automatic resubmission is blocked');
    return { orderId: String(result[0].order_id), status: normalizeOrderStatus(result[0].order_status) };
  }
  async orders() {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await this.request('GET', 'iserver/account/orders');
      if (Array.isArray(response.orders) && response.snapshot === true) break;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, this.ordersPreflightDelayMs));
    }
    if (!Array.isArray(response?.orders) || response.snapshot !== true || response.orders.length >= 1000) throw new Error('Incomplete IB order snapshot');
    return response.orders.filter(o => o.acct === this.account || o.account === this.account || o.acctId === this.account).map(o => ({ orderId: String(o.orderId), ref: o.order_ref, conid: Number(o.conid), status: normalizeOrderStatus(o.status), filled: Number(o.filledQuantity), remaining: Number(o.remainingQuantity), limit: Number(o.price) }));
  }
  async executions() {
    const rows = await this.request('GET', 'iserver/account/trades?days=7');
    if (!Array.isArray(rows)) throw new Error('Invalid IB execution snapshot');
    return rows.filter(x => x.account === this.account).map(x => ({ executionId: x.execution_id, orderId: String(x.order_id), ref: x.order_ref, conid: Number(x.conid), quantity: Number(x.size), price: Number(String(x.price).replaceAll(',', '')), side: x.side, time: Number.isFinite(x.trade_time_r) ? new Date(x.trade_time_r).toISOString() : null, commission: x.commission == null ? null : Number(String(x.commission).replaceAll(',', '')) }));
  }
  async modify(orderId, order) {
    const result = await this.request('POST', `iserver/account/${encodeURIComponent(this.account)}/order/${encodeURIComponent(orderId)}`, this.orderPayload(order));
    if (!Array.isArray(result) || !result[0]?.order_id) throw new Error('IB order modification result uncertain');
    return result;
  }
  async cancel(orderId) { return this.request('DELETE', `iserver/account/${encodeURIComponent(this.account)}/order/${encodeURIComponent(orderId)}`); }
  disconnect() {}
}
