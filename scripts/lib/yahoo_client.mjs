import YahooFinance from 'yahoo-finance2';
import { retryRead } from '../../shared/retry.mjs';
export function createYahooClient() {
  const client = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ['yahooSurvey'],
    fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }),
  });
  return new Proxy(client, { get(target, prop) {
    const method = target[prop];
    if (!['quote', 'chart', 'options', 'search', 'quoteSummary'].includes(prop)) return typeof method === 'function' ? method.bind(target) : method;
    return (...args) => retryRead(() => method.apply(target, args), {
      onRetry: ({ attempt, wait }) => console.warn(`[Yahoo ${String(prop)}] retry ${attempt} in ${wait}ms`),
    });
  } });
}
