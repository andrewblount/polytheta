// Called inside the database advisory lock. Existing working exits remain owned
// by their original command; an Exit all request also monitors those targets.
/**
 * @param {Record<string, unknown>} command
 * @param {{existing?: Record<string, unknown>, pending?: Record<string, unknown>[]}} options
 */
export function planExitRequestQueue(command, options = {}) {
  const { existing, pending = [] } = options;
  if (existing) {
    if (existing.accountKey !== command.accountKey || existing.scope !== command.scope ||
        command.scope === 'position' && existing.targets[0]?.conid !== command.targets[0]?.conid) {
      throw new Error('This request identifier belongs to a different exit. Refresh before trying again.');
    }
    return { request: existing, create: false };
  }
  const overlapping = pending.filter(request => request.accountKey === command.accountKey &&
    ['queued', 'monitoring'].includes(request.status) &&
    request.targets.some(target => command.targets.some(t => t.conid === target.conid)));
  if (overlapping.length && command.scope !== 'all') {
    throw new Error('An exit is already pending for this trade. Check its status before submitting another.');
  }
  const request = overlapping.length ? {
    ...command,
    reusedRequestIds: overlapping.map(request => request.requestId),
    message: 'Exit all requested. Existing exits remain in progress; the trading Mac will exit the remaining PolyTheta trades and pause new entries.',
  } : command;
  return { request, create: true };
}
