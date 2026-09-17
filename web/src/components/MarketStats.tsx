import { useQuery } from "urql";
import { MarketStatsQuery } from "../queries";
import { usePoll, type LiveQuote } from "../hooks";
import * as fmt from "../format";

const WINDOWS = [1, 5, 15, 60];

interface Props {
  quotes: Record<string, LiveQuote>;
  minutes: number;
  onMinutesChange: (m: number) => void;
}

export function MarketStats({ quotes, minutes, onMinutesChange }: Props) {
  const [result, reexecute] = useQuery({ query: MarketStatsQuery, variables: { window: minutes } });
  usePoll(() => reexecute({ requestPolicy: "network-only" }), 3000);
  const vwap = result.data?.vwap ?? [];
  const flow = result.data?.orderFlow ?? [];

  return (
    <section className="panel stats-panel" aria-label="Market statistics">
      <header className="panel-head">
        <h2>Last {minutes} min</h2>
        <div className="segmented" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} aria-pressed={w === minutes} onClick={() => onMinutesChange(w)}>
              {w}m
            </button>
          ))}
        </div>
      </header>

      {result.error && <p className="error">Couldn't load stats: {result.error.message}</p>}

      <table className="vwap">
        <caption>Price against VWAP</caption>
        <thead>
          <tr><th scope="col">Symbol</th><th scope="col">VWAP</th><th scope="col">Last vs VWAP</th><th scope="col">Volume</th></tr>
        </thead>
        <tbody>
          {vwap.map((v) => {
            const last = quotes[v.symbol]?.price;
            const diff = last ? fmt.bps(last, v.vwap) : null;
            return (
              <tr key={v.symbol}>
                <th scope="row">{v.symbol}</th>
                <td>{fmt.price(v.vwap)}</td>
                <td className={diff == null ? "" : diff >= 0 ? "up" : "down"}>
                  {diff == null ? "–" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)} bps`}
                </td>
                <td>{fmt.volume(v.volume)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>Order flow by exchange</h3>
      <ul className="flow">
        {flow.map((f) => {
          const imb = f.imbalance ?? 0;
          const width = `${Math.abs(imb) * 50}%`;
          return (
            <li key={f.exchange}>
              <span className="flow-name">{f.exchange}</span>
              <span className="flow-track" aria-hidden="true">
                <span
                  className={`flow-bar ${imb >= 0 ? "up" : "down"}`}
                  style={imb >= 0 ? { left: "50%", width } : { right: "50%", width }}
                />
              </span>
              <span className="flow-value">
                {imb >= 0 ? "Buy" : "Sell"} {Math.abs(imb * 100).toFixed(1)}%
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
