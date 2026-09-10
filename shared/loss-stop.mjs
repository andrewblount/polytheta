import { isTerminalOrder } from './broker-portfolio.mjs';
import { validateQuote } from './execution-policy.mjs';

const tickerOf = contract => String(contract.symbol).toUpperCase();
const records = journal => Object.values(journal.lossStops ?? {});
const entriesFor = (journal, stop) => stop.entryRefs.map(ref => journal.intents[ref]).filter(Boolean);
export const lossStopForEntry = (journal, entry) => records(journal).find(stop => stop.entryRefs.includes(entry.ref));
const entryFills = (journal, entry) => Object.values(journal.fills).filter(fill => fill.ref === entry.ref);

// Historical holdings have no knowable pre-entry equity. Retain their identity
// and report the missing baseline instead of substituting today's equity.
export function syncLossStopCoverage(journal) {
  journal.lossStops ??= {};
  for (const stop of records(journal).filter(value => value.closedAt)) {
    const fills = stopFills(journal, stop), entries = entriesFor(journal, stop);
    const remaining = stop.conids.some(conid => fills.filter(fill => fill.contract.conid === conid)
      .reduce((sum, fill) => sum + (fill.action === 'entry' ? fill.quantity : -fill.quantity), 0) !== 0);
    const unresolved = entries.some(entry => !isTerminalOrder(entry.status) || entry.status === 'Filled' && entryFills(journal, entry).reduce((sum, fill) => sum + fill.quantity, 0) < entry.quantity);
    // A late execution or IB correction can arrive after cancellation/closure.
    // Preserve the original baseline and latch when that exposure reappears.
    if (remaining || unresolved) {
      stop.previousClosedAt = stop.closedAt;
      delete stop.closedAt;
      stop.status = stop.triggeredAt ? 'triggered' : 'monitoring';
    }
  }
  for (const entry of Object.values(journal.intents).filter(intent => intent.action === 'entry')) {
    if (lossStopForEntry(journal, entry)) continue;
    const entered = entryFills(journal, entry).reduce((sum, fill) => sum + fill.quantity, 0);
    const closed = Object.values(journal.fills).filter(fill => fill.action === 'exit' && fill.contract.conid === entry.contract.conid)
      .reduce((sum, fill) => sum + fill.quantity, 0);
    if (isTerminalOrder(entry.status) && entered <= closed && !(entry.status === 'Filled' && entered < entry.quantity)) continue;
    let stop = records(journal).find(value => value.ticker === tickerOf(entry.contract) && !value.closedAt);
    if (!stop) {
      stop = { id: `legacy:${entry.ref}`, ticker: tickerOf(entry.contract), entryRefs: [], weeks: [], conids: [], baselineEquity: null, baselineRecordedAt: null, status: 'unavailable' };
      journal.lossStops[stop.id] = stop;
    }
    // An untracked existing entry cannot be given another trade's baseline.
    stop.baselineEquity = null;
    stop.entryRefs.push(entry.ref);
    stop.weeks = [...new Set([...stop.weeks, entry.week])];
    stop.conids = [...new Set([...stop.conids, entry.contract.conid])];
    entry.lossStopId = stop.id;
  }
}

export function tickerEntryBlocked(journal, ticker, week) {
  return records(journal).some(stop => stop.ticker === String(ticker).toUpperCase()
    && (stop.triggeredAt && (!stop.closedAt || stop.weeks.includes(week)) || !stop.closedAt && !Number.isFinite(stop.baselineEquity)));
}

