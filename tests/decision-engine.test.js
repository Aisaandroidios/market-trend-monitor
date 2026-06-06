import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTradeIdea,
  fetchBinanceCandles,
  fetchBinanceCandlesConcurrent,
  fetchBinanceFutures24hStats,
  resetBinanceKlineBackoff,
  parseBinanceFutures24hTickers,
  parseBinanceKlines,
  rankSymbolsByDailyVolume
} from "../src/decision-engine.js";

test("parses Binance kline arrays into candles", () => {
  const candles = parseBinanceKlines([
    [1000, "10", "12", "9", "11", "100", 1999],
    [2000, "11", "13", "10", "12", "120", 2999]
  ]);

  assert.deepEqual(candles, [
    { openTime: 1000, open: 10, high: 12, low: 9, close: 11, volume: 100, closeTime: 1999 },
    { openTime: 2000, open: 11, high: 13, low: 10, close: 12, volume: 120, closeTime: 2999 }
  ]);
});

test("parses Binance futures 24h ticker stats", () => {
  const stats = parseBinanceFutures24hTickers([
    { symbol: "BTCUSDT", quoteVolume: "1000000", volume: "10", lastPrice: "61800.5", priceChangePercent: "-2.5" },
    { symbol: "MRVLUSDT", quoteVolume: "900000", volume: "3000", lastPrice: "312.75", priceChangePercent: "4.2" }
  ]);

  assert.deepEqual(stats, [
    { symbol: "BTCUSDT", quoteVolume: 1000000, volume: 10, lastPrice: 61800.5, priceChangePercent: -2.5 },
    { symbol: "MRVLUSDT", quoteVolume: 900000, volume: 3000, lastPrice: 312.75, priceChangePercent: 4.2 }
  ]);
});

test("ranks decision symbols by daily futures volume with fallback volume", () => {
  const ranked = rankSymbolsByDailyVolume({
    symbols: ["BTCUSDT", "ETHUSDT", "MRVLUSDT", "GOOGLUSDT", "XAUUSDT"],
    futuresStats: [
      { symbol: "ETHUSDT", quoteVolume: 5000 },
      { symbol: "MRVLUSDT", quoteVolume: 9000 },
      { symbol: "BTCUSDT", quoteVolume: 7000 }
    ],
    fallbackTickers: [
      { symbol: "GOOG", market: "stocks", quoteVolume: 6000 },
      { symbol: "XAUUSD", market: "commodities", quoteVolume: 8000 }
    ]
  });

  assert.deepEqual(ranked, ["MRVLUSDT", "XAUUSDT", "BTCUSDT", "GOOGLUSDT", "ETHUSDT"]);
});

test("fetches Binance futures 24h stats from backup base URLs", async () => {
  const calls = [];
  const stats = await fetchBinanceFutures24hStats({
    symbols: ["BTCUSDT", "MRVLUSDT"],
    binanceFuturesBaseUrls: ["https://bad-binance.test", "https://backup-binance.test"],
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.startsWith("https://bad-binance.test")) {
        return {
          ok: false,
          status: 503,
          async text() {
            return "unavailable";
          }
        };
      }

      return {
        ok: true,
        async json() {
          return [
            { symbol: "BTCUSDT", quoteVolume: "1000", volume: "2", priceChangePercent: "1" },
            { symbol: "ETHUSDT", quoteVolume: "800", volume: "4", priceChangePercent: "-1" },
            { symbol: "MRVLUSDT", quoteVolume: "1200", volume: "6", priceChangePercent: "2" }
          ];
        }
      };
    }
  });

  assert.deepEqual(calls, [
    "https://bad-binance.test/fapi/v1/ticker/24hr",
    "https://backup-binance.test/fapi/v1/ticker/24hr"
  ]);
  assert.deepEqual(stats.map((item) => item.symbol), ["BTCUSDT", "MRVLUSDT"]);
});

