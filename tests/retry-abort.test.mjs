import test from 'node:test';
import assert from 'node:assert/strict';
import { retryRead } from '../shared/retry.mjs';

test('a cancelled cycle never starts another provider read', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Cycle ended'));
  let reads = 0;
  await assert.rejects(retryRead(async () => { reads++; }, { signal: controller.signal }), /Cycle ended/);
  assert.equal(reads, 0);
});

test('cycle cancellation interrupts retry backoff and clears its timer', async () => {
  const controller = new AbortController();
  let reads = 0;
  const work = retryRead(async () => { reads++; throw new Error('Provider unavailable'); }, {
    signal: controller.signal, delayMs: 30000,
    onRetry: () => queueMicrotask(() => controller.abort(new Error('Cycle deadline'))),
  });
  await assert.rejects(work, /Cycle deadline/);
  assert.equal(reads, 1);
});

test('ordinary transient reads still recover within the same cycle', async () => {
  let reads = 0;
  const waits = [];
  const result = await retryRead(async () => {
    if (++reads < 3) throw new Error('Temporary outage');
    return 42;
  }, { sleep: async ms => { waits.push(ms); } });
  assert.equal(result, 42);
  assert.deepEqual(waits, [500, 1000]);
  assert.equal(reads, 3);
});
