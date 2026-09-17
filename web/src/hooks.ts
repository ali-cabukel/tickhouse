import { useEffect, useRef, useState } from "react";
import { useQuery, useSubscription } from "urql";
import Decimal from "decimal.js";
import { wsClient } from "./client";
import { LatestPricesQuery, PriceTicksSubscription } from "./queries";

/** Re-run a callback on an interval (urql v4 has no built-in pollInterval). */
export function usePoll(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export type Direction = "up" | "down" | "flat";
export interface LiveQuote { symbol: string; price: string; ts: string; direction: Direction }

/** Initial snapshot over HTTP, then live updates over the WebSocket subscription. */
export function useLivePrices() {
  const [snapshot] = useQuery({ query: LatestPricesQuery });

  const [live] = useSubscription(
    { query: PriceTicksSubscription },
    (prev: Record<string, LiveQuote> = {}, data) => {
      const tick = data.priceTicks;
      const before = prev[tick.symbol]?.price;
      const cmp = before ? new Decimal(tick.price).cmp(before) : 0;
      const direction: Direction = cmp > 0 ? "up" : cmp < 0 ? "down" : "flat";
      return { ...prev, [tick.symbol]: { ...tick, direction } };
    },
  );

  const quotes: Record<string, LiveQuote> = {};
  for (const p of snapshot.data?.latestPrices ?? []) {
    quotes[p.symbol] = { ...p, direction: "flat" };
  }
  Object.assign(quotes, live.data ?? {});

  return { quotes, error: snapshot.error ?? live.error, loading: snapshot.fetching && !snapshot.data };
}

export type LinkState = "connecting" | "live" | "offline";

export function useLinkState(): LinkState {
  const [state, setState] = useState<LinkState>("connecting");
  useEffect(() => {
    const offs = [
      wsClient.on("connecting", () => setState("connecting")),
      wsClient.on("connected", () => setState("live")),
      wsClient.on("closed", () => setState("offline")),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  return state;
}
