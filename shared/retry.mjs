// Read-only data fetches only. Never wrap order submission in this helper:
// a timed-out order may already have reached the broker.
/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ attempts?: number, delayMs?: number, signal?: AbortSignal, sleep?: (ms: number) => Promise<unknown>, onRetry?: (event: { attempt: number, wait: number, message: string }) => void }} [options]
 * @returns {Promise<T>}
 */
export async function retryRead(fn, { attempts = 4, delayMs = 500, signal, sleep, onRetry = () => {} } = {}) {
  for (let n = 1; ; n++) {
    signal?.throwIfAborted();
    try { return await fn(); }
    catch (error) {
      signal?.throwIfAborted();
      if (n >= attempts || /\b(401|403)\b|unauthorized|forbidden/i.test(error.message)) throw error;
      const wait = Math.min(delayMs * 2 ** (n - 1), 30000);
      onRetry({ attempt: n, wait, message: error.message });
      if (sleep) await sleep(wait);
      else await new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(finish, wait);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
      });
    }
  }
}
