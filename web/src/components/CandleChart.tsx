import { useEffect, useRef, useState } from "react";
import { useQuery } from "urql";
import { CandlesQuery, type Candle, type Interval } from "../queries";
import { usePoll } from "../hooks";
import * as fmt from "../format";

const INTERVALS: { value: Interval; label: string }[] = [
  { value: "ONE_MINUTE", label: "1m" },
  { value: "FIVE_MINUTES", label: "5m" },
  { value: "FIFTEEN_MINUTES", label: "15m" },
  { value: "ONE_HOUR", label: "1h" },
];

const PAD = { top: 12, right: 64, bottom: 24, left: 8 };

interface Props {
  symbol: string;
  interval: Interval;
  onIntervalChange: (i: Interval) => void;
}

export function CandleChart({ symbol, interval, onIntervalChange }: Props) {
  const [result, reexecute] = useQuery({
    query: CandlesQuery,
    variables: { symbol, interval, limit: 60 },
  });
  usePoll(() => reexecute({ requestPolicy: "network-only" }), 5000);

  const candles = [...(result.data?.candles ?? [])].reverse(); // oldest first

  return (
    <section className="panel chart-panel" aria-label={`${symbol} price chart`}>
      <header className="panel-head">
        <h2>{symbol}</h2>
        <div className="segmented" role="group" aria-label="Candle interval">
          {INTERVALS.map((i) => (
            <button
              key={i.value}
              aria-pressed={i.value === interval}
              onClick={() => onIntervalChange(i.value)}
            >
              {i.label}
            </button>
          ))}
        </div>
      </header>

      {result.error && <p className="error">Couldn't load candles: {result.error.message}</p>}
      {!result.error && candles.length === 0 && !result.fetching && (
        <p className="empty">No candles for {symbol} in the last 24 hours.</p>
      )}
      {candles.length > 0 && <Chart candles={candles} />}
    </section>
  );
}

// Draw at the real pixel width so axis text stays legible on phones.
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Chart({ candles }: { candles: Candle[] }) {
  const [ref, W] = useWidth<HTMLDivElement>();
  return <div ref={ref}>{W > 0 && <Plot candles={candles} W={W} H={W < 500 ? 240 : 300} />}</div>;
}

function Plot({ candles, W, H }: { candles: Candle[]; W: number; H: number }) {
  const data = candles.map(toNums);
  const hi = Math.max(...data.map((c) => c.high));
  const lo = Math.min(...data.map((c) => c.low));
  const span = hi - lo || 1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = plotW / data.length;
  const body = Math.max(1, step * 0.6);
  const y = (v: number) => PAD.top + ((hi - v) / span) * plotH;
  const x = (i: number) => PAD.left + step * i + step / 2;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + span * t);
  const labelEvery = Math.ceil(data.length / (W < 500 ? 3 : 6));
  const last = data[data.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
         aria-label={`Candles from ${fmt.clock(data[0].time)} to ${fmt.clock(last.time)}, last close ${last.close.toFixed(2)}`}>
      {gridValues.map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="grid" />
          <text x={W - PAD.right + 8} y={y(v) + 4} className="axis">{v.toFixed(2)}</text>
        </g>
      ))}

      {data.map((c, i) =>
        i % labelEvery === 0 ? (
          <text key={c.time} x={i === 0 ? PAD.left : x(i)} y={H - 6}
                textAnchor={i === 0 ? "start" : "middle"} className="axis">
            {fmt.clock(c.time)}
          </text>
        ) : null,
      )}

      {data.map((c, i) => {
        const cls = c.close >= c.open ? "candle up" : "candle down";
        const top = y(Math.max(c.open, c.close));
        const height = Math.max(1, Math.abs(y(c.open) - y(c.close)));
        return (
          <g key={c.time} className={cls}>
            <line x1={x(i)} x2={x(i)} y1={y(c.high)} y2={y(c.low)} />
            <rect x={x(i) - body / 2} y={top} width={body} height={height} />
          </g>
        );
      })}

      <line x1={PAD.left} x2={W - PAD.right} y1={y(last.close)} y2={y(last.close)} className="last-line" />
      <rect x={W - PAD.right + 2} y={y(last.close) - 10} width={PAD.right - 4} height={20} rx={3} className="last-tag" />
      <text x={W - PAD.right + 8} y={y(last.close) + 4} className="last-text">{last.close.toFixed(2)}</text>
    </svg>
  );
}

// Charts only need screen precision, so floats are fine here (not for money math).
function toNums(c: Candle) {
  return { time: c.time, open: +c.open, high: +c.high, low: +c.low, close: +c.close };
}
