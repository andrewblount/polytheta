import { createHash } from 'node:crypto';
import { isMarketOpen, easternTime, sessionClose } from '../../shared/market-calendar.mjs';
import { entryBudget, planEntry, planExit, validateMargin, validateQuote, exitSignal, floorTick, ceilTick, marginReserveStatus } from '../../shared/execution-policy.mjs';
import { isExcluded } from '../../shared/broker-settings.mjs';
import { accountFingerprint, ownedQuantity, portfolioSnapshot } from '../../shared/broker-portfolio.mjs';
import { tickForPrice } from '../../shared/price-increments.mjs';
const terminal = status => ['Filled', 'Cancelled', 'ApiCancelled', 'Inactive', 'Rejected'].includes(status);
export function orderRef(account, week, conid, action) {
  return `pt-${createHash('sha256').update(`${account}:${week}:${conid}:${action}`).digest('hex').slice(0, 28)}`;
}
// Broker mutations are reached only after the operator activates the local
// service. No language model is involved in submitting or managing orders.
export async function executionCycle({ broker, proposal, settings, journal, save, scanNews, enabled = false, now = new Date(), commands = [], publish = async () => {} }) {
  const cycleStarted = Date.now();
  const decisionTime = () => new Date(+now + Date.now() - cycleStarted);
  const health = await broker.connect();
  if (health.mode !== 'live') throw new Error('This service is configured for the live account only');
  const [positions, orders, executions, account] = await Promise.all([broker.positions(), broker.orders(), broker.executions(), broker.accountSummary()]);
  journal.intents ??= {}; journal.fills ??= {}; journal.signals ??= {};
  if (journal.account && journal.account !== broker.account) throw new Error('Execution journal belongs to another account');
  journal.account = broker.account;
  if (journal.connection && journal.connection !== settings.connection && Object.values(journal.intents).some(i => !terminal(i.status))) throw new Error('Reconcile working orders before changing IB connections');
  journal.connection = settings.connection;
  journal.reserve = marginReserveStatus(account, settings);
  // Dedup by IB execution identity; fill price and commission come from IB.
  for (const fill of executions) {
    const intent = Object.values(journal.intents).find(i => i.ref === fill.ref);
    if (intent && fill.executionId && Number.isFinite(fill.price) && Number.isInteger(fill.quantity) && fill.quantity > 0) {
      if (fill.conid !== intent.contract.conid) throw new Error('Execution contract mismatch; reconciliation required');
      if (/\.\d+$/.test(fill.executionId)) {
        const base = fill.executionId.replace(/\.\d+$/, '');
        const older = Object.keys(journal.fills).filter(id => id !== fill.executionId && id.replace(/\.\d+$/, '') === base);
        if (older.some(id => Number(id.split('.').at(-1)) > Number(fill.executionId.split('.').at(-1)))) continue;
        for (const id of older) delete journal.fills[id];
      }
      const previous = journal.fills[fill.executionId];
      journal.fills[fill.executionId] = { ...previous, ...fill, commission: Number.isFinite(fill.commission) ? fill.commission : previous?.commission ?? null, time: fill.time ?? previous?.time ?? null, ref: intent.ref, action: intent.action, contract: intent.contract, modeledCredit: intent.pick?.cr ?? null };
    }
  }
  for (const intent of Object.values(journal.intents)) {
    const order = orders.find(o => o.ref === intent.ref);
    if (order) Object.assign(intent, { orderId: order.orderId ?? intent.orderId, status: order.status, filled: order.filled ?? intent.filled });
    const fills = Object.values(journal.fills).filter(f => f.ref === intent.ref);
    intent.filled = fills.reduce((sum, f) => sum + f.quantity, 0);
    if (intent.filled >= intent.quantity) intent.status = 'Filled';
  }
  for (const intent of Object.values(journal.intents)) {
    if (terminal(intent.status) || intent.status === 'uncertain' || !intent.orderId || intent.tif !== 'DAY') continue;
    const submitted = new Date(intent.submittedAt);
    const day = easternTime(submitted).date;
    if (day >= easternTime(decisionTime()).date || +decisionTime() <= +sessionClose(day)) continue;
    if (orders.some(o => (o.ref === intent.ref || o.conid === intent.contract.conid) && !terminal(o.status))) continue;
    const held = positions.find(p => p.conid === intent.contract.conid)?.quantity ?? 0;
    if (held !== -ownedQuantity(journal, intent.contract.conid)) continue;
    intent.status = 'Cancelled';
    intent.reconciledReason = 'Acknowledged DAY order expired; subsequent session snapshot and recorded fills reconcile exactly';
  }
  await save(journal);
  const snapshot = () => portfolioSnapshot({ journal, positions, account: broker.account, connection: settings.connection, activated: enabled, now });
  await publish(snapshot());
  if (!enabled) return { connected: true, message: 'IB connected; execution is not activated', health, account, reserve: journal.reserve, positions: snapshot().positions.length };
  const submit = async order => {
    if (!isMarketOpen(decisionTime())) throw new Error('Exchange session closed before submission; no order sent');
    // Persist intent before any network write. A timeout stays uncertain and
    // must be reconciled by order reference; it is never blindly resubmitted.
    journal.intents[order.ref] = { ...order, tif: 'DAY', submittedAt: decisionTime().toISOString(), status: 'uncertain', filled: 0 };
    await save(journal);
    if (!isMarketOpen(decisionTime())) {
      journal.intents[order.ref].status = 'Cancelled';
      journal.intents[order.ref].reconciledReason = 'Exchange closed before transmission; no order sent';
      await save(journal);
      throw new Error('Exchange session closed before submission; no order sent');
    }
    const ack = await broker.submit(order);
    Object.assign(journal.intents[order.ref], ack);
    await save(journal);
  };
  const entries = Object.values(journal.intents).filter(i => i.action === 'entry');
  journal.commands ??= {};
  for (const command of commands) {
    if (journal.commands[command.requestId]) continue;
    if (command.accountKey !== accountFingerprint(broker.account)) throw new Error('Exit request belongs to a different IB account');
    const known = command.targets.every(t => entries.some(i => i.contract.conid === t.conid));
    if (!known) throw new Error('Exit request is not attributable to PolyTheta');
    // Exit all covers every current PolyTheta fill/working entry, including
    // fills that arrived after the UI snapshot the owner confirmed.
    const targets = command.scope === 'all'
      ? [...new Set(entries.filter(i => ownedQuantity(journal, i.contract.conid) > 0 && positions.some(p => p.conid === i.contract.conid && p.quantity < 0) || !terminal(i.status)).map(i => i.contract.conid))].map(conid => ({ conid, quantity: ownedQuantity(journal, conid) }))
      : command.targets;
    journal.commands[command.requestId] = { ...command, targets, status: 'monitoring' };
    if (command.scope === 'all') settings = { ...settings, pauseEntries: true };
    for (const target of targets) journal.signals[target.conid] = { manual: true, requestId: command.requestId, detectedAt: now.toISOString() };
  }
  await save(journal);
  const problems = [];
  // Retain news events overnight so the next session does not lose a trigger.
  for (const entry of entries) {
    try {
    const id = entry.contract.conid;
    const held = positions.find(p => p.conid === id);
    if (!held && terminal(entry.status)) continue;
    try {
      const hit = journal.signals[id] ? null : exitSignal(await scanNews(entry.pick), decisionTime());
      if (hit && !journal.signals[id]?.manual) journal.signals[id] = { ...hit, detectedAt: now.toISOString() };
    } catch (err) {
      journal.newsOutage = { at: now.toISOString(), message: err.message };
      await save(journal);
      // Existing exits already queued still take priority during news outages.
      if (!journal.signals[id]) continue;
    }
    if (!journal.signals[id]) continue;
    await save(journal);
    if (!isMarketOpen(decisionTime())) continue;
    if (!terminal(entry.status)) {
      if (!entry.orderId) throw new Error('Entry result uncertain during news event; resolve at IB immediately');
      await broker.cancel(entry.orderId);
      entry.status = 'PendingCancel';
      await save(journal);
      continue; // next cycle must confirm cancellation and partial fills first
    }
    if (!held || held.quantity >= 0) continue;
    if (orders.some(o => o.conid === id && !terminal(o.status) && !journal.intents[o.ref])) throw new Error('Another IB order exists for this contract; reconcile it before closing PolyTheta quantity');
    const previousExits = Object.values(journal.intents).filter(i => i.action === 'exit' && i.contract.conid === id);
    if (previousExits.some(i => !terminal(i.status))) continue;
    // Retry a confirmed cancelled/partially filled exit only for its remaining
    // owned quantity. An uncertain result never creates a replacement.
    const ref = orderRef(broker.account, entry.week, id, `exit-${previousExits.length}`);
    const owned = ownedQuantity(journal, id);
    if (!owned) continue;
    const quote = await broker.quote(entry.contract, { entry: false });
    const exit = planExit(held, entry.contract, quote, owned, settings, decisionTime());
    await submit({ ...exit, ref, week: entry.week, pick: entry.pick, reason: journal.signals[id] });
    } catch (error) { problems.push(`${entry.contract.symbol}: ${error.message}`); }
  }
  // Reprice acknowledged working orders without creating a replacement order.
  for (const intent of Object.values(journal.intents)) {
    if (terminal(intent.status) || intent.status === 'PendingCancel' || !intent.orderId || !isMarketOpen(decisionTime())) continue;
    const elapsed = +now - Date.parse(intent.submittedAt);
    try {
    if (intent.action === 'entry' && (settings.pauseEntries || isExcluded(intent.pick, settings) || elapsed > settings.entryTimeoutSeconds * 1000 || journal.signals[intent.contract.conid])) {
      await broker.cancel(intent.orderId); intent.status = 'PendingCancel'; await save(journal); continue;
    }
    if (+now - Date.parse(intent.repricedAt ?? intent.submittedAt) < 60000) continue;
    const q = await broker.quote(intent.contract, { entry: intent.action === 'entry' });
    if (intent.action === 'entry') {
      try { planEntry(intent.pick, intent.contract, q, { perTrade: intent.budget }, settings, decisionTime()); }
      catch { await broker.cancel(intent.orderId); intent.status = 'PendingCancel'; await save(journal); continue; }
    }
    validateQuote(q, intent.contract, settings, decisionTime(), intent.action === 'entry');
    const limit = intent.action === 'entry'
      ? Math.max(intent.minimum, floorTick(Math.max(q.bid, intent.limit - tickForPrice(intent.limit, intent.contract)), intent.contract))
      : Math.min(intent.ceiling, ceilTick(q.ask, intent.contract));
    if (intent.action === 'exit' && q.ask > intent.ceiling) {
      intent.intervention = `${intent.contract.symbol}: exit ask ${q.ask} exceeds debit ceiling ${intent.ceiling}; review at IB immediately`;
      journal.urgent = intent.intervention;
    } else delete intent.intervention;
    if (limit !== intent.limit && isMarketOpen(decisionTime())) {
      intent.status = 'uncertain'; await save(journal);
      await broker.modify(intent.orderId, { ...intent, limit });
      intent.limit = limit; intent.status = 'Submitted'; intent.repricedAt = now.toISOString(); await save(journal);
    }
    } catch (error) { problems.push(`${intent.contract.symbol}: ${error.message}`); }
  }
  for (const command of Object.values(journal.commands)) {
    const pending = command.targets.some(t => ownedQuantity(journal, t.conid) > 0 || Object.values(journal.intents).some(i => i.contract.conid === t.conid && !terminal(i.status)));
    command.status = pending ? 'monitoring' : 'completed';
    const intervention = Object.values(journal.intents).filter(i => command.targets.some(t => t.conid === i.contract.conid) && !terminal(i.status)).map(i => i.intervention).filter(Boolean).join('; ');
    command.message = pending ? intervention || problems.join('; ') || (isMarketOpen(decisionTime()) ? 'Waiting for IB fills or cancellation confirmation' : 'Queued for the next exchange session') : 'IB fills confirm the PolyTheta exits are complete';
  }
  await save(journal);
  await publish(snapshot());
  if (problems.length) throw new Error(problems.join('; '));
  if (Object.values(journal.intents).some(i => i.status === 'uncertain')) throw new Error('An order result is uncertain; new entries are blocked until reconciled');
  if (!proposal || settings.pauseEntries || !isMarketOpen(decisionTime())) return { connected: true, message: journal.reserve.exceeded ? journal.reserve.message : 'IB connected; monitoring PolyTheta positions', reserve: journal.reserve, positions: snapshot().positions.length };
  const budget = entryBudget(proposal, account, settings, decisionTime());
  const weekEntries = entries.filter(i => i.week === proposal.basket_date);
  journal.budgets ??= {};
  const allocationPolicy = JSON.stringify([settings.entryCapitalPct, settings.callAllocationPct, settings.putAllocationPct, settings.maxTrades, proposal.allocation_scale ?? 1,
    proposal.expiry, proposal.picks.map(p => `${p.ticker}:${p.side}:${p.K}`).sort()]);
  const savedBudget = journal.budgets[proposal.basket_date];
  if (weekEntries.length && savedBudget && savedBudget.allocationPolicy !== allocationPolicy) throw new Error('Allocation changed after this basket started; remaining entries are blocked to preserve its equal capital limits');
  const fixed = savedBudget ?? { ...budget, allocationPolicy };
  journal.budgets[proposal.basket_date] = fixed;
  await save(journal);
  // A partial/cancelled/closed entry never frees a slot for a second trade.
  let reserved = weekEntries.reduce((sum, i) => sum + i.budget, 0);
  for (const pick of proposal.picks) {
    if (isExcluded(pick, settings)) continue;
    const contract = await broker.resolve(pick, proposal.expiry);
    const ref = orderRef(broker.account, proposal.basket_date, contract.conid, 'entry');
    if (journal.intents[ref] || journal.signals[contract.conid]) continue;
    // Never add to another short or long position in the same exact option.
    if (positions.some(p => p.conid === contract.conid && p.quantity !== 0) || orders.some(o => o.conid === contract.conid && !terminal(o.status))) continue;
    if (await scanNews(pick).then(hits => hits.length > 0)) continue;
    if (reserved + fixed.perTrade > fixed.total + 1e-6) break;
    const q = await broker.quote(contract);
    const order = { ...planEntry(pick, contract, q, fixed, settings, decisionTime()), ref, week: proposal.basket_date };
    const currentAccount = await broker.accountSummary();
    // A later account refresh can lose fields even after the initial snapshot
    // passed. Revalidate every required value before comparing capacity.
    entryBudget(proposal, currentAccount, settings, decisionTime());
    const currentCapital = Math.min(currentAccount.netLiquidation * settings.entryCapitalPct / 100 * (proposal.allocation_scale ?? 1), currentAccount.cash);
    if (!Number.isFinite(currentCapital) || reserved + fixed.perTrade > currentCapital + 1e-6 || fixed.perTrade > Math.min(currentAccount.availableFunds, currentAccount.excessLiquidity)) throw new Error('Account capacity fell below the remaining basket allocation; new entries blocked');
    if (marginReserveStatus(currentAccount, settings).exceeded) throw new Error('Margin reserve ceiling exceeded before submission');
    validateMargin(await broker.preview(order), currentAccount, order);
    // Quote can age during the margin request: refresh and re-check first.
    const checked = planEntry(pick, contract, await broker.quote(contract), fixed, settings, new Date(+now + Date.now() - cycleStarted));
    if (checked.quantity !== order.quantity || checked.limit < order.minimum) throw new Error('Entry changed during margin validation');
    await submit(order);
    reserved += fixed.perTrade;
  }
  return { connected: true, message: journal.urgent ?? 'IB connected; execution service is monitoring', positions: positions.length };
}
