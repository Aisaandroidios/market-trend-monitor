import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendSignalMemory,
  buildStrategyFeedback,
  loadSignalMemory,
  reviewLatestSignalMemory,
  reviewPreviousSignal,
  summarizeSignalPerformance
} from "../src/signal-memory.js";

test("appends signal memory records for later strategy review", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "signal-memory-"));
  const filePath = path.join(dir, "history.jsonl");

  try {
    appendSignalMemory({
      filePath,
      idea: {
        symbol: "BTCUSDT",
        direction: "SHORT",
        action: "SELL",
        entry: 65000,
        takeProfit: 62000,
        stopLoss: 66500,
        convictionScore: 72,
        winProbability: 0.64,
        previousSignalReview: {
          label: "对",
          detail: "上次 SHORT 已触发止盈。"
        }
      },
      marketContext: {
        riskMode: "risk_off",
        longTermRegime: {
          regime: "bear",
          biasDirection: "SHORT"
        }
      },
      generatedAt: "2026-06-04T04:20:00.000Z"
    });

    const records = readFileSync(filePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, 1);
    assert.equal(records[0].symbol, "BTCUSDT");
    assert.equal(records[0].direction, "SHORT");
    assert.equal(records[0].longTermRegime.regime, "bear");
    assert.equal(records[0].previousSignalReview.label, "对");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loads signal memory records and skips malformed lines", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "signal-memory-"));
  const filePath = path.join(dir, "history.jsonl");

  try {
    writeFileSync(filePath, [
      JSON.stringify({ symbol: "BTCUSDT", direction: "SHORT" }),
      "not-json",
      JSON.stringify({ symbol: "ETHUSDT", direction: "LONG" })
    ].join("\n"));

    const records = loadSignalMemory({ filePath });
    assert.deepEqual(records.map((record) => record.symbol), ["BTCUSDT", "ETHUSDT"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stores contract and broad long-term regimes separately", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "signal-memory-"));
  const filePath = path.join(dir, "history.jsonl");

  try {
    appendSignalMemory({
      filePath,
      idea: {
        symbol: "ETHUSDT",
        direction: "SHORT",
        action: "SELL",
        entry: 1800,
        takeProfit: 1700,
        stopLoss: 1850,
        longTermRegime: {
          symbol: "ETHUSDT",
          regime: "bear",
          biasDirection: "SHORT"
        },
        modelBrain: {
          provider: "Open Quant Ensemble",
          score: 0.82,
          confidence: "HIGH"
        },
        modelSignal: {
          provider: "Qlib-LightGBM",
          direction: "SHORT",
          probability: 0.88
        }
      },
      marketContext: {
        riskMode: "risk_on",
        longTermRegime: {
          symbol: "BTCUSDT",
          regime: "bull",
          biasDirection: "LONG"
        }
      },
      generatedAt: "2026-06-04T04:20:00.000Z"
    });

    const [record] = readFileSync(filePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(record.longTermRegime.symbol, "ETHUSDT");
    assert.equal(record.contractLongTermRegime.symbol, "ETHUSDT");
    assert.equal(record.broadLongTermRegime.symbol, "BTCUSDT");
    assert.equal(record.modelBrain.score, 0.82);
    assert.equal(record.modelSignal.provider, "Qlib-LightGBM");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reviews a previous short signal as right when take profit is hit first", () => {
  const review = reviewPreviousSignal({
    previous: {
      generatedAt: "2026-06-04T00:00:00.000Z",
      symbol: "BTCUSDT",
      direction: "SHORT",
      entry: 65000,
      takeProfit: 62000,
      stopLoss: 66500
    },
    currentPrice: 61800,
    candles: [
      { openTime: Date.UTC(2026, 5, 4, 1), high: 65100, low: 63000, close: 64000 },
      { openTime: Date.UTC(2026, 5, 4, 2), high: 64000, low: 61900, close: 62100 }
    ]
  });

  assert.equal(review.label, "对");
  assert.equal(review.outcome, "RIGHT");
  assert.equal(review.hit, "TAKE_PROFIT");
  assert.equal(review.previousDirection, "SHORT");
});

test("reviews a previous long signal as wrong when stop loss is hit first", () => {
  const review = reviewPreviousSignal({
    previous: {
      generatedAt: "2026-06-04T00:00:00.000Z",
      symbol: "ETHUSDT",
      direction: "LONG",
      entry: 1800,
      takeProfit: 1900,
      stopLoss: 1750
    },
    currentPrice: 1740,
    candles: [
      { openTime: Date.UTC(2026, 5, 4, 1), high: 1820, low: 1760, close: 1790 },
      { openTime: Date.UTC(2026, 5, 4, 2), high: 1780, low: 1745, close: 1755 }
    ]
  });

  assert.equal(review.label, "错");
  assert.equal(review.outcome, "WRONG");
  assert.equal(review.hit, "STOP_LOSS");
});

test("reviews latest signal memory for the same symbol", () => {
  const records = [
    {
      generatedAt: "2026-06-04T00:00:00.000Z",
      symbol: "BTCUSDT",
      direction: "LONG",
      entry: 64000,
      takeProfit: 66000,
      stopLoss: 63000
    },
    {
      generatedAt: "2026-06-04T01:00:00.000Z",
      symbol: "ETHUSDT",
      direction: "SHORT",
      entry: 1800,
      takeProfit: 1700,
      stopLoss: 1850
    },
    {
      generatedAt: "2026-06-04T02:00:00.000Z",
      symbol: "BTCUSDT",
      direction: "SHORT",
      entry: 65000,
      takeProfit: 62000,
      stopLoss: 66500
    }
  ];

  const review = reviewLatestSignalMemory({
    records,
    symbol: "BTCUSDT",
    currentPrice: 64800,
    candles: []
  });

  assert.equal(review.previousDirection, "SHORT");
  assert.equal(review.previousEntry, 65000);
  assert.equal(review.label, "观察中");
  assert.equal(review.outcome, "PENDING");
  assert.equal(review.hit, "NONE");
});

test("keeps a signal pending until take profit or stop loss is touched", () => {
  const review = reviewPreviousSignal({
    previous: {
      generatedAt: "2026-06-04T00:00:00.000Z",
      symbol: "BTCUSDT",
      direction: "SHORT",
      entry: 65000,
      takeProfit: 62000,
      stopLoss: 66500
    },
    currentPrice: 64000,
    candles: [
      { openTime: Date.UTC(2026, 5, 4, 1), high: 65100, low: 63900, close: 64000 }
    ]
  });

  assert.equal(review.label, "观察中");
  assert.equal(review.outcome, "PENDING");
  assert.equal(review.hit, "NONE");
  assert.equal(review.detail, "尚未触发止盈/止损，继续观察，不计入胜负。");
});

test("summarizes cumulative strategy performance", () => {
  const stats = summarizeSignalPerformance([
    { symbol: "BTCUSDT", direction: "SHORT", entry: 65000, takeProfit: 62000, stopLoss: 66500 },
    {
      symbol: "ETHUSDT",
      direction: "LONG",
      entry: 1800,
      takeProfit: 1900,
      stopLoss: 1750,
      previousSignalReview: { outcome: "RIGHT", previousDirection: "SHORT", hit: "TAKE_PROFIT" }
    },
    {
      symbol: "SOLUSDT",
      direction: "SHORT",
      entry: 70,
      takeProfit: 65,
      stopLoss: 73,
      previousSignalReview: { outcome: "WRONG", previousDirection: "LONG", hit: "STOP_LOSS" }
    },
    {
      symbol: "XAUUSD",
      direction: "LONG",
      entry: 4400,
      takeProfit: 4500,
      stopLoss: 4350,
      previousSignalReview: { outcome: "PENDING", previousDirection: "LONG" }
    }
  ]);

  assert.equal(stats.totalSignals, 4);
  assert.equal(stats.reviewedSignals, 3);
  assert.equal(stats.successes, 1);
  assert.equal(stats.failures, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.successRate, 50);
  assert.deepEqual(stats.long, { reviewed: 2, successes: 0, failures: 1, pending: 1, successRate: 0 });
  assert.deepEqual(stats.short, { reviewed: 1, successes: 1, failures: 0, pending: 0, successRate: 100 });
});

test("summarizes daily weekly monthly and yearly performance in Beijing time", () => {
  const stats = summarizeSignalPerformance([
    {
      generatedAt: "2026-06-04T01:00:00Z",
      symbol: "BTCUSDT",
      direction: "SHORT",
      entry: 65000,
      takeProfit: 62000,
      stopLoss: 66500
    },
    {
      generatedAt: "2026-06-04T02:00:00Z",
      symbol: "ETHUSDT",
      direction: "LONG",
      entry: 1800,
      takeProfit: 1900,
      stopLoss: 1750,
      previousSignalReview: {
        outcome: "RIGHT",
        previousDirection: "SHORT",
        hit: "TAKE_PROFIT",
        previousGeneratedAt: "2026-06-04T01:00:00Z"
      }
    },
    {
      generatedAt: "2026-06-03T15:00:00Z",
      symbol: "SOLUSDT",
      direction: "SHORT",
      entry: 70,
      takeProfit: 65,
      stopLoss: 73,
      previousSignalReview: {
        outcome: "WRONG",
        previousDirection: "LONG",
        hit: "STOP_LOSS",
        previousGeneratedAt: "2026-06-03T15:00:00Z"
      }
    },
    {
      generatedAt: "2026-06-04T03:00:00Z",
      symbol: "XAUUSDT",
      direction: "LONG",
      entry: 4400,
      takeProfit: 4500,
      stopLoss: 4350,
      previousSignalReview: {
        outcome: "PENDING",
        previousDirection: "LONG",
        previousGeneratedAt: "2026-06-04T03:00:00Z"
      }
    },
    {
      generatedAt: "2026-05-31T10:00:00Z",
      symbol: "QQQUSDT",
      direction: "SHORT",
      entry: 500,
      takeProfit: 480,
      stopLoss: 510,
      previousSignalReview: {
        outcome: "RIGHT",
        previousDirection: "SHORT",
        hit: "TAKE_PROFIT",
        previousGeneratedAt: "2026-05-31T10:00:00Z"
      }
    }
  ], {
    now: new Date("2026-06-04T04:00:00Z")
  });

  assert.deepEqual(stats.periods.day, {
    totalSignals: 3,
    reviewedSignals: 2,
    successes: 1,
    failures: 0,
    pending: 1,
    successRate: 100,
    long: { reviewed: 1, successes: 0, failures: 0, pending: 1, successRate: 0 },
    short: { reviewed: 1, successes: 1, failures: 0, pending: 0, successRate: 100 }
  });
  assert.equal(stats.periods.week.totalSignals, 4);
  assert.equal(stats.periods.week.successes, 1);
  assert.equal(stats.periods.week.failures, 1);
  assert.equal(stats.periods.week.pending, 1);
  assert.equal(stats.periods.month.totalSignals, 4);
  assert.equal(stats.periods.year.totalSignals, 5);
  assert.equal(stats.periods.year.successes, 2);
  assert.equal(stats.periods.year.failures, 1);
  assert.equal(stats.periods.year.successRate, 66.67);
});

test("builds adaptive strategy feedback by symbol and direction", () => {
  const feedback = buildStrategyFeedback([
    {
      symbol: "BTCUSDT",
      previousSignalReview: { outcome: "RIGHT", previousDirection: "SHORT", hit: "TAKE_PROFIT" }
    },
    {
      symbol: "BTCUSDT",
      previousSignalReview: { outcome: "RIGHT", previousDirection: "SHORT", hit: "TAKE_PROFIT" }
    },
    {
      symbol: "BTCUSDT",
      previousSignalReview: { outcome: "WRONG", previousDirection: "SHORT", hit: "STOP_LOSS" }
    },
    {
      symbol: "ETHUSDT",
      previousSignalReview: { outcome: "WRONG", previousDirection: "SHORT", hit: "STOP_LOSS" }
    }
  ], {
    symbol: "BTCUSDT",
    direction: "SHORT"
  });

  assert.equal(feedback.symbol, "BTCUSDT");
  assert.equal(feedback.direction, "SHORT");
  assert.equal(feedback.sampleSize, 3);
  assert.equal(feedback.successes, 2);
  assert.equal(feedback.failures, 1);
  assert.equal(feedback.successRate, 66.67);
  assert.ok(feedback.score > 0.5);
  assert.ok(feedback.note.includes("BTCUSDT SHORT"));
});

test("penalizes a direction after consecutive reviewed failures", () => {
  const feedback = buildStrategyFeedback([
    {
      symbol: "QQQUSDT",
      previousSignalReview: { outcome: "RIGHT", previousDirection: "LONG", hit: "TAKE_PROFIT" }
    },
    {
      symbol: "QQQUSDT",
      previousSignalReview: { outcome: "WRONG", previousDirection: "LONG", hit: "STOP_LOSS" }
    },
    {
      symbol: "QQQUSDT",
      previousSignalReview: { outcome: "WRONG", previousDirection: "LONG", hit: "STOP_LOSS" }
    }
  ], {
    symbol: "QQQUSDT",
    direction: "LONG"
  });

  assert.equal(feedback.consecutiveFailures, 2);
  assert.ok(feedback.score <= 0.25);
  assert.ok(feedback.note.includes("连续错"));
});
