-- Ingestion check
SELECT count(), max(ts) FROM market.trades;

-- Latest price per symbol
SELECT symbol, argMax(price, ts) AS last_price, max(ts) AS last_trade
FROM market.trades GROUP BY symbol ORDER BY symbol;

-- VWAP over the last 5 minutes
SELECT symbol,
       round(sum(price * quantity) / sum(quantity), 4) AS vwap_5m,
       sum(quantity) AS volume
FROM market.trades
WHERE ts > now() - INTERVAL 5 MINUTE
GROUP BY symbol ORDER BY volume DESC;

-- 1-minute candles from the pre-aggregated table
SELECT symbol, minute,
       argMinMerge(open) AS open, max(high) AS high,
       min(low) AS low, argMaxMerge(close) AS close,
       sum(volume) AS volume, sum(trades) AS trades
FROM market.ohlcv_1m
WHERE symbol = 'NVDA'
GROUP BY symbol, minute
ORDER BY minute DESC LIMIT 20;

-- 5-candle simple moving average (window function)
SELECT symbol, minute, close,
       avg(close) OVER (PARTITION BY symbol ORDER BY minute
                        ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) AS sma_5
FROM (
    SELECT symbol, minute, argMaxMerge(close) AS close
    FROM market.ohlcv_1m GROUP BY symbol, minute
)
ORDER BY symbol, minute DESC LIMIT 30;

-- Buy/sell imbalance per exchange (last 10 min)
SELECT exchange,
       sumIf(quantity, side = 'buy')  AS buy_vol,
       sumIf(quantity, side = 'sell') AS sell_vol,
       round((buy_vol - sell_vol) / (buy_vol + sell_vol), 3) AS imbalance
FROM market.trades
WHERE ts > now() - INTERVAL 10 MINUTE
GROUP BY exchange ORDER BY exchange;
