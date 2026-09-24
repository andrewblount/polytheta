import yahooFinance from "yahoo-finance2";
import { retryRead } from "../../../shared/retry.mjs";

import type {
  HistoricalPrice,
  MarketDataProvider,
  OptionChainResult,
  OptionContractQuote,
  QuoteResult,
} from "./provider";

function normalizeExpiration(input: string | Date) {
  const date = input instanceof Date ? input : new Date(input);
  return date.toISOString().slice(0, 10);
}

function createYahooClient(signal?: AbortSignal, timeoutMs = 15000) {
  return new yahooFinance({ validation: { logErrors: false, logOptionsErrors: false }, suppressNotices: ["yahooSurvey"],
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : []), ...(signal ? [signal] : [])]) }),
  });
}

export class YahooMarketDataProvider implements MarketDataProvider {
  private readonly client: ReturnType<typeof createYahooClient>;
  private readonly attempts: number;
  constructor({ signal, requestTimeoutMs = 15000, attempts = 3 }: { signal?: AbortSignal; requestTimeoutMs?: number; attempts?: number } = {}) {
    this.client = createYahooClient(signal, requestTimeoutMs);
    this.attempts = attempts;
  }
  async getQuote(ticker: string): Promise<QuoteResult | null> {
    try {
      const quote = await retryRead(() => this.client.quote(ticker), { attempts: this.attempts });
      if (!quote.regularMarketPrice) {
        return null;
      }

      return {
        symbol: quote.symbol,
        regularMarketPrice: quote.regularMarketPrice,
        currency: quote.currency,
        marketTime: quote.regularMarketTime
          ? new Date(quote.regularMarketTime).toISOString()
          : undefined,
      };
    } catch {
      return null;
    }
  }

  async getHistoricalPrices(
    ticker: string,
    startDate: string,
    endDate: string,
  ): Promise<HistoricalPrice[]> {
    try {
      const chart = await retryRead(() => this.client.chart(ticker, {
        period1: new Date(startDate),
        period2: new Date(endDate),
        interval: "1d",
      }), { attempts: this.attempts });

      return chart.quotes.map((quote) => ({
        date: quote.date.toISOString(),
        open: quote.open ?? null,
        high: quote.high ?? null,
        low: quote.low ?? null,
        close: quote.close ?? 0,
        volume: quote.volume ?? null,
      }));
    } catch {
      return [];
    }
  }

  // Intraday bars (regular and extended hours; callers filter to the session).
  // Yahoo serves 30-minute bars for the last 60 days and hourly bars for two years.
  async getIntradayPrices(ticker: string, start: Date, end: Date, interval: "30m" | "1h" = "30m"): Promise<HistoricalPrice[]> {
    try {
      const chart = await retryRead(() => this.client.chart(ticker, { period1: start, period2: end, interval }), { attempts: this.attempts });
      return chart.quotes.filter((q) => q.close != null).map((quote) => ({
        date: quote.date.toISOString(), open: quote.open ?? null, high: quote.high ?? null, low: quote.low ?? null, close: quote.close ?? 0, volume: quote.volume ?? null,
      }));
    } catch {
      return [];
    }
  }

  async getOptionChain(
    ticker: string,
    expiry: string,
  ): Promise<OptionChainResult | null> {
    try {
      const result = await retryRead(() => this.client.options(ticker, {
        date: new Date(expiry),
      }), { attempts: this.attempts });

      const series = result.options.find(option => normalizeExpiration(option.expirationDate) === expiry);
      if (!series) return null;
      const normalizedExpiry = normalizeExpiration(series.expirationDate);
      const calls = (series.calls ?? []).map((contract) =>
        this.normalizeContract(contract, "call", normalizedExpiry),
      );
      const puts = (series.puts ?? []).map((contract) =>
        this.normalizeContract(contract, "put", normalizedExpiry),
      );

      return {
        expiration: normalizedExpiry,
        contracts: [...calls, ...puts],
      };
    } catch {
      return null;
    }
  }

  async getOptionQuote(
    ticker: string,
    expiry: string,
    strike: number,
    optionType: "call" | "put",
  ): Promise<OptionContractQuote | null> {
    const chain = await this.getOptionChain(ticker, expiry);
    if (!chain) {
      return null;
    }

    const contract = chain.contracts.find(
      (item) =>
        item.optionType === optionType &&
        Math.abs(item.strike - strike) < 0.001 &&
        item.expiration === expiry,
    );

    return contract ?? null;
  }

  private normalizeContract(
    contract: {
      contractSymbol: string;
      strike: number;
      bid?: number | null;
      ask?: number | null;
      lastPrice?: number | null;
      impliedVolatility?: number | null;
      inTheMoney?: boolean | null;
    },
    optionType: "call" | "put",
    expiration: string,
  ): OptionContractQuote {
    return {
      contractSymbol: contract.contractSymbol,
      strike: contract.strike,
      expiration,
      optionType,
      bid: contract.bid ?? null,
      ask: contract.ask ?? null,
      lastPrice: contract.lastPrice ?? null,
      impliedVolatility: contract.impliedVolatility ?? null,
      inTheMoney: contract.inTheMoney ?? null,
    };
  }
}

export const defaultMarketDataProvider = new YahooMarketDataProvider();
