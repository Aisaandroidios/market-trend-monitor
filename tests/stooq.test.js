import assert from "node:assert/strict";
import test from "node:test";

import { defaultWatchlist, parseStooqCsv, stooqSymbolToDisplay } from "../src/stooq.js";

function assertAlmostEqual(actual, expected, epsilon = 0.000001) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be close to ${expected}`);
}

test("parses Stooq CSV quote into normalized ticker", () => {
  const csv = [
    "Symbol,Date,Time,Open,High,Low,Close,Volume",
    "AAPL.US,2026-06-02,22:00:19,307.46,315.45,306.685,315.2,44534716"
  ].join("\n");

  const ticker = parseStooqCsv(csv, { market: "stocks", provider: "stooq" });

  assert.equal(ticker.symbol, "AAPL");
  assert.equal(ticker.sourceSymbol, "AAPL.US");
  assert.equal(ticker.market, "stocks");
  assert.equal(ticker.provider, "stooq");
  assert.equal(ticker.price, 315.2);
  assert.equal(ticker.open, 307.46);
  assert.equal(ticker.high, 315.45);
  assert.equal(ticker.low, 306.685);
  assert.equal(ticker.baseVolume, 44534716);
  assertAlmostEqual(ticker.quoteVolume, 14037342483.2, 0.01);
  assertAlmostEqual(ticker.changePercent, 2.517400637482211);
});

test("keeps spot and futures display symbols readable", () => {
  assert.equal(stooqSymbolToDisplay("SPY.US"), "SPY");
  assert.equal(stooqSymbolToDisplay("XAUUSD"), "XAUUSD");
  assert.equal(stooqSymbolToDisplay("CL.F"), "CL.F");
});

test("includes added stock topics in the quote watchlist", () => {
  const symbols = new Set(defaultWatchlist.map((item) => item.symbol));

  assert.ok(symbols.has("MCD.US"));
  assert.ok(symbols.has("SMCI.US"));
  assert.ok(symbols.has("IBM.US"));
  assert.ok(symbols.has("DELL.US"));
  assert.ok(symbols.has("NOW.US"));
});
