import assert from "node:assert/strict";
import test from "node:test";

import { createTickerStore } from "../src/market.js";
import {
  createHttpServer,
  displayLongTermRegimeForSymbol,
  nextPaperDailySummaryDelayMs,
  paperAccountTopicStateKey,
  probabilityCalibrationTopicStateKey,
  strategyAttributionTopicStateKey
} from "../src/server.js";

async function withServer(server, callback) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint reports service status", async () => {
  const store = createTickerStore();
  const server = createHttpServer({
    tickerStore: store,
    startMarketStream: false,
    startStooqPoller: false,
    startDecisionEngine: false,
    startTelegramCommands: false
  });

  await withServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.tickers, 0);
  });
});

test("health endpoint reports the market-aware decision schedule", async () => {
  const store = createTickerStore();
  const server = createHttpServer({
    tickerStore: store,
    startMarketStream: false,
    startStooqPoller: false,
    startDecisionEngine: false,
    startTelegramCommands: false,
    decisionNow: () => new Date("2026-06-04T14:00:00Z"),
    decisionScheduleConfig: {
      scheduleEnabled: true,
      fixedIntervalMs: 300000,
      intervals: {
        regular: 111000
      }
    },
    opportunityScanScheduleConfig: {
      scheduleEnabled: true,
      fixedIntervalMs: 300000,
      intervals: {
        regular: 300000
      }
    }
  });

  await withServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.decisionSchedule.session, "regular");
    assert.equal(body.decisionSchedule.label, "美股盘中");
    assert.equal(body.decisionSchedule.intervalMs, 111000);
    assert.equal(body.opportunityScanSchedule.session, "regular");
    assert.equal(body.opportunityScanSchedule.intervalMs, 300000);
  });
});

