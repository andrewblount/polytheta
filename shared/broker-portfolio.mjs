import { createHash } from 'node:crypto';
export const isTerminalOrder = status => ['Filled', 'Cancelled', 'ApiCancelled', 'Inactive', 'Rejected'].includes(status);
export const accountFingerprint = account => createHash('sha256').update(`polytheta:${account}`).digest('hex').slice(0, 24);
export function ownedQuantity(journal, conid) {
  return Math.max(0, Object.values(journal.fills ?? {}).filter(f => f.contract.conid === conid)
    .reduce((n, f) => n + (f.action === 'entry' ? f.quantity : -f.quantity), 0));
}
// Only fills attributable to PolyTheta order references contribute to P/L.
// IB account-level P/L and other positions never enter this view.
export function portfolioSnapshot({ journal, positions, account, connection, activated, now = new Date() }) {
  const fills = Object.values(journal.fills ?? {});
  const entries = Object.values(journal.intents ?? {}).filter(i => i.action === 'entry');
  const contracts = [...new Map(entries.map(i => [i.contract.conid, i.contract])).values()];
  const rows = contracts.map(c => {
    const tradeFills = fills.filter(f => f.contract.conid === c.conid);
    const sells = tradeFills.filter(f => f.action === 'entry'), buys = tradeFills.filter(f => f.action === 'exit');
    const entered = sells.reduce((n, f) => n + f.quantity, 0), closed = buys.reduce((n, f) => n + f.quantity, 0);
    const remaining = Math.max(0, entered - closed), held = positions.find(p => p.conid === c.conid);
    const quantity = Math.min(remaining, Math.max(0, -(held?.quantity ?? 0)));
    const averageFill = entered ? sells.reduce((n, f) => n + f.quantity * f.price, 0) / entered : null;
    const mark = Number.isFinite(held?.marketPrice) && held.marketPrice >= 0 ? held.marketPrice : null;
    const feesComplete = tradeFills.every(f => Number.isFinite(f.commission));
    const fees = tradeFills.reduce((n, f) => n + (Number.isFinite(f.commission) ? f.commission : 0), 0);
    const reconciled = quantity === remaining && closed <= entered;
    const unrealizedPnl = reconciled && (quantity === 0 || mark != null && averageFill != null)
      ? quantity === 0 ? 0 : (averageFill - mark) * quantity * c.multiplier : null;
    const realizedPnl = averageFill == null ? 0 : buys.reduce((n, f) => n + (averageFill - f.price) * f.quantity * c.multiplier, 0);
    const activeOrders = Object.values(journal.intents ?? {}).filter(i => i.contract.conid === c.conid && !isTerminalOrder(i.status));
    return { conid: c.conid, ticker: c.symbol, side: c.side, strike: c.strike, expiry: c.expiry,
      quantity, entered, closed, averageFill, mark, unrealizedPnl, realizedPnl, fees, feesComplete,
      reconciled, status: !reconciled ? 'Reconciliation required' : activeOrders.map(i => i.intervention ?? `${i.action}: ${i.status}`).join('; ') || (quantity ? 'Open' : 'Closed'),
      canExit: quantity > 0 && reconciled, workingEntry: activeOrders.some(i => i.action === 'entry'),
    };
  }).filter(p => p.entered || p.workingEntry);
  const complete = rows.every(p => p.reconciled && p.unrealizedPnl != null && p.feesComplete);
  return { scope: 'PolyTheta only', accountKey: accountFingerprint(account), connection, activated,
    observedAt: now.toISOString(), positions: rows,
    // A past expiry awaiting an activity statement must not conceal marks for
    // current holdings. Realized totals stay explicitly incomplete meanwhile.
    unrealizedPnl: rows.filter(p => p.quantity > 0).every(p => p.unrealizedPnl != null)
      ? rows.filter(p => p.quantity > 0).reduce((n, p) => n + p.unrealizedPnl, 0) : null,
    realizedPnl: rows.reduce((n, p) => n + p.realizedPnl, 0), fees: rows.reduce((n, p) => n + p.fees, 0), complete,
  };
}
export function validateExitRequest(input, snapshot, now = new Date()) {
  if (!input || !/^[0-9a-f-]{36}$/i.test(input.requestId ?? '')) throw new Error('A request identifier is required');
  if (typeof input.accountKey !== 'string' || !/^[a-f0-9]{24}$/.test(input.accountKey) || input.accountKey !== snapshot?.accountKey) throw new Error('The displayed IB account has changed. Refresh the trades before confirming an exit.');
  const age = +now - Date.parse(snapshot?.observedAt);
  if (!Number.isFinite(age) || age < -1000 || age > 120000) throw new Error('IB position data is stale. Refresh the connection before requesting an exit.');
  if (!snapshot.activated) throw new Error('The IB execution service is not activated.');
  const eligible = snapshot.positions.filter(p => p.canExit || p.workingEntry);
  if (input.scope !== 'all' && input.scope !== 'position') throw new Error('Invalid exit scope');
  const targets = input.scope === 'all' ? eligible : eligible.filter(p => p.conid === input.conid);
  if (!targets.length) throw new Error('No eligible PolyTheta trade to exit');
  return { requestId: input.requestId, scope: input.scope, accountKey: snapshot.accountKey,
    targets: targets.map(p => ({ conid: p.conid, quantity: p.quantity })), requestedAt: now.toISOString(),
    status: 'queued', message: 'Exit requested. Waiting for the trading Mac and IB confirmation.' };
}
