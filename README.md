# ClickHouse + Kafka: real-time trades prototype

Producer (synthetic GBM trades) -> Kafka topic `trades` -> ClickHouse Kafka engine
-> materialized view -> `market.trades` (MergeTree) -> `market.ohlcv_1m` (AggregatingMergeTree).

## Run
    docker compose up --build
    # wait ~20s, then:
    docker compose exec clickhouse clickhouse-client --password clickhouse \
      -q "SELECT symbol, count() FROM market.trades GROUP BY symbol"

Run the example analytics:
    docker compose exec -T clickhouse clickhouse-client --password clickhouse \
      --multiquery < clickhouse/queries.sql

HTTP interface: http://localhost:8123/play (user `default`, password `clickhouse`).
Kafka from host: localhost:29092 (run producer locally with `KAFKA_BOOTSTRAP=localhost:29092`).

## GraphQL API (Strawberry + FastAPI)
GraphiQL: http://localhost:8000/graphql — example operations in `api/example_queries.graphql`.

Queries: `symbols`, `latestPrices`, `candles(symbol, interval, since, until, limit)`,
`trades(symbol, limit)`, `vwap(windowMinutes)`, `orderFlow(windowMinutes)`.
Subscription: `priceTicks(symbols, intervalSeconds)` over WebSocket.

    curl -s localhost:8000/graphql -H 'content-type: application/json' \
      -d '{"query":"{ vwap(windowMinutes: 5) { symbol vwap volume } }"}'

Guardrails: purpose-built fields only (no generic table access), server-side
parameter binding, row limits capped at 1000, time windows capped at 24h,
query depth and alias limits. Decimals serialize as strings; volumes use a
64-bit `BigInt` scalar.

Run the API locally against the containers:
    cd api && pip install -r requirements.txt
    CLICKHOUSE_HOST=localhost uvicorn app.main:app --reload

## Dashboard (React + urql)
http://localhost:3000: live price strip (GraphQL subscription over WebSocket),
candlestick chart with interval switcher, price-vs-VWAP table and order flow by exchange.

- `web/src/client.ts`: urql client with `cacheExchange`, `fetchExchange` and a
  `subscriptionExchange` backed by `graphql-ws` (same `graphql-transport-ws` protocol as Strawberry).
- `web/src/queries.ts`: typed documents via urql's `gql<Data, Variables>`.
- `web/src/hooks.ts`: `useLivePrices` (HTTP snapshot + subscription), `usePoll`
  (urql v4 has no `pollInterval`, so queries re-run with `requestPolicy: "network-only"`),
  and `useLinkState` for the connection indicator.
- Prices stay as strings end to end; `decimal.js` handles comparisons and bps math.
  Only the chart converts to floats, for drawing.
- In Docker, nginx serves the build and proxies `/graphql` (HTTP and WebSocket) to the API.

Local development with hot reload (API running on :8000):

    cd web && npm install && npm run dev   # http://localhost:5173, Vite proxies /graphql

## Design notes
- `trades_queue` (Kafka engine) only reads the stream; the MV persists rows.
- Timestamps arrive as epoch millis and are converted in the MV to avoid JSON date parsing issues.
- `ohlcv_1m` stores aggregate *states*; always query it with `-Merge` functions + GROUP BY,
  because background merges are eventual.
- `ORDER BY (symbol, ts)` makes per-symbol time-range scans fast.
- Swapping in real data: point any feed (e.g. Alpaca, Polygon, Binance websocket) at the same
  JSON shape and topic; nothing in ClickHouse changes.

## Reset
    docker compose down -v
