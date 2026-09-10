// Read-only data fetches only. Never wrap order submission in this helper:
// a timed-out order may already have reached the broker.
/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, delayMs?: number, sleep?: (ms: number) => Promise<unknown>, onRetry?: (event: { attempt: number, wait: number, message: string }) => void }} [options]
 * @returns {Promise<T>}
 */
export async function retryRead(fn, { attempts = 4, delayMs = 500, sleep = ms => new Promise(r => setTimeout(r, ms)), onRetry = () => {} } = {}) {
  for (let n = 1; ; n++) {
    try { return await fn(); }
    catch (error) {
      if (n >= attempts || /\b(401|403)\b|unauthorized|forbidden/i.test(error.message)) throw error;
      const wait = Math.min(delayMs * 2 ** (n - 1), 30000);
      onRetry({ attempt: n, wait, message: error.message });
      await sleep(wait);
    }
  }
}
