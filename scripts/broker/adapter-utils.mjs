import { normalizePriceIncrements, roundPrice } from '../../shared/price-increments.mjs';
export { normalizePriceIncrements } from '../../shared/price-increments.mjs';

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
