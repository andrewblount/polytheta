import YahooFinance from "yahoo-finance2";
import { classifyNews } from "../../../shared/news-radar.mjs";
import { retryRead } from "../../../shared/retry.mjs";

export interface RadarHit {
  title: string; link: string; publisher: string; publishedAt: string; matched: string; actionable: boolean;
}
export async function scanNewsRadar(ticker: string, side: "call" | "put", name = "", options: { signal?: AbortSignal; requestTimeoutMs?: number; attempts?: number } = {}): Promise<RadarHit[]> {
  const yf = new YahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ["yahooSurvey"],
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(options.requestTimeoutMs ?? 15000), ...(init?.signal ? [init.signal] : []), ...(options.signal ? [options.signal] : [])]) }),
  });
  // Propagate outages: a failed scan must never be reported as clean.
  const result = await retryRead(() => yf.search(ticker, { newsCount: 20, quotesCount: 0 }), { attempts: options.attempts ?? 4 });
  return classifyNews(result.news ?? [], { ticker, name, lookbackHours: 96 })[side];
}
