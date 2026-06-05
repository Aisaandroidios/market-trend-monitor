import assert from "node:assert/strict";
import test from "node:test";

import {
  loadExternalModelSignals,
  scoreOpenSourceModelBrain
} from "../src/model-brain.js";

const shortIdea = {
  symbol: "ETHUSDT",
  market: "futures",
  direction: "SHORT",
  action: "SELL",
  entry: 1800,
  takeProfit: 1700,
  stopLoss: 1850,
  riskReward: 2,
  winProbability: 0.66,
  support: 1680,
  resistance: 1920,
  indicators: {
    ema20: 1760,
    ema60: 1900,
    rsi: 42,
    macdHistogram: -3.5,
    atr: 34,
    volumeRatio: 1.35,
    newsScore: -0.2
  },
  moneyFlow: {
    biasDirection: "SHORT",
    status: "outflow"
  },
  tradePlaybook: {
    score: 0.86,
    grade: "A",
    decision: "EXECUTE"
  },
  strategyFeedback: {
    score: 0.78,
    sampleSize: 8,
    successRate: 75
  },
  longTermRegime: {
    symbol: "ETHUSDT",
    regime: "bear",
    biasDirection: "SHORT"
  },
  reason: "EMA20 below EMA60; RSI 42; MACD histogram -3.5"
};

test("scores an actionable idea with the open-source model brain ensemble", () => {
  const brain = scoreOpenSourceModelBrain(shortIdea, {
    marketContext: {
      riskMode: "risk_off",
      longTermRegime: {
        symbol: "BTCUSDT",
        regime: "bear",
        biasDirection: "SHORT"
      }
    }
  });

  assert.equal(brain.provider, "Open Quant Ensemble");
  assert.equal(brain.biasDirection, "SHORT");
  assert.ok(brain.score >= 0.7);
  assert.ok(brain.models.includes("Qlib-compatible regime model"));
  assert.ok(brain.models.includes("LightGBM-compatible tabular model"));
  assert.ok(brain.note.includes("开源模型大脑"));
});

test("external Qlib or LightGBM signal can override the ensemble confidence", () => {
  const brain = scoreOpenSourceModelBrain({
    ...shortIdea,
    modelSignal: {
      provider: "Qlib-LightGBM",
      direction: "SHORT",
      probability: 0.91,
      reason: "external model agrees with short setup"
    }
  });

  assert.ok(brain.score > 0.8);
  assert.equal(brain.external.provider, "Qlib-LightGBM");
  assert.ok(brain.note.includes("Qlib-LightGBM"));
});

test("loads external model signals from JSON content", () => {
  const signals = loadExternalModelSignals({
    raw: JSON.stringify({
      signals: [
        { symbol: "BTCUSDT", provider: "Qlib", direction: "LONG", probability: 0.72 },
        { symbol: "ETH USDT", provider: "LightGBM", direction: "SHORT", probability: 0.68 }
      ]
    })
  });

  assert.equal(signals.get("BTCUSDT").provider, "Qlib");
  assert.equal(signals.get("ETHUSDT").direction, "SHORT");
});
