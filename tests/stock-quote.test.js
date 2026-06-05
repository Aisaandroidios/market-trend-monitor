import assert from "node:assert/strict";
import test from "node:test";

import { fetchFinnhubStockQuote, parseFinnhubStockQuote } from "../src/stock-quote.js";

test("parses Finnhub stock quote into a topic snapshot ticker", () => {
  const ticker = parseFinnhubStockQuote({
    symbol: "MCDUSDT",
    payload: {
      c: 273.29,
      d: -3.07,
      dp: -1.1109,
      t: 1780516800
    }
  });

  assert.deepEqual(ticker, {
    symbol: "MCD",
    sourceSymbol: "MCD.US",
    market: "stocks",
    provider: "finnhub",
    price: 273.29,
    open: 276.36,
    high: 0,
    low: 0,
    baseVolume: 0,
    quoteVolume: 0,
    changePercent: -1.1109,
    eventTime: 1780516800000
  });
});

test("fetches Finnhub stock quote for metadata-backed topic symbols", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      async json() {
        return { c: 47.42, d: -2.75, dp: -5.4814, t: 1780516800 };
      }
    };
  };

  const ticker = await fetchFinnhubStockQuote({
    symbol: "SMCIUSDT",
    apiKey: "key-123",
    fetchImpl
  });

  assert.equal(ticker.symbol, "SMCI");
  assert.equal(ticker.price, 47.42);
  assert.equal(ticker.provider, "finnhub");
  const url = new URL(calls[0]);
  assert.equal(url.pathname, "/api/v1/quote");
  assert.equal(url.searchParams.get("symbol"), "SMCI");
  assert.equal(url.searchParams.get("token"), "key-123");
});

test("skips Finnhub stock quote when config or metadata is missing", async () => {
  assert.equal(await fetchFinnhubStockQuote({ symbol: "MCDUSDT", apiKey: "" }), null);
  assert.equal(await fetchFinnhubStockQuote({ symbol: "BTCUSDT", apiKey: "key-123" }), null);
});