test("builds a long trade idea and waits when reward does not justify entry", () => {
  const candles = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index;
    return {
      openTime: index,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + index,
      closeTime: index
    };
  });

  const idea = buildTradeIdea({
    symbol: "BTCUSDT",
    market: "crypto",
    price: 179,
    candles,
    newsScore: 0.1,
    dataSource: {
      provider: "Binance USD-M Futures",
      exchange: "Binance",
      reference: "fapi/v1/klines",
      quoteSymbol: "BTCUSDT",
      interval: "1h"
    },
    generatedAt: 1780480000000
  });

  assert.equal(idea.direction, "LONG");
  assert.equal(idea.action, "WAIT");
  assert.ok(idea.winProbability >= 0.6);
  assert.ok(idea.takeProfit > idea.entry);
  assert.ok(idea.stopLoss < idea.entry);
  assert.ok(idea.riskReward < 1.15);
  assert.equal(idea.tradePlaybook.decision, "WAIT_FOR_BETTER_ENTRY");
  assert.equal(idea.support, 99);
  assert.equal(idea.resistance, 180);
  assert.deepEqual(idea.dataSource, {
    provider: "Binance USD-M Futures",
    exchange: "Binance",
    reference: "fapi/v1/klines",
    quoteSymbol: "BTCUSDT",
    interval: "1h"
  });
  assert.equal(idea.currentQuote, null);
});

test("estimates money flow from candles and 24h futures stats", () => {
  const candles = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index;
    return {
      openTime: index,
      open: close - 0.8,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + (index * 10),
      closeTime: index
    };
  });

  const idea = buildTradeIdea({
    symbol: "BTCUSDT",
    market: "futures",
    price: 179,
    candles,
    futuresStat: {
      quoteVolume: 123456789,
      priceChangePercent: 4.5
    },
    generatedAt: 1780480000000
  });

  assert.equal(idea.moneyFlow.biasDirection, "LONG");
  assert.equal(idea.moneyFlow.status, "inflow");
  assert.ok(idea.moneyFlow.netFlowPercent > 0);
  assert.equal(idea.moneyFlow.quoteVolume24h, 123456789);
  assert.equal(idea.moneyFlow.priceChange24h, 4.5);
  assert.ok(idea.moneyFlow.detail.includes("流入"));
});

test("adds a professional trade playbook to actionable ideas", () => {
  const candles = Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index;
    return {
      openTime: index,
      open: close - 0.6,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + (index * 20),
      closeTime: index
    };
  });

  const idea = buildTradeIdea({
    symbol: "BTCUSDT",
    market: "futures",
    price: 179,
    candles,
    newsScore: 0.1,
    generatedAt: 1780480000000
  });

  assert.ok(idea.tradePlaybook);
  assert.equal(idea.tradePlaybook.symbol, "BTCUSDT");
  assert.equal(idea.tradePlaybook.direction, idea.direction);
  assert.ok(["EXECUTE", "WATCH", "WAIT_FOR_BETTER_ENTRY"].includes(idea.tradePlaybook.decision));
  assert.ok(idea.tradePlaybook.checks.some((check) => check.name === "位置性价比"));
});

test("builds a short trade idea and waits when reward does not justify entry", () => {
  const candles = Array.from({ length: 80 }, (_, index) => {
    const close = 200 - index;
    return {
      openTime: index,
      open: close + 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + index,
      closeTime: index
    };
  });

  const idea = buildTradeIdea({
    symbol: "ETHUSDT",
    market: "crypto",
    price: 121,
    candles,
    newsScore: -0.1,
    generatedAt: 1780480000000
  });

  assert.equal(idea.direction, "SHORT");
  assert.equal(idea.action, "WAIT");
  assert.ok(idea.takeProfit < idea.entry);
  assert.ok(idea.stopLoss > idea.entry);
  assert.ok(idea.riskReward < 1.15);
  assert.equal(idea.tradePlaybook.decision, "WAIT_FOR_BETTER_ENTRY");
});

