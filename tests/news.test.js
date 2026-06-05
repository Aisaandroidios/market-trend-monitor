import assert from "node:assert/strict";
import test from "node:test";

import { extractAlphaVantageSentiment, getNewsInsight, getNewsScore } from "../src/news.js";

test("returns neutral news score when no news API keys are configured", async () => {
  const score = await getNewsScore({
    symbol: "BTCUSDT",
    env: {},
    fetchImpl: async () => {
      throw new Error("should not fetch without keys");
    }
  });

  assert.equal(score, 0);
});

test("extracts average Alpha Vantage sentiment for matching feed items", () => {
  const score = extractAlphaVantageSentiment({
    feed: [
      { overall_sentiment_score: "0.2" },
      { overall_sentiment_score: "-0.1" },
      { overall_sentiment_score: "0.5" }
    ]
  });

  assert.equal(Number(score.toFixed(4)), 0.2);
});

test("uses Alpha Vantage news sentiment when configured", async () => {
  const calls = [];
  const score = await getNewsScore({
    symbol: "AAPL",
    env: { ALPHA_VANTAGE_API_KEY: "demo-key" },
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            feed: [
              { overall_sentiment_score: "0.3" },
              { overall_sentiment_score: "0.1" }
            ]
          };
        }
      };
    }
  });

  assert.equal(score, 0.2);
  assert.ok(calls[0].includes("function=NEWS_SENTIMENT"));
  assert.ok(calls[0].includes("tickers=AAPL"));
});

test("uses Alpha Vantage crypto ticker namespace for Binance crypto symbols", async () => {
  const calls = [];
  await getNewsScore({
    symbol: "BTCUSDT",
    env: { ALPHA_VANTAGE_API_KEY: "demo-key" },
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return { feed: [{ overall_sentiment_score: "0.2" }] };
        }
      };
    }
  });

  assert.ok(calls[0].includes("tickers=CRYPTO%3ABTC"));
});

test("falls back to Finnhub when Alpha Vantage is unavailable", async () => {
  const calls = [];
  const score = await getNewsScore({
    symbol: "AAPLUSDT",
    env: {
      ALPHA_VANTAGE_API_KEY: "alpha-key",
      FINNHUB_API_KEY: "finnhub-key"
    },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("alphavantage")) {
        return {
          ok: false,
          async json() {
            return {};
          }
        };
      }

      return {
        ok: true,
        async json() {
          return { sentiment: { bullishPercent: 0.7, bearishPercent: 0.2 } };
        }
      };
    }
  });

  assert.equal(score, 0.5);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("symbol=AAPL"));
});

test("falls back to Finnhub when Alpha Vantage returns a limit notice", async () => {
  const calls = [];
  const insight = await getNewsInsight({
    symbol: "AAPLUSDT",
    env: {
      ALPHA_VANTAGE_API_KEY: "alpha-key",
      FINNHUB_API_KEY: "finnhub-key",
      NEWS_CACHE_TTL_MS: "0"
    },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("alphavantage")) {
        return {
          ok: true,
          async json() {
            return { Information: "API rate limit reached" };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return { sentiment: { bullishPercent: 0.62, bearishPercent: 0.22 } };
        }
      };
    }
  });

  assert.equal(insight.score, 0.4);
  assert.equal(insight.source, "Finnhub");
  assert.equal(insight.status, "scored");
  assert.equal(calls.length, 2);
});

test("reports configured news providers as unavailable when all providers fail", async () => {
  const insight = await getNewsInsight({
    symbol: "QQQUSDT",
    env: {
      ALPHA_VANTAGE_API_KEY: "alpha-key",
      FINNHUB_API_KEY: "finnhub-key",
      NEWS_CACHE_TTL_MS: "0"
    },
    fetchImpl: async (url) => ({
      ok: url.includes("alphavantage"),
      status: url.includes("finnhub") ? 403 : 200,
      async json() {
        return url.includes("alphavantage")
          ? { Information: "API rate limit reached" }
          : { error: "Forbidden" };
      }
    })
  });

  assert.equal(insight.score, 0);
  assert.equal(insight.status, "unavailable");
  assert.equal(insight.detail, "不可用按中性");
});

test("returns neutral score when a news provider times out", async () => {
  const start = Date.now();
  const score = await getNewsScore({
    symbol: "ETHUSDT",
    env: {
      ALPHA_VANTAGE_API_KEY: "alpha-key",
      NEWS_TIMEOUT_MS: "5",
      NEWS_CACHE_TTL_MS: "0"
    },
    fetchImpl: async () => new Promise(() => {})
  });

  assert.equal(score, 0);
  assert.ok(Date.now() - start < 250);
});

test("caches news scores to protect free API quotas", async () => {
  let calls = 0;
  const env = {
    ALPHA_VANTAGE_API_KEY: "alpha-key",
    NEWS_CACHE_TTL_MS: "60000"
  };

  const first = await getNewsScore({
    symbol: "NVDAUSDT",
    env,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return { feed: [{ overall_sentiment_score: "0.4" }] };
        }
      };
    }
  });

  const second = await getNewsScore({
    symbol: "NVDAUSDT",
    env,
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return { feed: [{ overall_sentiment_score: "-0.4" }] };
        }
      };
    }
  });

  assert.equal(first, 0.4);
  assert.equal(second, 0.4);
  assert.equal(calls, 1);
});
