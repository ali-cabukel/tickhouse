import { useState } from "react";
import { useLinkState, useLivePrices } from "./hooks";
import type { Interval } from "./queries";
import { TickerStrip } from "./components/TickerStrip";
import { CandleChart } from "./components/CandleChart";
import { MarketStats } from "./components/MarketStats";

const LINK_TEXT = { live: "Live", connecting: "Connecting…", offline: "Reconnecting…" };

export function App() {
  const { quotes, error, loading } = useLivePrices();
  const link = useLinkState();
  const [picked, setPicked] = useState<string | null>(null);
  const [candleInterval, setCandleInterval] = useState<Interval>("ONE_MINUTE");
  const [statsMinutes, setStatsMinutes] = useState(5);

  const list = Object.values(quotes).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const selected = picked ?? list[0]?.symbol ?? null;

  return (
    <div className="app">
      <header className="top">
        <h1>Market desk</h1>
        <span className={`link ${link}`} role="status">{LINK_TEXT[link]}</span>
      </header>

      {error && (
        <p className="error">
          Can't reach the API at /graphql ({error.message}). Check that the api container is running.
        </p>
      )}
      {loading ? <p className="empty">Loading prices…</p> : (
        <TickerStrip quotes={list} selected={selected ?? ""} onSelect={setPicked} />
      )}

      <main className="grid">
        {selected && (
          <CandleChart symbol={selected} interval={candleInterval} onIntervalChange={setCandleInterval} />
        )}
        <MarketStats quotes={quotes} minutes={statsMinutes} onMinutesChange={setStatsMinutes} />
      </main>
    </div>
  );
}
