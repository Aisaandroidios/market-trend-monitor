import assert from "node:assert/strict";
import test from "node:test";

import { createSignalEngine } from "../src/signals.js";

test("detects strong gainers and near-high trends", () => {
  const engine = createSignalEngine({ now: () => 1000, cooldownMs: 60000 });
  const signals = engine.evaluate([
    {
      symbol: "SOLUSDT",
      market: "crypto",
      provider: "binance",
      price: 100,
      high: 100.2,
      low: 90,
      changePercent: 6,
      eventTime: 1000
    }
  ]);

  assert.deepEqual(
    signals.map((signal) => signal.type),
    ["strong_gainer", "near_high"]
  );
  assert.equal(signals[0].symbol, "SOLUSDT");
  assert.equal(signals[0].severity, "positive");
});

test("dedupes repeated signals inside the cooldown window", () => {
  const engine = createSignalEngine({ now: () => 1000, cooldownMs: 60000 });
  const ticker = {
    symbol: "BTCUSDT",
    market: "crypto",
    provider: "binance",
    price: 90,
    high: 110,
    low: 89.9,
    changePercent: -6,
    eventTime: 1000
  };

  assert.equal(engine.evaluate([ticker]).length, 2);
  assert.equal(engine.evaluate([ticker]).length, 0);
});
