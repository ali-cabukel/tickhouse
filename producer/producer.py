"""Synthetic trade generator: geometric Brownian motion prices -> Kafka (JSON)."""
import json, math, os, random, time, uuid
from confluent_kafka import Producer

BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "localhost:29092")
TOPIC = os.getenv("TOPIC", "trades")
RATE = float(os.getenv("TRADES_PER_SEC", "200"))

# symbol -> (start price, annualised volatility)
SYMBOLS = {
    "AAPL": (228.0, 0.25), "MSFT": (430.0, 0.22), "NVDA": (118.0, 0.55),
    "TSLA": (240.0, 0.60), "JPM": (210.0, 0.20), "GS": (500.0, 0.25),
}
EXCHANGES = ["NASDAQ", "NYSE", "ARCA", "BATS", "IEX"]
prices = {s: p for s, (p, _) in SYMBOLS.items()}

def next_price(sym: str, dt: float) -> float:
    vol = SYMBOLS[sym][1]
    t = dt / (252 * 6.5 * 3600)          # fraction of a trading year
    shock = random.gauss(0, 1) * vol * math.sqrt(t) * 50  # amplified so moves are visible
    prices[sym] = max(0.01, prices[sym] * math.exp(shock))
    return round(prices[sym], 4)

def main():
    p = Producer({"bootstrap.servers": BOOTSTRAP, "linger.ms": 20, "acks": "1"})
    print(f"Producing to {BOOTSTRAP}/{TOPIC} at ~{RATE}/s")
    interval, sent = 1.0 / RATE, 0
    while True:
        sym = random.choice(list(SYMBOLS))
        trade = {
            "trade_id": uuid.uuid4().hex,
            "symbol": sym,
            "ts_ms": int(time.time() * 1000),
            "price": next_price(sym, interval),
            "quantity": int(random.lognormvariate(4, 1)) + 1,
            "side": random.choice(["buy", "sell"]),
            "exchange": random.choice(EXCHANGES),
        }
        p.produce(TOPIC, key=sym, value=json.dumps(trade))
        sent += 1
        if sent % 1000 == 0:
            p.flush()
            print(f"sent {sent} trades")
        p.poll(0)
        time.sleep(interval)

if __name__ == "__main__":
    main()