test("fetches Binance futures candles from USD-M endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      async json() {
        return [[1000, "10", "12", "9", "11", "100", 1999]];
      }
    };
  };

  const candles = await fetchBinanceCandles({
    symbol: "QQQUSDT",
    market: "futures",
    fetchImpl
  });

  assert.equal(calls[0], "https://fapi.binance.com/fapi/v1/klines?symbol=QQQUSDT&interval=1h&limit=120");
  assert.equal(candles[0].close, 11);
});

test("tries configured Binance futures base URLs before failing over", async () => {
  const calls = [];
  const candles = await fetchBinanceCandles({
    symbol: "BTCUSDT",
    market: "futures",
    binanceFuturesBaseUrls: ["https://bad-binance.test", "https://backup-binance.test"],
    dexFallback: false,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.startsWith("https://bad-binance.test")) {
        return {
          ok: false,
          status: 503,
          async text() {
            return "unavailable";
          }
        };
      }

      return {
        ok: true,
        async json() {
          return [[1000, "10", "12", "9", "11", "100", 1999]];
        }
      };
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0], "https://bad-binance.test/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=120");
  assert.equal(calls[1], "https://backup-binance.test/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=120");
  assert.equal(candles[0].close, 11);
});

test("falls back to Hyperliquid candles when Binance futures is unavailable", async () => {
  resetBinanceKlineBackoff();
  const calls = [];
  const candles = await fetchBinanceCandles({
    symbol: "BTCUSDT",
    market: "futures",
    binanceFuturesBaseUrls: ["https://bad-binance.test"],
    hyperliquidUrl: "https://hyperliquid.test/info",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith("https://bad-binance.test")) {
        return {
          ok: false,
          status: 418,
          async text() {
            return JSON.stringify({ msg: `Way too many requests; IP banned until ${Date.now() + 60000}.` });
          }
        };
      }

      return {
        ok: true,
        async json() {
          return [{ t: 1000, T: 1999, o: "10", h: "12", l: "9", c: "11", v: "100" }];
        }
      };
    }
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://hyperliquid.test/info");
  assert.equal(JSON.parse(calls[1].options.body).type, "candleSnapshot");
  assert.equal(candles[0].close, 11);
  resetBinanceKlineBackoff();
});

test("falls back to Hyperliquid xyz USDC tradfi candles", async () => {
  resetBinanceKlineBackoff();
  const calls = [];
  const candles = await fetchBinanceCandles({
    symbol: "NVDAUSDT",
    market: "futures",
    binanceFuturesBaseUrls: ["https://bad-binance.test"],
    hyperliquidUrl: "https://hyperliquid.test/info",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith("https://bad-binance.test")) {
        return {
          ok: false,
          status: 503,
          async text() {
            return "unavailable";
          }
        };
      }

      return {
        ok: true,
        async json() {
          return [{ t: 1000, T: 1999, o: "214", h: "216", l: "213", c: "215", v: "300" }];
        }
      };
    }
  });

  assert.equal(JSON.parse(calls[1].options.body).req.coin, "xyz:NVDA");
  assert.equal(candles[0].close, 215);
});

test("maps QQQ futures fallback to Hyperliquid xyz Nasdaq 100 market", async () => {
  resetBinanceKlineBackoff();
  const calls = [];
  await fetchBinanceCandles({
    symbol: "QQQUSDT",
    market: "futures",
    binanceFuturesBaseUrls: ["https://bad-binance.test"],
    hyperliquidUrl: "https://hyperliquid.test/info",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.startsWith("https://bad-binance.test")) {
        return {
          ok: false,
          status: 503,
          async text() {
            return "unavailable";
          }
        };
      }

      return {
        ok: true,
        async json() {
          return [{ t: 1000, T: 1999, o: "30000", h: "30100", l: "29900", c: "30050", v: "10" }];
        }
      };
    }
  });

  assert.equal(JSON.parse(calls[1].options.body).req.coin, "xyz:XYZ100");
});

