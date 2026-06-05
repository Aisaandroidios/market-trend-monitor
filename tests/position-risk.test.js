import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatePositionRisk,
  positionRiskConfigFromEnv
} from "../src/position-risk.js";

function baseIdea(overrides = {}) {
  return {
    symbol: "ETHUSDT",
    direction: "LONG",
    entry: 3000,
    takeProfit: 3210,
    stopLoss: 2910,
    riskReward: 2.33,
    convictionScore: 78,
    confidence: "MEDIUM",
    winProbability: 0.62,
    indicators: {
      atr: 75,
      volumeRatio: 1.1
    },
    moneyFlow: {
      quoteVolume24h: 20_000_000
    },
    tradePlaybook: {
      score: 0.68,
      grade: "B",
      decision: "EXECUTE"
    },
    ...overrides
  };
}

function accountState(overrides = {}) {
  return {
    balance: 10000,
    equity: 10000,
    openPositions: [],
    closedTrades: [],
    ...overrides
  };
}

test("high edge setups can use the high quality paper risk cap", () => {
  const plan = evaluatePositionRisk({
    state: accountState(),
    stats: { periods: {} },
    config: {
      riskPerTrade: 0.02,
      positionRisk: positionRiskConfigFromEnv({})
    },
    idea: baseIdea({
      convictionScore: 88,
      confidence: "HIGH",
      winProbability: 0.69,
      riskReward: 2.8,
      indicators: {
        atr: 80,
        volumeRatio: 1.35
      },
      tradePlaybook: {
        score: 0.84,
        grade: "A",
        decision: "EXECUTE"
      }
    })
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.qualityTier, "HIGH_EDGE");
  assert.equal(plan.maxRiskFraction, 0.02);
  assert.equal(plan.riskFraction, 0.02);
  assert.equal(plan.riskAmount, 200);
});

test("ordinary setups stay below the normal paper risk cap", () => {
  const plan = evaluatePositionRisk({
    state: accountState(),
    stats: { periods: {} },
    config: {
      riskPerTrade: 0.02,
      positionRisk: positionRiskConfigFromEnv({})
    },
    idea: baseIdea()
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.qualityTier, "STANDARD");
  assert.ok(plan.riskFraction <= 0.01);
  assert.ok(plan.riskAmount <= 100);
});

test("high score does not raise size when liquidity is weak", () => {
  const plan = evaluatePositionRisk({
    state: accountState(),
    stats: { periods: {} },
    config: {
      riskPerTrade: 0.02,
      positionRisk: positionRiskConfigFromEnv({})
    },
    idea: baseIdea({
      convictionScore: 90,
      confidence: "HIGH",
      winProbability: 0.72,
      riskReward: 3.1,
      indicators: {
        atr: 70,
        volumeRatio: 0.5
      },
      moneyFlow: {
        quoteVolume24h: 1_000_000
      },
      tradePlaybook: {
        score: 0.9,
        grade: "A",
        decision: "EXECUTE"
      }
    })
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.qualityTier, "STANDARD");
  assert.ok(plan.riskFraction < 0.01);
  assert.ok(plan.warnings.some((warning) => warning.includes("流动性")));
});
