import assert from "node:assert/strict";
import test from "node:test";

import {
  activeCryptoSymbols,
  activeMarketSnapshot,
  isActionableCryptoSymbol
} from "../src/active-market.js";

test("filters out stablecoin swap symbols from active crypto universe", () => {
  assert.equal(isActionableCryptoSymbol("BTCUSDT"), true);
  assert.equal(isActionableCryptoSymbol("ETHUSDT"), true);
  assert.equal(isActionableCryptoSymbol("USDCUSDT"), false);
  assert.equal(isActionableCryptoSymbol("FDUSDUSDT"), false);
  assert.equal(isActionableCryptoSymbol("USD1USDT"), false);
});

test("selects top crypto symbols by quote volume", () => {
  const symbols = activeCryptoSymbols([
    { symbol: "USDCUSDT", market: "crypto", quoteVolume: 1000000 },
    { symbol: "SOLUSDT", market: "crypto", quoteVolume: 900000 },
    { symbol: "BTCUSDT", market: "crypto", quoteVolume: 800000 },
    { symbol: "DOGEUSDT", market: "crypto", quoteVolume: 700000 }
  ], { limit: 2 });

  assert.deepEqual(symbols, ["SOLUSDT", "BTCUSDT"]);
});

test("builds active market snapshot across crypto stocks and commodities", () => {
  const snapshot = activeMarketSnapshot({
    tickers: [
      { symbol: "BTCUSDT", market: "crypto", quoteVolume: 800000 },
      { symbol: "SOLUSDT", market: "crypto", quoteVolume: 900000 }
    ],
    stocks: [
      { symbol: "QQQ", market: "stocks", quoteVolume: 300000 },
      { symbol: "NVDA", market: "stocks", quoteVolume: 500000 }
    ],
    commodities: [
      { symbol: "XAUUSD", market: "commodities", quoteVolume: 0 },
      { symbol: "USO", market: "commodities", quoteVolume: 200000 }
    ],
    cryptoLimit: 1,
    stockLimit: 1,
    commodityLimit: 1
  });

  assert.deepEqual(snapshot.crypto.map((item) => item.symbol), ["SOLUSDT"]);
  assert.deepEqual(snapshot.stocks.map((item) => item.symbol), ["NVDA"]);
  assert.deepEqual(snapshot.commodities.map((item) => item.symbol), ["USO"]);
});
