import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFingerprint, validateExitRequest } from '../shared/broker-portfolio.mjs';
import { planExitRequestQueue } from '../shared/exit-request-policy.mjs';

const now = new Date('2026-09-08T14:00:00Z');
const accountKey = accountFingerprint('U_TEST_A');
const otherAccountKey = accountFingerprint('U_TEST_B');
const requestId = '00000000-0000-4000-a000-000000000001';
const snapshot = {
  accountKey, observedAt: now.toISOString(), activated: true,
  positions: [
    { conid: 123, quantity: 2, canExit: true, workingEntry: false },
    { conid: 456, quantity: 0, canExit: false, workingEntry: true },
  ],
};
const input = { requestId, accountKey, scope: 'all' };

test('exit confirmation remains bound to the account the client displayed', () => {
  assert.equal(validateExitRequest(input, snapshot, now).accountKey, accountKey);
  assert.throws(() => validateExitRequest(input, { ...snapshot, accountKey: otherAccountKey }, now), /account has changed/);
  assert.throws(() => validateExitRequest({ ...input, accountKey: undefined }, snapshot, now), /account has changed/);
  assert.throws(() => validateExitRequest({ ...input, accountKey: '' }, snapshot, now), /account has changed/);
});

test('Exit all reuses a pending individual exit and includes the other working entry', () => {
  const command = validateExitRequest(input, snapshot, now);
  const pendingExit = { ...command, requestId: 'older-request', scope: 'position', status: 'monitoring', targets: [{ conid: 123, quantity: 2 }] };
  const planned = planExitRequestQueue(command, { pending: [pendingExit] });
  assert.equal(planned.create, true);
  assert.equal(planned.request.scope, 'all');
  assert.deepEqual(planned.request.targets, [{ conid: 123, quantity: 2 }, { conid: 456, quantity: 0 }]);
  assert.deepEqual(planned.request.reusedRequestIds, ['older-request']);
  assert.match(planned.request.message, /Existing exits remain in progress/);
  // A duplicate single-trade command still cannot create a competing exit.
  assert.throws(() => planExitRequestQueue({ ...command, scope: 'position', targets: [{ conid: 123, quantity: 2 }] }, { pending: [pendingExit] }), /already pending/);
});

test('request identifier retries are idempotent and cannot cross account or target', () => {
  const command = validateExitRequest({ ...input, scope: 'position', conid: 123 }, snapshot, now);
  const existing = { ...command, status: 'monitoring', message: 'Waiting for IB fills' };
  assert.deepEqual(planExitRequestQueue(command, { existing }), { request: existing, create: false });
  assert.throws(() => planExitRequestQueue({ ...command, accountKey: otherAccountKey }, { existing }), /different exit/);
  assert.throws(() => planExitRequestQueue({ ...command, scope: 'all' }, { existing }), /different exit/);
  assert.throws(() => planExitRequestQueue({ ...command, targets: [{ conid: 456, quantity: 0 }] }, { existing }), /different exit/);
});

test('a pending exit in another account is never reused or treated as this account’s exit', () => {
  const command = validateExitRequest(input, snapshot, now);
  const other = { ...command, accountKey: otherAccountKey, requestId: 'other-request', status: 'monitoring' };
  const planned = planExitRequestQueue(command, { pending: [other] });
  assert.equal(planned.create, true);
  assert.equal(planned.request.accountKey, accountKey);
  assert.equal(planned.request.reusedRequestIds, undefined);
  assert.equal(planExitRequestQueue({ ...command, scope: 'position', targets: [{ conid: 123, quantity: 2 }] }, { pending: [other] }).create, true);
});
