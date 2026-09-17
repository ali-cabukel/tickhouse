import type { LiveQuote } from "../hooks";
import * as fmt from "../format";

interface Props {
  quotes: LiveQuote[];
  selected: string;
  onSelect: (symbol: string) => void;
}

export function TickerStrip({ quotes, selected, onSelect }: Props) {
  if (quotes.length === 0) {
    return <p className="empty">No trades yet. Start the producer to see live prices.</p>;
  }
  return (
    <div className="ticker" role="tablist" aria-label="Symbols">
      {quotes.map((q) => (
        <button
          key={q.symbol}
          role="tab"
          aria-selected={q.symbol === selected}
          className="quote"
          onClick={() => onSelect(q.symbol)}
        >
          <span className="quote-symbol">{q.symbol}</span>
          {/* key on ts restarts the flash animation on every tick */}
          <span key={q.ts} className={`quote-price ${q.direction}`}>
            {fmt.price(q.price)}
          </span>
        </button>
      ))}
    </div>
  );
}
