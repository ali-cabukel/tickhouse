"""GraphQL API (Strawberry + FastAPI) over the ClickHouse market database."""
import asyncio
import inspect
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import AsyncGenerator, NewType, Optional

import clickhouse_connect
import strawberry
from fastapi import FastAPI
from strawberry.extensions import MaxAliasesLimiter, QueryDepthLimiter
from strawberry.fastapi import GraphQLRouter
from strawberry.types import Info

CH_SETTINGS = dict(
    host=os.getenv("CLICKHOUSE_HOST", "localhost"),
    port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
    username=os.getenv("CLICKHOUSE_USER", "default"),
    password=os.getenv("CLICKHOUSE_PASSWORD", "clickhouse"),
    database="market",
)
MAX_ROWS = 1000
state: dict = {}

# GraphQL Int is 32-bit; volumes can exceed it, so use a 64-bit-safe scalar.
BigInt = strawberry.scalar(
    NewType("BigInt", int),
    serialize=int,
    parse_value=int,
    description="64-bit integer",
)


def clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


def utc(dt: datetime) -> datetime:
    """ClickHouse returns naive datetimes for UTC columns; make that explicit."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def epoch(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


async def fetch(info: Info, sql: str, params: Optional[dict] = None) -> list[dict]:
    client = info.context["ch"]
    result = await client.query(sql, parameters=params or {})
    return list(result.named_results())


# ---------- Types ----------

@strawberry.enum
class Interval(Enum):
    ONE_MINUTE = 1
    FIVE_MINUTES = 5
    FIFTEEN_MINUTES = 15
    ONE_HOUR = 60
    ONE_DAY = 1440


@strawberry.type
class Trade:
    id: str
    symbol: str
    ts: datetime
    price: Decimal
    quantity: int
    side: str
    exchange: str


@strawberry.type
class Candle:
    symbol: str
    time: datetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: BigInt
    trades: BigInt


@strawberry.type
class LatestPrice:
    symbol: str
    price: Decimal
    ts: datetime


@strawberry.type
class Vwap:
    symbol: str
    vwap: Decimal
    volume: BigInt


@strawberry.type
class OrderFlow:
    exchange: str
    buy_volume: BigInt
    sell_volume: BigInt

    @strawberry.field(description="(buy - sell) / (buy + sell), between -1 and 1")
    def imbalance(self) -> Optional[float]:
        total = self.buy_volume + self.sell_volume
        return round((self.buy_volume - self.sell_volume) / total, 4) if total else None


# ---------- Queries ----------

LATEST_SQL = """
SELECT symbol, argMax(price, ts) AS last_price, max(ts) AS last_ts
FROM market.trades
WHERE ts > now() - INTERVAL {lookback:UInt32} MINUTE {symbol_filter}
GROUP BY symbol
ORDER BY symbol
"""


async def latest_prices(info: Info, symbols: Optional[list[str]], lookback_min: int) -> list[LatestPrice]:
    params: dict = {"lookback": lookback_min}
    symbol_filter = ""
    if symbols:
        symbol_filter = "AND symbol IN {symbols:Array(String)}"
        params["symbols"] = symbols
    rows = await fetch(info, LATEST_SQL.replace("{symbol_filter}", symbol_filter), params)
    return [LatestPrice(symbol=r["symbol"], price=r["last_price"], ts=utc(r["last_ts"])) for r in rows]


@strawberry.type
class Query:
    @strawberry.field(description="Symbols that have candle data")
    async def symbols(self, info: Info) -> list[str]:
        rows = await fetch(info, "SELECT DISTINCT symbol FROM market.ohlcv_1m ORDER BY symbol")
        return [r["symbol"] for r in rows]

    @strawberry.field(description="Most recent trade price per symbol (last 24h)")
    async def latest_prices(self, info: Info, symbols: Optional[list[str]] = None) -> list[LatestPrice]:
        return await latest_prices(info, symbols, lookback_min=1440)

    @strawberry.field(description="OHLCV candles, newest first")
    async def candles(
        self,
        info: Info,
        symbol: str,
        interval: Interval = Interval.ONE_MINUTE,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        limit: int = 200,
    ) -> list[Candle]:
        now = datetime.now(timezone.utc)
        sql = """
        SELECT symbol,
               toStartOfInterval(m, INTERVAL {mins:UInt32} MINUTE) AS bucket,
               argMin(o, m) AS open_p, max(h) AS high_p, min(l) AS low_p,
               argMax(c, m) AS close_p, sum(v) AS vol, sum(n) AS n_trades
        FROM (
            SELECT symbol, minute AS m,
                   argMinMerge(open) AS o, max(high) AS h, min(low) AS l,
                   argMaxMerge(close) AS c, sum(volume) AS v, sum(trades) AS n
            FROM market.ohlcv_1m
            WHERE symbol = {symbol:String}
              AND minute >= toDateTime({start:UInt32})
              AND minute <  toDateTime({end:UInt32})
            GROUP BY symbol, minute
        )
        GROUP BY symbol, bucket
        ORDER BY bucket DESC
        LIMIT {limit:UInt32}
        """
        rows = await fetch(info, sql, {
            "symbol": symbol,
            "mins": interval.value,
            "start": epoch(since or now - timedelta(days=1)),
            "end": epoch(until or now + timedelta(minutes=1)),
            "limit": clamp(limit, 1, MAX_ROWS),
        })
        return [
            Candle(symbol=r["symbol"], time=utc(r["bucket"]), open=r["open_p"], high=r["high_p"],
                   low=r["low_p"], close=r["close_p"], volume=r["vol"], trades=r["n_trades"])
            for r in rows
        ]

    @strawberry.field(description="Recent raw trades for one symbol, newest first")
    async def trades(self, info: Info, symbol: str, limit: int = 100) -> list[Trade]:
        sql = """
        SELECT trade_id, symbol, ts, price, quantity, side, exchange
        FROM market.trades
        WHERE symbol = {symbol:String} AND ts > now() - INTERVAL 1 DAY
        ORDER BY ts DESC
        LIMIT {limit:UInt32}
        """
        rows = await fetch(info, sql, {"symbol": symbol, "limit": clamp(limit, 1, MAX_ROWS)})
        return [
            Trade(id=r["trade_id"], symbol=r["symbol"], ts=utc(r["ts"]), price=r["price"],
                  quantity=r["quantity"], side=str(r["side"]), exchange=r["exchange"])
            for r in rows
        ]

    @strawberry.field(description="Volume-weighted average price over a trailing window")
    async def vwap(self, info: Info, window_minutes: int = 5) -> list[Vwap]:
        sql = """
        SELECT symbol,
               sum(price * quantity) / sum(quantity) AS vwap_p,
               sum(quantity) AS vol
        FROM market.trades
        WHERE ts > now() - INTERVAL {w:UInt32} MINUTE
        GROUP BY symbol
        ORDER BY vol DESC
        """
        rows = await fetch(info, sql, {"w": clamp(window_minutes, 1, 1440)})
        return [Vwap(symbol=r["symbol"], vwap=r["vwap_p"], volume=r["vol"]) for r in rows]

    @strawberry.field(description="Buy vs sell volume per exchange over a trailing window")
    async def order_flow(self, info: Info, window_minutes: int = 10) -> list[OrderFlow]:
        sql = """
        SELECT exchange,
               sumIf(quantity, side = 'buy')  AS buy_v,
               sumIf(quantity, side = 'sell') AS sell_v
        FROM market.trades
        WHERE ts > now() - INTERVAL {w:UInt32} MINUTE
        GROUP BY exchange
        ORDER BY exchange
        """
        rows = await fetch(info, sql, {"w": clamp(window_minutes, 1, 1440)})
        return [OrderFlow(exchange=r["exchange"], buy_volume=r["buy_v"], sell_volume=r["sell_v"])
                for r in rows]


# ---------- Subscriptions ----------

@strawberry.type
class Subscription:
    @strawberry.subscription(description="Pushes a symbol's price whenever it has a new trade")
    async def price_ticks(
        self, info: Info, symbols: Optional[list[str]] = None, interval_seconds: float = 1.0
    ) -> AsyncGenerator[LatestPrice, None]:
        interval_seconds = max(0.5, min(interval_seconds, 60.0))
        last_seen: dict[str, datetime] = {}
        while True:
            for p in await latest_prices(info, symbols, lookback_min=5):
                if last_seen.get(p.symbol) != p.ts:
                    last_seen[p.symbol] = p.ts
                    yield p
            await asyncio.sleep(interval_seconds)


# ---------- App ----------

schema = strawberry.Schema(
    query=Query,
    subscription=Subscription,
    extensions=[QueryDepthLimiter(max_depth=6), MaxAliasesLimiter(max_alias_count=15)],
)


async def get_context() -> dict:
    return {"ch": state["ch"]}


@asynccontextmanager
async def lifespan(app: FastAPI):
    for attempt in range(30):  # ClickHouse may still be starting
        try:
            state["ch"] = await clickhouse_connect.get_async_client(**CH_SETTINGS)
            break
        except Exception as exc:
            print(f"ClickHouse not ready ({attempt + 1}/30): {exc}")
            await asyncio.sleep(2)
    else:
        raise RuntimeError("Could not connect to ClickHouse")
    yield
    closing = state["ch"].close()
    if inspect.isawaitable(closing):
        await closing


app = FastAPI(title="Market GraphQL API", lifespan=lifespan)
app.include_router(GraphQLRouter(schema, context_getter=get_context), prefix="/graphql")


@app.get("/health")
async def health() -> dict:
    await state["ch"].query("SELECT 1")
    return {"status": "ok"}
