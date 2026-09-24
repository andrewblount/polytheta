import { TwsBroker } from './tws.mjs';
import { WebApiBroker } from './web-api.mjs';
import { weekOf } from '../../shared/market-calendar.mjs';
import { validateQuote } from '../../shared/execution-policy.mjs';
export function brokerRuntime(settings, env = process.env) {
  const mode = settings.accountMode ?? 'live';
  if (!['live', 'paper'].includes(mode)) throw new Error('Invalid IB account mode');
  const paper = mode === 'paper';
  const authorizedEntryWeek = paper ? env.POLYTHETA_PAPER_ENTRY_WEEK || undefined : undefined;
  if (authorizedEntryWeek) {
    let valid = false;
    try { valid = weekOf(authorizedEntryWeek) === authorizedEntryWeek; } catch { /* reject invalid dates */ }
    if (!valid) throw new Error('POLYTHETA_PAPER_ENTRY_WEEK must be a valid Monday date (YYYY-MM-DD)');
  }
  return {
    mode, authorizedEntryWeek, account: (paper ? env.IBKR_PAPER_ACCOUNT_ID : env.IBKR_ACCOUNT_ID) ?? '',
    enabled: (paper ? env.POLYTHETA_PAPER_EXECUTION_ENABLED : env.POLYTHETA_EXECUTION_ENABLED) === 'true',
    // Fills from either account enter the ledger, labelled by mode, so account
    // performance and slippage can be measured against the model for each.
    importLedger: true, journalKey: `ib_execution_journal:${mode}`, journalFile: `ib-execution-${mode}.json`,
  };
}

// Market reads have their own client ID so the scheduled execution worker can
// continue reconciliation and exits. This path never previews or places orders.
export async function readBasketMarketData(picks, expiry, settings, { factory = createBroker, env = process.env } = {}) {
  const clientId = Number(env.IBKR_MARKET_DATA_CLIENT_ID ?? 97);
  if (settings.connection === 'tws' && (!Number.isInteger(clientId) || clientId < 1 || clientId > 999999 || clientId === settings.twsClientId)) throw new Error('IBKR_MARKET_DATA_CLIENT_ID must be valid and different from the execution client ID');
  const broker = factory({ ...settings, twsClientId: clientId }, env);
  const collect = async reads => {
    const results = await Promise.allSettled(reads);
    const failure = results.find(r => r.status === 'rejected');
    if (failure) throw failure.reason;
    return results.map(r => r.value);
  };
  try {
    const health = await broker.connect();
    if (health.mode !== settings.accountMode) throw new Error('IB market-data account mode does not match Settings');
    // Resolve everything before subscribing so contract lookups do not age quotes.
    const contracts = await collect(picks.map(pick => broker.resolve(pick, expiry)));
    return await collect(contracts.map(async contract => ({ contract, quote: await broker.quote(contract) })));
  } finally { broker.disconnect(); }
}

export function marketDataReadiness(markets, settings, now = new Date()) {
  if (!Array.isArray(markets) || !markets.length) throw new Error('IB market-data probe is empty');
  for (const market of markets) {
    if (!market?.contract?.conid) throw new Error('IB contract is unavailable');
    const { quote, contract } = market;
    validateQuote(quote, contract, settings, now);
    if (!Number.isFinite(quote.underlyingPrice) || quote.underlyingPrice <= 0 || quote.underlyingPrice >= 1e100 || !Number.isFinite(quote.optionIv) || quote.optionIv <= 0 || quote.optionIv >= 10 || !Number.isFinite(quote.delta) || Math.abs(quote.delta) > 1) throw new Error('IB underlying, option IV or Greeks unavailable');
  }
  return { ready: true, mode: settings.accountMode, checkedAt: now.toISOString(), contracts: markets.map(({ contract, quote }) => ({
    ticker: contract.symbol, expiry: contract.expiry, side: contract.side, strike: contract.strike, conid: contract.conid,
    source: quote.source, realtime: quote.realtime, observedAt: new Date(quote.observedAt).toISOString(),
    bid: quote.bid, ask: quote.ask, underlyingPrice: quote.underlyingPrice, optionIv: quote.optionIv, delta: quote.delta,
  })) };
}
export function createBroker(settings, env = process.env) {
  const runtime = brokerRuntime(settings, env);
  const account = { account: runtime.account, accountMode: runtime.mode };
  return settings.connection === 'web-api' ? new WebApiBroker({ ...account, baseUrl: settings.webApiUrl }) : new TwsBroker({ ...account, host: settings.twsHost, port: settings.twsPort, clientId: settings.twsClientId });
}
