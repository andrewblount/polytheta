import { normalizePriceIncrements, roundPrice } from '../../shared/price-increments.mjs';
export { normalizePriceIncrements } from '../../shared/price-increments.mjs';

// Only a single explicitly paper account may be discovered automatically.
// Live accounts always require an operator-provided exact account ID.
export function selectBrokerAccount(accounts, configured, mode = 'live') {
  const authorized = [...new Set(accounts.map(value => String(value).trim()).filter(Boolean))];
  if (!['live', 'paper'].includes(mode)) throw new Error('Invalid IB account mode');
  let account = String(configured ?? '').trim();
  if (!account && mode === 'paper') {
    const paper = authorized.filter(value => /^DU[A-Z]?\d+$/.test(value));
    if (paper.length !== 1) throw new Error('Sign in to one paper account in IB Gateway, or set IBKR_PAPER_ACCOUNT_ID locally when several paper accounts are available');
    account = paper[0];
  }
  if (!account) throw new Error('IBKR_ACCOUNT_ID is not configured on this Mac');
  if ((/^DU/.test(account) ? 'paper' : 'live') !== mode) throw new Error(`The selected ${mode} account mode does not match the configured IB account`);
  if (!authorized.includes(account)) throw new Error('Configured IB account is not authorized by this session');
  return account;
}

// Provider spellings are normalized without treating unknown/pending states as
// proof of cancellation. Reconciliation must retain uncertainty.
export function normalizeOrderStatus(value) {
  const key = String(value ?? '').replace(/[\s_-]/g, '').toLowerCase();
  return ({ filled: 'Filled', cancelled: 'Cancelled', canceled: 'Cancelled',
    apicancelled: 'ApiCancelled', apicanceled: 'ApiCancelled', rejected: 'Rejected',
    inactive: 'Inactive', submitted: 'Submitted', presubmitted: 'PreSubmitted',
    pendingsubmit: 'PendingSubmit', apipending: 'PendingSubmit',
    pendingcancel: 'PendingCancel', precancelled: 'PendingCancel', precanceled: 'PendingCancel',
  })[key] ?? 'uncertain';
}

export function assertValidLimit(order) {
  normalizePriceIncrements(order.contract.priceIncrements);
  if (!Number.isFinite(order.limit) || order.limit <= 0 || Math.abs(roundPrice(order.limit, order.contract, 'floor') - order.limit) > 1e-8) throw new Error('Order limit does not match the IB contract price increment');
}
