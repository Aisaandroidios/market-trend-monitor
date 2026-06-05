import assert from "node:assert/strict";
import test from "node:test";

import { buildModelGovernance } from "../src/model-governance.js";
import { buildPerformanceAttribution } from "../src/performance-attribution.js";
import { buildProbabilityCalibration } from "../src/probability-calibration.js";

const records = [
  {
    generatedAt: "2026-06-04T00:00:00Z",
    symbol: "BTCUSDT",
    direction: "SHORT",
    entry: 65000,
    takeProfit: 62000,
    stopLoss: 66500,
    winProbability: 0.6
  },
  {
    generatedAt: "2026-06-04T01:00:00Z",
    symbol: "BTCUSDT",
    direction: "SHORT",
    entry: 64500,
    takeProfit: 62000,
    stopLoss: 66500,
    winProbability: 0.59,
    previousSignalReview: {
      outcome: "RIGHT",
      previousDirection: "SHORT",
      previousGeneratedAt: "2026-06-04T00:00:00Z",
      hit: "MARK_TO_MARKET"
    }
  },
  {
    generatedAt: "2026-06-04T00:00:00Z",
    symbol: "ETHUSDT",
    direction: "LONG",
    entry: 1800,
    takeProfit: 1900,
    stopLoss: 1750,
    winProbability: 0.7
  },
  {
    generatedAt: "2026-06-04T01:00:00Z",
    symbol: "ETHUSDT",
    direction: "LONG",
    entry: 1910,
    takeProfit: 1950,
    stopLoss: 1840,
    winProbability: 0.66,
    previousSignalReview: {
      outcome: "RIGHT",
      previousDirection: "LONG",
      previousGeneratedAt: "2026-06-04T00:00:00Z",
      hit: "TAKE_PROFIT"
    }
  }
];

test("uses only take-profit and stop-loss reviews for win-rate calibration", () => {
  const calibration = buildProbabilityCalibration(records, {
    minTotalSamples: 1,
    minBucketSamples: 1,
    now: Date.UTC(2026, 5, 4, 2)
  });

  assert.equal(calibration.overall.samples, 1);
  assert.equal(calibration.overall.successes, 1);
  assert.deepEqual(calibration.symbols.map((row) => row.symbol), ["ETHUSDT"]);
});

test("keeps old mark-to-market reviews out of success and failure attribution", () => {
  const attribution = buildPerformanceAttribution({
    signalRecords: records,
    paperTrades: [],
    now: Date.UTC(2026, 5, 4, 2)
  });

  assert.equal(attribution.total.reviewed, 2);
  assert.equal(attribution.total.successes, 1);
  assert.equal(attribution.total.failures, 0);
  assert.equal(attribution.total.pending, 1);
});

test("model governance only treats planned exits as resolved samples", () => {
  const governance = buildModelGovernance({
    signalRecords: records,
    probabilityCalibration: null,
    providerStatus: {},
    now: Date.UTC(2026, 5, 4, 2)
  });

  assert.equal(governance.windows.last20.samples, 1);
  assert.equal(governance.windows.last20.successes, 1);
  assert.equal(governance.windows.last20.failures, 0);
});
