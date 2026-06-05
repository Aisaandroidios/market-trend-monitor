import assert from "node:assert/strict";
import test from "node:test";

import { decisionSymbolsFromTopicMap, filterTickersByTopicMap, topicSymbolsFromMap } from "../src/topic-filter.js";

test("extracts normalized topic symbols from map", () => {
  assert.deepEqual(topicSymbolsFromMap({ BTCUSDT: 3, QQQUSDT: 5, XAUUSD: 13 }), new Set(["BTCUSDT", "QQQUSDT", "XAUUSD"]));
});

test("filters tickers to configured topic symbols only", () => {
  const tickers = [
    { symbol: "BTCUSDT", market: "crypto" },
    { symbol: "DOGEUSDT", market: "crypto" },
    { symbol: "QQQ", market: "stocks" },
    { symbol: "XAUUSD", market: "commodities" }
  ];

  const filtered = filterTickersByTopicMap(tickers, {
    BTCUSDT: 3,
    QQQUSDT: 5,
    XAUUSD: 13
  });

  assert.deepEqual(filtered.map((ticker) => ticker.symbol), ["BTCUSDT", "QQQ", "XAUUSD"]);
});

test("derives supported crypto decision symbols from topic map", () => {
  const symbols = decisionSymbolsFromTopicMap(
    { BTCUSDT: 3, ETHUSDT: 4, QQQUSDT: 5, XAUUSD: 13 },
    ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
  );

  assert.deepEqual(symbols, ["BTCUSDT", "ETHUSDT"]);
});