test("tickers endpoint returns current store snapshot", async () => {
  const store = createTickerStore();
  store.applyMiniTickerArray([
    { s: "BTCUSDT", c: "69000", o: "68000", h: "70000", l: "67000", v: "10", q: "690000", E: 2 }
  ]);

  const server = createHttpServer({
    tickerStore: store,
    startMarketStream: false,
    startStooqPoller: false,
    startDecisionEngine: false,
    startTelegramCommands: false
  });

  await withServer(server, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/tickers`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.tickers[0].symbol, "BTCUSDT");
  });
});

test("display long-term regime uses routed topic symbol and keeps source symbol", () => {
  const regime = displayLongTermRegimeForSymbol({
    sourceSymbol: "XAUUSDT",
    displaySymbol: "XAUUSD",
    regime: {
      symbol: "XAUUSDT",
      regime: "bull",
      biasDirection: "LONG",
      note: "XAUUSDT 日线处于牛市结构，回撤优先找多头性价比。"
    }
  });

  assert.equal(regime.symbol, "XAUUSD");
  assert.equal(regime.sourceSymbol, "XAUUSDT");
  assert.ok(regime.note.includes("XAUUSD 日线"));
  assert.equal(regime.note.includes("XAUUSDT 日线"), false);
});

test("paper account topic key changes only for position lifecycle state", () => {
  const openSnapshot = {
    enabled: true,
    openPositionCount: 1,
    openHistoryCount: 1,
    closedTradeCount: 0,
    openPositions: [
      {
        id: "PAPER-1",
        symbol: "ETHUSDT",
        direction: "LONG",
        currentPrice: 3040,
        unrealizedPnl: 120,
        takeProfit: 3180,
        stopLoss: 2940
      }
    ],
    recentOpenHistory: [
      {
        id: "PAPER-1",
        status: "OPEN"
      }
    ]
  };
  const markToMarketSnapshot = {
    ...openSnapshot,
    openPositions: [
      {
        ...openSnapshot.openPositions[0],
        currentPrice: 3090,
        unrealizedPnl: 270
      }
    ]
  };
  const closedSnapshot = {
    ...openSnapshot,
    openPositionCount: 0,
    closedTradeCount: 1,
    openPositions: [],
    recentOpenHistory: [
      {
        id: "PAPER-1",
        status: "CLOSED",
        closeReason: "TAKE_PROFIT"
      }
    ]
  };

  assert.equal(
    paperAccountTopicStateKey(openSnapshot),
    paperAccountTopicStateKey(markToMarketSnapshot)
  );
  assert.notEqual(
    paperAccountTopicStateKey(openSnapshot),
    paperAccountTopicStateKey(closedSnapshot)
  );
});

test("strategy attribution topic key changes only for attribution outcomes", () => {
  const baseAttribution = {
    generatedAt: "2026-06-05T09:00:00.000Z",
    total: {
      signals: 10,
      reviewed: 4,
      successes: 3,
      failures: 1,
      pending: 1,
      paperTrades: 2,
      paperWins: 1,
      paperLosses: 1,
      paperBreakeven: 0,
      netPnl: 20,
      score: 0.62,
      sampleScore: 0.45
    },
    strengths: [{ key: "ETHUSDT:SHORT", score: 0.8, sampleScore: 0.5 }],
    weaknesses: [{ key: "QQQUSDT:LONG", score: 0.3, sampleScore: 0.4 }],
    recommendations: ["优先保留强项: ETHUSDT:SHORT。"],
    policyHints: { boost: ["ETHUSDT:SHORT"], reduce: ["QQQUSDT:LONG"], avoidSymbols: [] }
  };
  const timestampOnly = {
    ...baseAttribution,
    generatedAt: "2026-06-05T09:05:00.000Z",
    total: {
      ...baseAttribution.total,
      signals: 11
    }
  };
  const reviewedChanged = {
    ...baseAttribution,
    total: {
      ...baseAttribution.total,
      reviewed: 5,
      successes: 4
    }
  };

  assert.equal(
    strategyAttributionTopicStateKey(baseAttribution),
    strategyAttributionTopicStateKey(timestampOnly)
  );
  assert.notEqual(
    strategyAttributionTopicStateKey(baseAttribution),
    strategyAttributionTopicStateKey(reviewedChanged)
  );
});

test("probability calibration topic key changes only for calibration outcomes", () => {
  const baseCalibration = {
    generatedAt: "2026-06-05T09:00:00.000Z",
    status: "ok",
    bucketSize: 5,
    overall: {
      samples: 18,
      successes: 11,
      failures: 7,
      predictedAvg: 65.4,
      realizedRate: 61.11,
      overconfidence: 4.29,
      expectedCalibrationError: 7.8,
      brierScore: 0.2123
    },
    buckets: [
      { key: "65-70", samples: 8, successes: 6, failures: 2, predictedAvg: 66.2, realizedRate: 75, calibrationError: 8.8, reliability: 0.47 }
    ],
    directions: {
      long: { samples: 7, successes: 3, failures: 4, realizedRate: 42.86 },
      short: { samples: 11, successes: 8, failures: 3, realizedRate: 72.73 }
    },
    symbols: [
      { symbol: "ETHUSDT", samples: 6, successes: 5, failures: 1, predictedAvg: 64, realizedRate: 83.33 }
    ]
  };
  const timestampOnly = {
    ...baseCalibration,
    generatedAt: "2026-06-05T09:05:00.000Z"
  };
  const outcomeChanged = {
    ...baseCalibration,
    overall: {
      ...baseCalibration.overall,
      successes: 12,
      realizedRate: 66.67
    }
  };

  assert.equal(
    probabilityCalibrationTopicStateKey(baseCalibration),
    probabilityCalibrationTopicStateKey(timestampOnly)
  );
  assert.notEqual(
    probabilityCalibrationTopicStateKey(baseCalibration),
    probabilityCalibrationTopicStateKey(outcomeChanged)
  );
});

test("paper daily summary scheduler targets the next Beijing morning slot", () => {
  const beforeSlot = nextPaperDailySummaryDelayMs({
    now: new Date("2026-06-05T00:00:00.000Z"),
    time: "08:30"
  });
  const afterSlot = nextPaperDailySummaryDelayMs({
    now: new Date("2026-06-05T01:00:00.000Z"),
    time: "08:30"
  });

  assert.equal(beforeSlot, 30 * 60 * 1000);
  assert.equal(afterSlot, (23 * 60 + 30) * 60 * 1000);
});