// Called only with an account summary requested immediately before submission.
// The caller persists this together with the uncertain order intent BEFORE IB.
export function recordEntryBaseline(journal, order, account, now = new Date()) {
  if (!Number.isFinite(account.netLiquidation) || account.netLiquidation <= 0) throw new Error('Fresh pre-entry IB account equity is unavailable');
  const ticker = tickerOf(order.contract);
  if (tickerEntryBlocked(journal, ticker, order.week)) throw new Error(`${ticker}: loss-stop state blocks this basket entry`);
  journal.lossStops ??= {};
  let stop = records(journal).find(value => value.ticker === ticker && !value.closedAt);
  if (!stop) {
    stop = { id: order.ref, ticker, entryRefs: [], weeks: [], conids: [], baselineEquity: account.netLiquidation, baselineRecordedAt: now.toISOString(), status: 'monitoring' };
    journal.lossStops[stop.id] = stop;
  }
  stop.entryRefs = [...new Set([...stop.entryRefs, order.ref])];
  stop.weeks = [...new Set([...stop.weeks, order.week])];
  stop.conids = [...new Set([...stop.conids, order.contract.conid])];
  order.lossStopId = stop.id;
  return stop;
}

export function lossStopQuoteContracts(journal) {
  const contracts = [];
  for (const stop of records(journal).filter(value => !value.closedAt)) {
    const fills = stopFills(journal, stop);
    for (const entry of entriesFor(journal, stop)) {
      const remaining = fills.filter(fill => fill.contract.conid === entry.contract.conid)
        .reduce((sum, fill) => sum + (fill.action === 'entry' ? fill.quantity : -fill.quantity), 0);
      if (remaining > 0) contracts.push(entry.contract);
    }
  }
  return [...new Map(contracts.map(contract => [contract.conid, contract])).values()];
}

function stopFills(journal, stop) {
  return Object.values(journal.fills).filter(fill => {
    if (fill.action === 'entry') return stop.entryRefs.includes(fill.ref);
    const intent = journal.intents[fill.ref];
    if (intent?.lossStopId) return intent.lossStopId === stop.id;
    // Compatibility for an exit submitted before the monitor was introduced.
    return stop.conids.includes(fill.contract.conid) && stop.weeks.includes(intent?.week);
  });
}

