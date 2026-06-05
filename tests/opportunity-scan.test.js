import assert from "node:assert/strict";
import test from "node:test";

import {
  opportunityScanIntervalForUsMarketSession,
  opportunityScanScheduleConfigFromEnv,
  selectOpportunityAlerts
} from "../src/opportunity-scan.js";

const actionableIdea = {
  symbol: "BTCUSDT",
  market: "futures",
  direction: "LONG",
  action: "BUY",
  entry: 100,
  takeProfit: 114,
  stopLoss: 94,
  riskReward: 2.33,
  winProbability: 0.67,
  support: 92,
  resistance: 118,
  indicators: {
    ema20: 104,
    ema60: 98,
    rsi: 55,
    macdHistogram: 2.2,
    atr: 3,
    volumeRatio: 1.4,
    newsScore: 0.15
  },
  moneyFlow: {
    biasDirection: "LONG",
    status: "inflow"
  },
  tradePlaybook: {
    score: 0.9,
    grade: "A",
    decision: "EXECUTE",
    summary: "执行质量 A，允许按计划执行。"
  },
  strategyFeedback: {
    score: 0.8,
    sampleSize: 5,
    successRate: 80,
    note: "BTCUSDT LONG 历史复盘 4/5。"
  },
  longTermRegime: {
    symbol: "BTCUSDT",
    regime: "bull",
    biasDirection: "LONG"
  },
  reason: "EMA20 above EMA60; RSI 55; MACD histogram 2.2"
};

test("uses one-quarter opportunity scan intervals during active market sessions", () => {
  const config = opportunityScanScheduleConfigFromEnv({
    fixedIntervalMs: 600000,
    env: {}
  });
  const regular = opportunityScanIntervalForUsMarketSession({
    now: new Date("2026-06-04T14:00:00Z"),
    ...config
  });
  const offHours = opportunityScanIntervalForUsMarketSession({
    now: new Date("2026-06-05T04:30:00Z"),
    ...config
  });

  assert.equal(regular.session, "regular");
  assert.equal(regular.intervalMs, 225000);
  assert.equal(offHours.session, "off_hours");
  assert.equal(offHours.intervalMs, 3600000);
});

test("aligns one-quarter scans without rounding them to whole minutes", () => {
  const config = opportunityScanScheduleConfigFromEnv({
    fixedIntervalMs: 600000,
    env: {}
  });
  const regular = opportunityScanIntervalForUsMarketSession({
    now: new Date("2026-06-04T14:00:10Z"),
    ...config
  });

  assert.equal(regular.intervalMs, 225000);
  assert.equal(regular.delayMs, 215000);
  assert.equal(regular.nextRunAt, "2026-06-04T14:03:45.000Z");
});

test("keeps explicit opportunity scan interval overrides", () => {
  const config = opportunityScanScheduleConfigFromEnv({
    fixedIntervalMs: 600000,
    env: {
      OPPORTUNITY_SCAN_REGULAR_INTERVAL_MS: "120000",
      OPPORTUNITY_SCAN_OFF_HOURS_INTERVAL_MS: "1800000"
    }
  });
  const regular = opportunityScanIntervalForUsMarketSession({
    now: new Date("2026-06-04T14:00:00Z"),
    ...config
  });
  const offHours = opportunityScanIntervalForUsMarketSession({
    now: new Date("2026-06-05T04:30:00Z"),
    ...config
  });

  assert.equal(regular.intervalMs, 120000);
  assert.equal(offHours.intervalMs, 1800000);
});

test("selects only changed or high-conviction opportunities and respects cooldown", () => {
  const nowMs = Date.UTC(2026, 5, 4, 14, 0, 0);
  const first = selectOpportunityAlerts({
    tradeIdeas: [actionableIdea],
    marketContext: {
      riskMode: "risk_on",
      btcDirection: "LONG",
      longTermRegime: {
        symbol: "BTCUSDT",
        regime: "bull",
        biasDirection: "LONG"
      }
    },
    lastAlerts: new Map(),
    nowMs,
    cooldownMs: 1800000
  });

  assert.equal(first.length, 1);
  assert.equal(first[0].idea.symbol, "BTCUSDT");
  assert.ok(first[0].reasons.includes("新高置信机会"));

  const repeated = selectOpportunityAlerts({
    tradeIdeas: [actionableIdea],
    marketContext: first[0].idea.marketContext,
    lastAlerts: new Map([[
      "BTCUSDT",
      {
        stateKey: first[0].stateKey,
        direction: "LONG",
        confidence: first[0].idea.confidence,
        convictionScore: first[0].idea.convictionScore,
        sentAt: nowMs
      }
    ]]),
    nowMs: nowMs + 600000,
    cooldownMs: 1800000
  });

  assert.equal(repeated.length, 0);
});
