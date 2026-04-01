export interface QuoteResult {
  symbol: string;
  regularMarketPrice: number;
  currency?: string;
  marketTime?: string;
}

export interface HistoricalPrice {
  date: string;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close: number;
  volume?: number | null;
}

export interface OptionContractQuote {
  contractSymbol: string;
  strike: number;
  expiration: string;
  optionType: "call" | "put";
  bid?: number | null;
  ask?: number | null;
  lastPrice?: number | null;
  impliedVolatility?: number | null;
  inTheMoney?: boolean | null;
}

export interface OptionChainResult {
  expiration: string;
  contracts: OptionContractQuote[];
}

export interface MarketDataProvider {
  getQuote(ticker: string): Promise<QuoteResult | null>;
  getHistoricalPrices(
    ticker: string,
    startDate: string,
    endDate: string,
  ): Promise<HistoricalPrice[]>;
  getOptionChain(ticker: string, expiry: string): Promise<OptionChainResult | null>;
  getOptionQuote(
    ticker: string,
    expiry: string,
    strike: number,
    optionType: "call" | "put",
  ): Promise<OptionContractQuote | null>;
}
