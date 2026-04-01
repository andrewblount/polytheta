import yahooFinance from "yahoo-finance2";

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

const yahooClient = yahooFinance as unknown as {
  quote: (ticker: string) => Promise<{
    symbol: string;
    regularMarketPrice?: number;
    currency?: string;
    regularMarketTime?: number;
  }>;
  chart: (
    ticker: string,
    options: {
      period1: Date;
      period2: Date;
      interval: string;
      return: "array";
    },
  ) => Promise<{
    quotes: Array<{
      date: Date;
      open?: number;
      high?: number;
      low?: number;
      close?: number;
      volume?: number;
    }>;
  }>;
  options: (
    ticker: string,
    options: { date: Date },
  ) => Promise<{
    expirationDate: string | Date;
    calls?: Array<{
      contractSymbol: string;
      strike: number;
      bid?: number | null;
      ask?: number | null;
      lastPrice?: number | null;
      impliedVolatility?: number | null;
      inTheMoney?: boolean | null;
    }>;
    puts?: Array<{
      contractSymbol: string;
      strike: number;
      bid?: number | null;
      ask?: number | null;
      lastPrice?: number | null;
      impliedVolatility?: number | null;
      inTheMoney?: boolean | null;
    }>;
  }>;
};

export class YahooMarketDataProvider implements MarketDataProvider {
  async getQuote(ticker: string): Promise<QuoteResult | null> {
    try {
      const quote = await yahooClient.quote(ticker);
      if (!quote.regularMarketPrice) {
        return null;
      }

      return {
        symbol: quote.symbol,
        regularMarketPrice: quote.regularMarketPrice,
        currency: quote.currency,
        marketTime: quote.regularMarketTime
          ? new Date(quote.regularMarketTime * 1000).toISOString()
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
      const chart = await yahooClient.chart(ticker, {
        period1: new Date(startDate),
        period2: new Date(endDate),
        interval: "1d",
        return: "array",
      });

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

  async getOptionChain(
    ticker: string,
    expiry: string,
  ): Promise<OptionChainResult | null> {
    try {
      const result = await yahooClient.options(ticker, {
        date: new Date(expiry),
      });

      const normalizedExpiry = normalizeExpiration(result.expirationDate);
      const calls = (result.calls ?? []).map((contract) =>
        this.normalizeContract(contract, "call", normalizedExpiry),
      );
      const puts = (result.puts ?? []).map((contract) =>
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
