import assert from "node:assert/strict";
import test from "node:test";

import {
  averageTrueRange,
  exponentialMovingAverage,
  relativeStrengthIndex,
  supportResistance
} from "../src/indicators.js";

test("calculates exponential moving average series", () => {
  const ema = exponentialMovingAverage([10, 11, 12, 13, 14], 3);

  assert.deepEqual(ema.map((value) => Number(value.toFixed(4))), [10, 10.5, 11.25, 12.125, 13.0625]);
});

test("calculates RSI for a price series", () => {
  const prices = [44, 44.15, 43.9, 44.35, 44.8, 44.4, 44.9, 45.2, 45, 45.6, 45.9, 46.2, 46.1, 46.7, 47];
  const rsi = relativeStrengthIndex(prices, 14);

  assert.equal(Number(rsi.toFixed(2)), 80.61);
});

test("calculates ATR from candles", () => {
  const candles = [
    { high: 12, low: 10, close: 11 },
    { high: 13, low: 10.5, close: 12.5 },
    { high: 14, low: 12, close: 13.5 }
  ];

  assert.equal(averageTrueRange(candles, 3), 2.1666666666666665);
});

test("finds support and resistance from recent candles", () => {
  const levels = supportResistance([
    { high: 100, low: 90, close: 94 },
    { high: 105, low: 92, close: 101 },
    { high: 103, low: 91, close: 96 }
  ]);

  assert.deepEqual(levels, { support: 90, resistance: 105 });
});
