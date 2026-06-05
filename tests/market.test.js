import assert from "node:assert/strict";
import test from "node:test";

import {
  createTickerStore,
  formatTickerForClient,
  normalizeMiniTicker
} from "../src/market.js";

test("normalizes Binance mini ticker values into numbers", () => {
  const ticker = normalizeMiniTicker({
    s: "BTCUSDT",
    c: "69001.25000000",
    o: "68000.00000000",
    h: "70000.00000000",
    l: "67000.00000000",
    v: "123.456",
    q: "8512345.67",
    E: 1717400000000
  });

  assert.equal(ticker.symbol, "BTCUSDT");
  assert.equal(ticker.price, 69001.25);
  assert.equal(ticker.open, 68000);
  assert.equal(ticker.high, 70000);
  assert.equal(ticker.low, 67000);
  assert.equal(ticker.baseVolume, 123.456);
  assert.equal(ticker.quoteVolume, 8512345.67);
  assert.equal(ticker.changePercent, 1.4724264705882353);
  assert.equal(ticker.eventTime, 1717400000000);
});

test("ticker store keeps latest USDT markets sorted by quote volume", () => {
  const store = createTickerStore();

  store.applyMiniTickerArray([
    { s: "ETHUSDT", c: "3500", o: "3400", h: "3550", l: "3300", v: "50", q: "175000", E: 1 },
    { s: "BTCUSDT", c: "69000", o: "68000", h: "70000", l: "67000", v: "10", q: "690000", E: 2 },
    { s: "ETHBTC", c: "0.05", o: "0.051", h: "0.052", l: "0.049", v: "10", q: "0.5", E: 3 }
  ]);

  const snapshot = store.getSnapshot({ quoteAsset: "USDT" });

  assert.deepEqual(
    snapshot.map((ticker) => ticker.symbol),
    ["BTCUSDT", "ETHUSDT"]
  );
  assert.equal(snapshot[0].quoteVolume, 690000);
});

test("formats ticker rows for the browser", () => {
  const formatted = formatTickerForClient({
    symbol: "SOLUSDT",
    price: 160.123456,
    open: 150,
    high: 165,
    low: 149,
    baseVolume: 10000,
    quoteVolume: 1601234.56,
    changePercent: 6.748,
    eventTime: 1717400000000
  });

  assert.deepEqual(formatted, {
    symbol: "SOLUSDT",
    price: 160.123456,
    open: 150,
    high: 165,
    low: 149,
    baseVolume: 10000,
    quoteVolume: 1601234.56,
    changePercent: 6.748,
    eventTime: 1717400000000,
    updatedAt: "2024-06-03T07:33:20.000Z"
  });
});
