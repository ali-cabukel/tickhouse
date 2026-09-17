import { gql } from "urql";

// Decimal fields arrive as strings; BigInt fields as JSON numbers.
export type Interval = "ONE_MINUTE" | "FIVE_MINUTES" | "FIFTEEN_MINUTES" | "ONE_HOUR" | "ONE_DAY";

export interface LatestPrice { symbol: string; price: string; ts: string }
export interface Candle {
  time: string; open: string; high: string; low: string; close: string;
  volume: number; trades: number;
}
export interface Vwap { symbol: string; vwap: string; volume: number }
export interface OrderFlow {
  exchange: string; buyVolume: number; sellVolume: number; imbalance: number | null;
}

export const LatestPricesQuery = gql<{ latestPrices: LatestPrice[] }>`
  query LatestPrices {
    latestPrices { symbol price ts }
  }
`;

export const PriceTicksSubscription = gql<{ priceTicks: LatestPrice }>`
  subscription PriceTicks {
    priceTicks(intervalSeconds: 1) { symbol price ts }
  }
`;

export const CandlesQuery = gql<
  { candles: Candle[] },
  { symbol: string; interval: Interval; limit: number }
>`
  query Candles($symbol: String!, $interval: Interval!, $limit: Int!) {
    candles(symbol: $symbol, interval: $interval, limit: $limit) {
      time open high low close volume trades
    }
  }
`;

export const MarketStatsQuery = gql<
  { vwap: Vwap[]; orderFlow: OrderFlow[] },
  { window: number }
>`
  query MarketStats($window: Int!) {
    vwap(windowMinutes: $window) { symbol vwap volume }
    orderFlow(windowMinutes: $window) { exchange buyVolume sellVolume imbalance }
  }
`;