test("maps added equity and commodity futures fallback to Hyperliquid xyz markets", async () => {
  resetBinanceKlineBackoff();
  const expectedCoins = new Map([
    ["MSFTUSDT", "xyz:MSFT"],
    ["GOOGLUSDT", "xyz:GOOGL"],
    ["BRENTOILUSDT", "xyz:BRENTOIL"],
    ["COINUSDT", "xyz:COIN"]
  ]);

  for (const [symbol, coin] of expectedCoins) {
    const calls = [];
    await fetchBinanceCandles({
      symbol,
      market: "futures",
      binanceFuturesBaseUrls: ["https://bad-binance.test"],
      hyperliquidUrl: "https://hyperliquid.test/info",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url.startsWith("https://bad-binance.test")) {
          return {
            ok: false,
            status: 503,
            async text() {
              return "unavailable";
            }
          };
        }

        return {
          ok: true,
          async json() {
            return [{ t: 1000, T: 1999, o: "100", h: "102", l: "99", c: "101", v: "50" }];
          }
        };
      }
    });

    assert.equal(JSON.parse(calls[1].options.body).req.coin, coin);
  }
});

test("reports Hyperliquid fallback as the candle data source", async () => {
  resetBinanceKlineBackoff();
  const [result] = await fetchBinanceCandlesConcurrent({
    symbols: ["MSFTUSDT"],
    market: "futures",
    binanceFuturesBaseUrls: ["https://bad-binance.test"],
    hyperliquidUrl: "https://hyperliquid.test/info",
    fetchImpl: async (url) => {
      if (url.startsWith("https://bad-binance.test")) {
        return {
          ok: false,
          status: 503,
          async text() {
            return "unavailable";
          }
        };
      }

      return {
        ok: true,
        async json() {
          return [{ t: 1000, T: 1999, o: "100", h: "102", l: "99", c: "101", v: "50" }];
        }
      };
    }
  });

  assert.deepEqual(result.dataSource, {
    provider: "Hyperliquid USDC Perps",
    exchange: "Hyperliquid",
    reference: "info/candleSnapshot",
    quoteSymbol: "xyz:MSFT",
    interval: "1h"
  });
});

test("fetches Binance candles concurrently with per-symbol results", async () => {
  const started = [];
  const results = await fetchBinanceCandlesConcurrent({
    symbols: ["BTCUSDT", "QQQUSDT"],
    market: "futures",
    concurrency: 2,
    fetchImpl: async (url) => {
      started.push(url);
      return {
        ok: true,
        async json() {
          return [[1000, "10", "12", "9", "11", "100", 1999]];
        }
      };
    }
  });

  assert.equal(started.length, 2);
  assert.deepEqual(results.map((item) => item.symbol), ["BTCUSDT", "QQQUSDT"]);
  assert.equal(results[1].candles[0].close, 11);
  assert.deepEqual(results[0].dataSource, {
    provider: "Binance USD-M Futures",
    exchange: "Binance",
    reference: "fapi/v1/klines",
    quoteSymbol: "BTCUSDT",
    interval: "1h"
  });
});

test("backs off Binance kline requests after a temporary IP ban", async () => {
  resetBinanceKlineBackoff();
  const calls = [];
  const bannedUntil = Date.now() + 60000;

  const first = await fetchBinanceCandlesConcurrent({
    symbols: ["BTCUSDT"],
    market: "futures",
    dexFallback: false,
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: false,
        status: 418,
        async text() {
          return JSON.stringify({
            code: -1003,
            msg: `Way too many requests; IP banned until ${bannedUntil}.`
          });
        }
      };
    }
  });

  const second = await fetchBinanceCandlesConcurrent({
    symbols: ["QQQUSDT"],
    market: "futures",
    dexFallback: false,
    fetchImpl: async (url) => {
      calls.push(url);
      throw new Error("should not request while backed off");
    }
  });

  assert.equal(calls.length, 1);
  assert.ok(first[0].error.includes("HTTP 418"));
  assert.ok(second[0].error.includes("backed off"));
  resetBinanceKlineBackoff();
});
