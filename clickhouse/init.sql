CREATE DATABASE IF NOT EXISTS market;

-- 1) Kafka consumer table (a stream reader, not storage)
CREATE TABLE market.trades_queue
(
    trade_id  String,
    symbol    String,
    ts_ms     UInt64,
    price     Float64,
    quantity  UInt32,
    side      String,
    exchange  String
)
ENGINE = Kafka
SETTINGS kafka_broker_list = 'kafka:9092',
         kafka_topic_list = 'trades',
         kafka_group_name = 'clickhouse_trades',
         kafka_format = 'JSONEachRow',
         kafka_num_consumers = 1,
         kafka_skip_broken_messages = 100;

-- 2) Durable storage for raw ticks
CREATE TABLE market.trades
(
    trade_id  String,
    symbol    LowCardinality(String),
    ts        DateTime64(3, 'UTC'),
    price     Decimal(18, 4),
    quantity  UInt32,
    side      Enum8('buy' = 1, 'sell' = 2),
    exchange  LowCardinality(String),
    notional  Decimal(18, 4) MATERIALIZED price * quantity
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(ts)
ORDER BY (symbol, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

-- 3) Pipe Kafka -> MergeTree
CREATE MATERIALIZED VIEW market.trades_mv TO market.trades AS
SELECT
    trade_id,
    symbol,
    fromUnixTimestamp64Milli(toInt64(ts_ms), 'UTC') AS ts,
    toDecimal64(price, 4) AS price,
    quantity,
    side,
    exchange
FROM market.trades_queue;

-- 4) Incrementally maintained 1-minute OHLCV candles
CREATE TABLE market.ohlcv_1m
(
    symbol  LowCardinality(String),
    minute  DateTime('UTC'),
    open    AggregateFunction(argMin, Decimal(18, 4), DateTime64(3, 'UTC')),
    high    SimpleAggregateFunction(max, Decimal(18, 4)),
    low     SimpleAggregateFunction(min, Decimal(18, 4)),
    close   AggregateFunction(argMax, Decimal(18, 4), DateTime64(3, 'UTC')),
    volume  SimpleAggregateFunction(sum, UInt64),
    trades  SimpleAggregateFunction(sum, UInt64)
)
ENGINE = AggregatingMergeTree
ORDER BY (symbol, minute);

CREATE MATERIALIZED VIEW market.ohlcv_1m_mv TO market.ohlcv_1m AS
SELECT
    symbol,
    toStartOfMinute(ts)       AS minute,
    argMinState(price, ts)    AS open,
    max(price)                AS high,
    min(price)                AS low,
    argMaxState(price, ts)    AS close,
    sum(toUInt64(quantity))   AS volume,
    count()                   AS trades
FROM market.trades
GROUP BY symbol, minute;