export function evaluateLossStops({ journal, positions, quotes = new Map(), quoteErrors = new Map(), settings, now = new Date(), stopIds }) {
  const problems = [];
  for (const stop of records(journal)) {
    if (stopIds && !stopIds.includes(stop.id)) continue;
    if (stop.closedAt) continue; // Completed episodes remain an immutable audit.
    stop.observedAt = now.toISOString();
    stop.thresholdAmount = Number.isFinite(stop.baselineEquity) ? stop.baselineEquity * settings.maxAccountLossPct / 100 : null;
    stop.thresholdPct = settings.maxAccountLossPct;
    try {
      const entries = entriesFor(journal, stop);
      const fills = stopFills(journal, stop);
      if (records(journal).filter(value => value.ticker === stop.ticker && !value.closedAt).length > 1) throw new Error('A late IB fill reopened a previous ticker exposure; reconcile its equity baseline before further entries');
      if (fills.some(fill => !Number.isInteger(fill.quantity) || fill.quantity <= 0 || !Number.isFinite(fill.price) || fill.price < 0 || !Number.isFinite(fill.contract.multiplier) || fill.contract.multiplier <= 0)) throw new Error('IB fill quantities or prices do not reconcile');
      let cashFlow = 0, closingDebit = 0, remaining = 0;
      const feesComplete = fills.every(fill => Number.isFinite(fill.commission));
      for (const fill of fills) cashFlow += (fill.action === 'entry' ? 1 : -1) * fill.quantity * fill.price * fill.contract.multiplier - (Number.isFinite(fill.commission) ? fill.commission : 0);
      for (const contract of [...new Map(entries.map(entry => [entry.contract.conid, entry.contract])).values()]) {
        const entered = fills.filter(fill => fill.action === 'entry' && fill.contract.conid === contract.conid).reduce((sum, fill) => sum + fill.quantity, 0);
        const closed = fills.filter(fill => fill.action === 'exit' && fill.contract.conid === contract.conid).reduce((sum, fill) => sum + fill.quantity, 0);
        const quantity = entered - closed;
        if (quantity < 0 || entries.some(entry => entry.contract.conid === contract.conid && entry.status === 'Filled' && entryFills(journal, entry).reduce((sum, fill) => sum + fill.quantity, 0) < entry.quantity)) throw new Error('IB executions do not fully reconcile with the recorded orders');
        const held = positions.find(position => position.conid === contract.conid)?.quantity ?? 0;
        if (!Number.isFinite(held) || quantity > Math.max(0, -held)) throw new Error('IB position quantity does not reconcile with PolyTheta fills');
        remaining += quantity;
        if (!quantity) continue;
        if (quoteErrors.has(contract.conid)) throw new Error(quoteErrors.get(contract.conid));
        const quote = quotes.get(contract.conid);
        validateQuote(quote, contract, settings, now, false);
        closingDebit += quantity * quote.ask * contract.multiplier;
      }
      const working = Object.values(journal.intents).some(intent => !isTerminalOrder(intent.status)
        && (stop.entryRefs.includes(intent.ref) || intent.action === 'exit' && (intent.lossStopId === stop.id || !intent.lossStopId && stop.conids.includes(intent.contract.conid) && stop.weeks.includes(intent.week))));
      stop.remainingQuantity = remaining;
      stop.feesComplete = feesComplete;
      stop.lossAmount = Math.max(0, closingDebit - cashFlow);
      stop.lossPct = Number.isFinite(stop.baselineEquity) && stop.baselineEquity > 0 ? stop.lossAmount / stop.baselineEquity * 100 : null;
      if (!remaining && !working) {
        stop.status = 'closed'; stop.closedAt = now.toISOString(); stop.available = true;
        stop.message = stop.triggeredAt ? 'IB fills confirm this ticker exposure is closed; this basket remains blocked from re-entry' : 'IB fills confirm this ticker exposure is closed';
        continue;
      }
      if (!(stop.baselineEquity > 0) || !Number.isFinite(stop.baselineEquity)) throw new Error('Pre-entry IB equity was not recorded; the loss stop is unavailable for this existing exposure');
      if (!Number.isFinite(stop.thresholdAmount) || stop.thresholdAmount <= 0) throw new Error('Configured loss threshold is invalid');
      stop.available = true;
      if (stop.lossAmount + 1e-8 >= stop.thresholdAmount && !stop.triggeredAt) {
        stop.triggeredAt = now.toISOString();
        stop.triggerLossAmount = stop.lossAmount;
        stop.triggerThresholdAmount = stop.thresholdAmount;
        stop.triggerThresholdPct = settings.maxAccountLossPct;
      }
      stop.status = stop.triggeredAt ? 'triggered' : 'monitoring';
      stop.message = stop.triggeredAt ? 'Loss stop triggered; closing only this ticker’s PolyTheta contracts' : 'Live IB ask and PolyTheta fills are within the ticker loss threshold';
      if (!feesComplete) stop.message += '; additional IB commissions are pending';
    } catch (error) {
      stop.available = false;
      stop.status = stop.triggeredAt ? 'triggered' : 'unavailable';
      stop.lossAmount = null; stop.lossPct = null;
      stop.message = `${stop.triggeredAt ? 'Loss stop remains triggered; ' : ''}${error.message}`;
      problems.push(`${stop.ticker}: ${stop.message}`);
    }
    if (stop.triggeredAt) {
      for (const conid of stop.conids) journal.signals[conid] = { ...journal.signals[conid], lossStop: true, lossStopId: stop.id, detectedAt: stop.triggeredAt };
    }
  }
  return problems;
}

export function lossStopSnapshot(stop) {
  if (!stop) return null;
  return Object.fromEntries(['status', 'baselineEquity', 'thresholdAmount', 'lossAmount', 'lossPct', 'triggeredAt', 'message'].map(key => [key, stop[key] ?? null]));
}
