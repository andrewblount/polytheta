import { createHash } from 'node:crypto';
import { isMarketOpen, easternTime, sessionClose } from '../../shared/market-calendar.mjs';
import { entryBudget, planEntry, planExit, validateMargin, validateQuote, exitSignal, floorTick, ceilTick, marginReserveStatus, sideEnabled } from '../../shared/execution-policy.mjs';
import { isExcluded } from '../../shared/broker-settings.mjs';
import { accountFingerprint, ownedQuantity, portfolioSnapshot } from '../../shared/broker-portfolio.mjs';
import { tickForPrice } from '../../shared/price-increments.mjs';
import { isEntryWindow, entrySchedule } from '../../shared/entry-schedule.mjs';
import { pricingReference } from '../../shared/entry-pricing.mjs';
import { syncLossStopCoverage, lossStopQuoteContracts, evaluateLossStops, lossStopForEntry, lossStopSnapshot, tickerEntryBlocked, recordEntryBaseline } from '../../shared/loss-stop.mjs';
const terminal = status => ['Filled', 'Cancelled', 'ApiCancelled', 'Inactive', 'Rejected'].includes(status);
async function boundedRead(read, milliseconds, message) {
  let timeout;
  const controller = new AbortController();
  try { return await Promise.race([Promise.resolve().then(() => read(controller.signal)), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timeout); controller.abort(); }
}
export function orderRef(account, week, conid, action) {
  return `pt-${createHash('sha256').update(`${account}:${week}:${conid}:${action}`).digest('hex').slice(0, 28)}`;
}
// Broker mutations are reached only after the operator activates the local
// service. No language model is involved in submitting or managing orders.
export async function executionCycle({ broker, proposal, settings, journal, save, scanNews, enabled = false, allowPaper = false, authorizedEntryWeek, now = new Date(), commands = [], publish = async () => {}, beforeWrite = async () => {}, getVix = async () => null }) {
  const cycleStarted = Date.now();
  const decisionTime = () => new Date(+now + Date.now() - cycleStarted);
  const entryCanWork = (intent, at = decisionTime()) => isEntryWindow(intent.week, settings, at)
    && (!authorizedEntryWeek || intent.week === authorizedEntryWeek)
    && (!intent.entryWindowEnd || +at < Date.parse(intent.entryWindowEnd));
  // Paper-only capital cap: size entries against min(IB paper equity, POLYTHETA_PAPER_CAPITAL_CAP)
  // so a $1M simulated balance never inflates the pilot; entry baselines freeze the capped values.
  // Live mode ignores the variable entirely.
  const capitalCap = settings.accountMode === 'paper' ? Number(process.env.POLYTHETA_PAPER_CAPITAL_CAP) : NaN;
  const capAccount = s => Number.isFinite(capitalCap) && capitalCap > 0 ? { ...s, netLiquidation: Math.min(s.netLiquidation, capitalCap), cash: Math.min(s.cash, capitalCap), availableFunds: Math.min(s.availableFunds, capitalCap), excessLiquidity: Math.min(s.excessLiquidity, capitalCap) } : s;
  const accountSummary = async () => capAccount(await broker.accountSummary());
  const readNews = pick => boundedRead(signal => scanNews(pick, { signal }), 10000, 'News scan timed out; retrying next cycle');
  const health = await broker.connect();
  if (settings.accountMode && health.mode !== settings.accountMode) throw new Error('IB account mode does not match Settings; sign in to the selected live or paper session');
  if (!settings.accountMode && health.mode !== 'live' && !(health.mode === 'paper' && allowPaper)) throw new Error('This service is configured for the live account only; select Paper trading in Settings');
  if (journal.mode && journal.mode !== health.mode) throw new Error('Execution journal belongs to a different account mode');
  journal.mode = health.mode;
  const [positions, orders, executions, account] = await Promise.all([broker.positions(), broker.orders(), broker.executions(), accountSummary()]);
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
  syncLossStopCoverage(journal);
  // Fetch the ticker risk marks together, before invoking any news provider.
  // Only exact PolyTheta contracts are requested; account-wide P/L is unused.
  const riskQuotes = new Map(), riskQuoteErrors = new Map();
  const riskReads = new Map(lossStopQuoteContracts(journal).map(contract => [contract.conid, (async () => {
    try { riskQuotes.set(contract.conid, await boundedRead(() => broker.quote(contract, { entry: false }), 15000, 'Live IB risk quote timed out')); }
    catch (error) { riskQuoteErrors.set(contract.conid, error.message); }
  })()]));
  // Assess each ticker when its own reads finish. Another ticker's timeout
  // cannot age a valid quote out before a proven breach gets latched.
  const riskProblems = (await Promise.all(Object.values(journal.lossStops).map(async stop => {
    await Promise.all(stop.conids.map(conid => riskReads.get(conid)));
    return evaluateLossStops({ journal, positions, quotes: riskQuotes, quoteErrors: riskQuoteErrors, settings, now: decisionTime(), stopIds: [stop.id] });
  }))).flat();
  journal.lossStopProblems = riskProblems;
  const triggeredTickers = Object.values(journal.lossStops).filter(stop => stop.triggeredAt && !stop.closedAt).map(stop => stop.ticker);
  const riskMessage = riskProblems.length ? `Loss monitoring unavailable; new entries blocked. ${riskProblems.join('; ')}`
    : triggeredTickers.length ? `Loss stop triggered for ${triggeredTickers.join(', ')}; closing only those PolyTheta ticker exposures${isMarketOpen(decisionTime()) ? '' : ' at the next exchange session'}` : null;
  await save(journal); // Latches are durable before cancellation or exit orders.
  const snapshot = () => {
    const value = portfolioSnapshot({ journal, positions, account: broker.account, connection: settings.connection, activated: enabled, now });
    value.positions = value.positions.map(row => {
      const entry = Object.values(journal.intents).findLast(intent => intent.action === 'entry' && intent.contract.conid === row.conid);
      return { ...row, lossStop: lossStopSnapshot(entry && lossStopForEntry(journal, entry)) };
    });
    return { ...value, lossStopProblems: riskProblems };
  };
  await publish(snapshot());
  if (!enabled) return { connected: true, message: `IB ${health.mode} account connected; execution is not activated${riskMessage ? `. ${riskMessage}` : ''}`, health, account, reserve: journal.reserve, positions: snapshot().positions.length };
  const submit = async (order, quote) => {
    if (!isMarketOpen(decisionTime())) throw new Error('Exchange session closed before submission; no order sent');
    // Persist intent before any network write. A timeout stays uncertain and
    // must be reconciled by order reference; it is never blindly resubmitted.
    journal.intents[order.ref] = { ...order, tif: 'DAY', submittedAt: decisionTime().toISOString(), status: 'uncertain', filled: 0 };
    await save(journal);
    // Lock/host verification can itself cross the entry window or market close.
    // There must be no additional await between the final timing check and send.
    await beforeWrite();
    if (!isMarketOpen(decisionTime())) {
      journal.intents[order.ref].status = 'Cancelled';
      journal.intents[order.ref].reconciledReason = 'Exchange closed before transmission; no order sent';
      await save(journal);
      throw new Error('Exchange session closed before submission; no order sent');
    }
    if (order.action === 'entry' && !entryCanWork(order)) {
      journal.intents[order.ref].status = 'Cancelled';
      journal.intents[order.ref].reconciledReason = 'Entry window ended before transmission; no order sent';
      await save(journal);
      throw new Error('Entry window ended before submission');
    }
    try { validateQuote(quote, order.contract, settings, decisionTime(), order.action === 'entry'); }
    catch (error) {
      journal.intents[order.ref].status = 'Cancelled';
      journal.intents[order.ref].reconciledReason = `${error.message}; no order sent`;
      await save(journal);
      throw error;
    }
    const ack = await broker.submit(order);
    Object.assign(journal.intents[order.ref], ack);
    await save(journal);
  };
  const entries = Object.values(journal.intents).filter(i => i.action === 'entry');
  journal.commands ??= {};
  for (const command of typeof commands === 'function' ? commands() : commands) {
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
    for (const target of targets) journal.signals[target.conid] = { ...journal.signals[target.conid], manual: true, requestId: command.requestId, detectedAt: now.toISOString() };
  }
  await save(journal);
  const problems = [];
  // Retain events overnight. Known loss triggers and their working exits are
  // serviced before any potentially slow news scan.
  const processExits = async candidates => {
  for (const entry of candidates) {
    try {
    const id = entry.contract.conid;
    const held = positions.find(p => p.conid === id);
    if (!held && terminal(entry.status)) continue;
    if (!journal.signals[id]) continue;
    await save(journal);
    if (!isMarketOpen(decisionTime())) continue;
    if (entry.status === 'PendingCancel') continue;
    if (!terminal(entry.status)) {
      if (!entry.orderId) throw new Error('Entry result uncertain during news event; resolve at IB immediately');
      await beforeWrite(); await broker.cancel(entry.orderId);
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
    if (journal.signals[id].lossStop) { exit.dynamicAsk = true; delete exit.ceiling; }
    await submit({ ...exit, ref, week: entry.week, pick: entry.pick, reason: journal.signals[id], lossStopId: lossStopForEntry(journal, entry)?.id }, quote);
    } catch (error) { problems.push(`${entry.contract.symbol}: ${error.message}`); }
  }
  };
  await processExits(entries.filter(entry => journal.signals[entry.contract.conid])
    .sort((a, b) => Number(Boolean(journal.signals[b.contract.conid]?.lossStop)) - Number(Boolean(journal.signals[a.contract.conid]?.lossStop))));
  // Reprice acknowledged working orders without creating a replacement order.
  for (const intent of Object.values(journal.intents)) {
    if (terminal(intent.status) || ['PendingCancel', 'uncertain'].includes(intent.status) || !intent.orderId || !isMarketOpen(decisionTime())) continue;
    const elapsed = +decisionTime() - Date.parse(intent.submittedAt);
    try {
    if (intent.action === 'entry' && (settings.pauseEntries || !entryCanWork(intent) || isExcluded(intent.pick, settings) || !sideEnabled(intent.pick?.side, settings) || elapsed > settings.entryTimeoutSeconds * 1000 || journal.signals[intent.contract.conid])) {
      await beforeWrite(); await broker.cancel(intent.orderId); intent.status = 'PendingCancel'; await save(journal); continue;
    }
    // An already working news/manual exit becomes a risk exit if its ticker
    // subsequently breaches the loss threshold. Do not submit a second order.
    if (intent.action === 'exit' && journal.signals[intent.contract.conid]?.lossStop) {
      intent.dynamicAsk = true;
      intent.lossStopId = journal.signals[intent.contract.conid].lossStopId;
      intent.reason = { ...intent.reason, ...journal.signals[intent.contract.conid] };
      delete intent.ceiling;
    }
    if (!intent.dynamicAsk && +decisionTime() - Date.parse(intent.repricedAt ?? intent.submittedAt) < 60000) continue;
    const q = await broker.quote(intent.contract, { entry: intent.action === 'entry' });
    if (intent.action === 'entry' && !(q.optionIv > 0)) q.vix = await getVix();
    if (intent.action === 'entry') {
      try { const refreshed = planEntry(intent.pick, intent.contract, q, { perTrade: intent.budget }, settings, decisionTime()); intent.minimum = refreshed.minimum; intent.pricing = refreshed.pricing; }
      catch { await beforeWrite(); await broker.cancel(intent.orderId); intent.status = 'PendingCancel'; await save(journal); continue; }
    }
    validateQuote(q, intent.contract, settings, decisionTime(), intent.action === 'entry');
    const limit = intent.action === 'entry'
      ? Math.max(intent.minimum, floorTick(Math.max(q.bid, intent.limit - tickForPrice(intent.limit, intent.contract)), intent.contract))
      : intent.dynamicAsk ? ceilTick(q.ask, intent.contract) : Math.min(intent.ceiling, ceilTick(q.ask, intent.contract));
    if (intent.action === 'exit' && !intent.dynamicAsk && q.ask > intent.ceiling) {
      intent.intervention = `${intent.contract.symbol}: exit ask ${q.ask} exceeds debit ceiling ${intent.ceiling}; review at IB immediately`;
      journal.urgent = intent.intervention;
    } else delete intent.intervention;
    if (limit !== intent.limit && isMarketOpen(decisionTime())) {
      const previousStatus = intent.status;
      intent.status = 'uncertain'; await save(journal);
      await beforeWrite();
      if (!isMarketOpen(decisionTime())) {
        intent.status = previousStatus; await save(journal); continue;
      }
      if (intent.action === 'entry' && !entryCanWork(intent)) {
        await broker.cancel(intent.orderId); intent.status = 'PendingCancel'; await save(journal); continue;
      }
      try { validateQuote(q, intent.contract, settings, decisionTime(), intent.action === 'entry'); }
      catch (error) { intent.status = previousStatus; await save(journal); throw error; }
      await broker.modify(intent.orderId, { ...intent, limit });
      intent.limit = limit; intent.status = 'Submitted'; intent.repricedAt = decisionTime().toISOString(); await save(journal);
    }
    } catch (error) { problems.push(`${intent.contract.symbol}: ${error.message}`); }
  }
  // Every eligible ticker/side gets a bounded read, starting AFTER risk work.
  // A slow connection or the first ticker's outage cannot starve later news.
  const newsCandidates = entries.filter(entry => !journal.signals[entry.contract.conid]
    && (positions.some(position => position.conid === entry.contract.conid && position.quantity !== 0) || !terminal(entry.status)));
  const newsKey = entry => `${entry.pick.ticker}:${entry.pick.side}`;
  const newsPicks = new Map(newsCandidates.map(entry => [newsKey(entry), entry.pick]));
  const newsResults = new Map(await Promise.all([...newsPicks].map(async ([key, pick]) => {
    try { return [key, { hits: await readNews(pick) }]; }
    catch (error) { return [key, { error: error.message }]; }
  })));
  const newsFailures = [...newsResults].filter(([, value]) => value.error).map(([key, value]) => `${key}: ${value.error}`);
  if (newsFailures.length) journal.newsOutage = { at: decisionTime().toISOString(), message: newsFailures.join('; ') };
  else if (newsResults.size) delete journal.newsOutage;
  for (const entry of newsCandidates) {
    const result = newsResults.get(newsKey(entry));
    const hit = result.error ? null : exitSignal(result.hits, decisionTime());
    if (hit) journal.signals[entry.contract.conid] = { ...hit, detectedAt: decisionTime().toISOString() };
  }
  await save(journal);
  await processExits(newsCandidates.filter(entry => journal.signals[entry.contract.conid]));
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
  if (riskProblems.length) return { health, account, connected: true, message: riskMessage, reserve: journal.reserve, positions: snapshot().positions.length };
  if (!proposal || settings.pauseEntries || !isMarketOpen(decisionTime()) || !entryCanWork({ week: proposal.basket_date })) return { health, account, connected: true, message: riskMessage ?? (journal.reserve.exceeded ? journal.reserve.message : `IB connected; monitoring PolyTheta positions${authorizedEntryWeek ? `; entries authorized only for ${authorizedEntryWeek}` : ''}`), reserve: journal.reserve, positions: snapshot().positions.length };
  const budget = entryBudget(proposal, account, settings, decisionTime());
  const weekEntries = entries.filter(i => i.week === proposal.basket_date);
  journal.budgets ??= {};
  const allocationPolicy = JSON.stringify([settings.entryCapitalPct, settings.callAllocationPct, settings.putAllocationPct, settings.maxTrades, proposal.allocation_scale ?? 1,
    settings.entryTiming, proposal.expiry, proposal.picks.map(p => `${p.ticker}:${p.side}:${p.K}`).sort()]);
  const savedBudget = journal.budgets[proposal.basket_date];
  if (weekEntries.length && savedBudget && savedBudget.allocationPolicy !== allocationPolicy) throw new Error('Allocation changed after this basket started; remaining entries are blocked to preserve its equal capital limits');
  const fixed = savedBudget ?? { ...budget, allocationPolicy };
  journal.budgets[proposal.basket_date] = fixed;
  await save(journal);
  // A partial/cancelled/closed entry never frees a slot for a second trade.
  let reserved = weekEntries.reduce((sum, i) => sum + i.budget, 0);
  const entryDeadline = Date.now() + 30000;
  for (const rawPick of proposal.picks) {
    if (!isEntryWindow(proposal.basket_date, settings, decisionTime())) break;
    if (Date.now() >= entryDeadline) break;
    const pick = { ...rawPick, pricing_reference: pricingReference(rawPick, proposal) };
    // A side switched off in Settings is skipped; its equal share stays unallocated.
    if (isExcluded(pick, settings) || !sideEnabled(pick.side, settings) || tickerEntryBlocked(journal, pick.ticker, proposal.basket_date)) continue;
    const contract = await broker.resolve(pick, proposal.expiry);
    const ref = orderRef(broker.account, proposal.basket_date, contract.conid, 'entry');
    if (journal.intents[ref] || journal.signals[contract.conid]) continue;
    // Never add to another short or long position in the same exact option.
    if (positions.some(p => p.conid === contract.conid && p.quantity !== 0) || orders.some(o => o.conid === contract.conid && !terminal(o.status))) continue;
    try { if (await readNews(pick).then(hits => hits.length > 0)) continue; }
    catch (error) { journal.newsOutage = { at: decisionTime().toISOString(), message: `${pick.ticker}: ${error.message}` }; await save(journal); continue; }
    if (reserved + fixed.perTrade > fixed.total + 1e-6) break;
    const q = await broker.quote(contract);
    if (!(q.optionIv > 0)) q.vix = await getVix();
    const order = { ...planEntry(pick, contract, q, fixed, settings, decisionTime()), ref, week: proposal.basket_date, entryWindowEnd: entrySchedule(proposal.basket_date, settings).end.toISOString() };
    const currentAccount = await accountSummary();
    // A later account refresh can lose fields even after the initial snapshot
    // passed. Revalidate every required value before comparing capacity.
    entryBudget(proposal, currentAccount, settings, decisionTime());
    const currentCapital = Math.min(currentAccount.netLiquidation * settings.entryCapitalPct / 100 * (proposal.allocation_scale ?? 1), currentAccount.cash);
    if (!Number.isFinite(currentCapital) || reserved + fixed.perTrade > currentCapital + 1e-6 || fixed.perTrade > Math.min(currentAccount.availableFunds, currentAccount.excessLiquidity)) throw new Error('Account capacity fell below the remaining basket allocation; new entries blocked');
    if (marginReserveStatus(currentAccount, settings).exceeded) throw new Error('Margin reserve ceiling exceeded before submission');
    const marginPreview = await broker.preview(order);
    validateMargin(marginPreview, currentAccount, order);
    // Quote can age during the margin request: refresh and re-check first.
    const fresh = await broker.quote(contract);
    if (!(fresh.optionIv > 0)) fresh.vix = await getVix();
    const checked = planEntry(pick, contract, fresh, fixed, settings, decisionTime());
    if (checked.quantity !== order.quantity) throw new Error('Entry changed during margin validation');
    Object.assign(order, { minimum: checked.minimum, limit: checked.limit, pricing: checked.pricing });
    // Freeze the actual account equity immediately before this entry, after
    // quote/margin preparation. An overlapping ticker retains its first entry's
    // baseline; a fully closed earlier basket receives a new baseline.
    const baselineAccount = await accountSummary();
    entryBudget(proposal, baselineAccount, settings, decisionTime());
    const baselineCapital = Math.min(baselineAccount.netLiquidation * settings.entryCapitalPct / 100 * (proposal.allocation_scale ?? 1), baselineAccount.cash);
    if (reserved + fixed.perTrade > baselineCapital + 1e-6 || fixed.perTrade > Math.min(baselineAccount.availableFunds, baselineAccount.excessLiquidity)) throw new Error('Account capacity fell below the remaining basket allocation; new entries blocked');
    validateMargin(marginPreview, baselineAccount, order);
    validateQuote(fresh, contract, settings, decisionTime());
    recordEntryBaseline(journal, order, baselineAccount, decisionTime());
    await submit(order, fresh);
    reserved += fixed.perTrade;
  }
  return { health, account, connected: true, message: riskMessage ?? journal.urgent ?? (journal.newsOutage ? `News monitoring incomplete: ${journal.newsOutage.message}` : 'IB connected; execution service is monitoring'), positions: snapshot().positions.length };
}
