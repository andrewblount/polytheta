import { assertCurrentProposal, isMarketOpen } from './market-calendar.mjs';
import { basketCounts, isExcluded } from './broker-settings.mjs';
import { minimumOtmFor, otmPercent } from './strike-settings.mjs';
import { roundPrice } from './price-increments.mjs';
import { isEntryWindow } from './entry-schedule.mjs';
import { repriceEntry } from './entry-pricing.mjs';
export function validateQuote(q, contract, settings, now = new Date(), entry = true) {
  if (!q || q.conid !== contract.conid || !q.realtime) throw new Error('IB quote is unavailable, delayed, or for another contract');
  const age = +now - Number(q.observedAt);
  if (!Number.isFinite(age) || age < -1000 || age > settings.maxQuoteAgeSeconds * 1000) throw new Error('IB quote is stale');
  if (![q.bid, q.ask, q.bidSize, q.askSize].every(Number.isFinite) || q.bid < 0 || q.ask <= 0 || q.ask < q.bid || q.askSize <= 0 || entry && (q.bid <= 0 || q.bidSize <= 0)) throw new Error('IB option market is invalid or has no liquidity');
  if (entry && q.ask - q.bid > settings.maxEntrySpread + 1e-9) throw new Error('IB option spread exceeds the entry limit');
}
export function entryBudget(proposal, account, settings, now = new Date()) {
  assertCurrentProposal(proposal, now);
  if (proposal.phase && proposal.phase !== 'final') throw new Error('Basket is still being prepared; finalized entry prices are required');
  if (!isMarketOpen(now) || !isEntryWindow(proposal.basket_date, settings, now)) throw new Error('Outside the configured entry window');
  if (proposal.allocation_settings?.entryTiming && proposal.allocation_settings.entryTiming !== settings.entryTiming) throw new Error('Basket entry timing changed; rebuild before entry');
  if (settings.pauseEntries) throw new Error('New entries are paused');
  if (![account.netLiquidation, account.availableFunds, account.excessLiquidity, account.cash].every(x => Number.isFinite(x) && x > 0)) throw new Error('IB account funds unavailable or insufficient');
  const reserve = marginReserveStatus(account, settings);
  if (!reserve.available || reserve.exceeded) throw new Error(reserve.message);
  const counts = basketCounts(settings, proposal.picks.filter(p => p.side === 'call').length, proposal.picks.filter(p => p.side === 'put').length);
  if (counts.total !== proposal.picks.length) throw new Error('Basket no longer matches the configured split or maximum trades');
  const scale = proposal.allocation_scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw new Error('Invalid basket risk scaling');
  const requested = account.netLiquidation * settings.entryCapitalPct / 100 * scale;
  // Do not multiply capital by the margin reserve. Existing exposures reduce
  // available funds at IB; positive cash is required for entry capacity.
  const total = Math.min(requested, account.availableFunds, account.excessLiquidity, account.cash);
  if (total <= 0) throw new Error('No entry allocation');
  return { total, perTrade: total / counts.total, counts, equity: account.netLiquidation };
}
export function marginReserveStatus(account, settings) {
  const available = Number.isFinite(account.grossPositionValue) && account.grossPositionValue >= 0 && Number.isFinite(account.netLiquidation) && account.netLiquidation > 0;
  const leverage = available ? account.grossPositionValue / account.netLiquidation : null;
  const exceeded = available && leverage > settings.reserveLeverageCeiling;
  return { available, leverage, ceiling: settings.reserveLeverageCeiling, exceeded,
    message: !available ? 'IB gross position value/equity unavailable; reserve ceiling cannot be verified' : exceeded ? 'IB gross exposure exceeds the configured reserve ceiling; new entries blocked' : 'Margin reserve within the configured ceiling' };
}
export function floorTick(price, contract) { return roundPrice(price, contract, 'floor'); }
export function ceilTick(price, contract) { return roundPrice(price, contract, 'ceil'); }
export function sideEnabled(side, settings) {
  return side === 'call' ? settings.sellCalls !== false : side === 'put' ? settings.sellPuts !== false : false;
}
export function planEntry(pick, contract, q, budget, settings, now = new Date()) {
  if (isExcluded(pick, settings) || isExcluded(contract, settings)) throw new Error('Ticker is on the do-not-trade list');
  if (!sideEnabled(pick.side, settings)) throw new Error(`Selling ${pick.side}s is switched off in Settings`);
  validateQuote(q, contract, settings, now);
  if (pick.doubles_allowed !== false || pick.rule_checks?.earnings_clear !== 'pass' || pick.rule_checks?.thesis_signals?.radar !== 'pass') throw new Error('Entry rules are not confirmed');
  if (!Number.isFinite(q.delta) || Math.abs(q.delta) < 0.15 || Math.abs(q.delta) > 0.20) throw new Error('Live IB delta is outside the entry band');
  const spot = q.underlyingPrice;
  if (!Number.isFinite(spot) || spot <= 0 || !Number.isFinite(pick.atr) || pick.atr <= 0) throw new Error('Live underlying price or ATR unavailable');
  const minimumOtm = minimumOtmFor(settings, pick.ticker, pick.side, contract.expiry);
  if (otmPercent(pick.side, contract.strike, spot) + 1e-9 < minimumOtm) throw new Error('Live OTM distance is below this trade’s configured minimum; rebuild the basket to select a qualifying strike');
  const buffer = (pick.side === 'call' ? pick.K - spot : spot - pick.K) / pick.atr;
  if (buffer < (pick.side === 'put' ? 2 : 1)) throw new Error('Live strike buffer no longer qualifies');
  const adverse = (spot - pick.px) * (pick.side === 'call' ? 1 : -1);
  if (adverse / pick.px >= 0.04 || adverse / pick.atr >= 0.5) throw new Error('Underlying has drifted against the basket');
  const pricing = repriceEntry({ reference: pick.pricing_reference, spot, optionIv: q.optionIv, vix: q.vix, now, settings });
  const minimum = ceilTick(Math.max(0.10, pricing.credit * settings.minimumCreditRatio), contract);
  const limit = floorTick((q.bid + q.ask) / 2, contract);
  if (limit < minimum || limit < q.bid) throw new Error('Available credit is below the configured minimum');
  // Equally allocated backing capital times the margin available (400% = four
  // dollars of strike/spot backing per committed dollar), rounded down to whole
  // contracts. IB's margin preview still has to approve the order within the
  // committed capital. A short call still has unbounded upside risk; this is a
  // sizing rule.
  const backing = budget.perTrade * (Number(settings.marginAvailablePct) || 100) / 100;
  const quantity = Math.floor(backing / (Math.max(spot, pick.K) * contract.multiplier));
  if (quantity < 1) throw new Error('Allocation cannot support one whole contract');
  return { action: 'entry', contract, pick, quantity, limit: +limit.toFixed(4), minimum, budget: budget.perTrade, pricing };
}
export function validateMargin(preview, account, order) {
  if (preview.warning || ![preview.initialMarginChange, preview.maintenanceMarginChange].every(Number.isFinite)) throw new Error('IB margin preview unavailable or requires review');
  if (Math.max(preview.initialMarginChange, preview.maintenanceMarginChange) > Math.min(order.budget, account.availableFunds, account.excessLiquidity)) throw new Error('IB margin requirement exceeds available allocation');
}
export function exitSignal(hits, now = new Date()) {
  return hits.find(h => h.actionable === true && typeof h.link === 'string' && Number.isFinite(Date.parse(h.publishedAt)) && +now - Date.parse(h.publishedAt) >= 0 && +now - Date.parse(h.publishedAt) <= 96 * 3600000) ?? null;
}
export function planExit(position, contract, q, ownedQuantity, settings, now = new Date()) {
  if (!isMarketOpen(now)) throw new Error('News exit queued for the next exchange session');
  validateQuote(q, contract, settings, now, false);
  const quantity = Math.min(Math.max(0, -position.quantity), ownedQuantity);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('No reconciled short position remains to close');
  return { action: 'exit', contract, quantity, limit: +ceilTick(q.ask, contract).toFixed(4), ceiling: +ceilTick(q.ask * settings.maxExitPremiumMultiple, contract).toFixed(4) };
}
