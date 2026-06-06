import assert from "node:assert/strict";
import test from "node:test";

import { createPaperAccount } from "../src/paper-account.js";
import { positionRiskConfigFromEnv } from "../src/position-risk.js";

function memoryStore() {
  let state = null;
  const trades = [];
  return {
    loadPaperAccountState: () => state,
    savePaperAccountState: (nextState) => {
      state = JSON.parse(JSON.stringify(nextState));
    },
    appendPaperTrade: (trade) => {
      trades.push(trade);
    },
    info: () => ({ mode: "memory", trades: trades.length })
  };
}

function highEdgeIdea() {
  return {
    symbol: "ETHUSDT",
    direction: "LONG",
    action: "BUY",
    entry: 3000,
    price: 3000,
    takeProfit: 3240,
    stopLoss: 2910,
    riskReward: 2.67,
    convictionScore: 88,
    confidence: "HIGH",
    winProbability: 0.69,
    indicators: {
      atr: 80,
      volumeRatio: 1.35
    },
    moneyFlow: {
      quoteVolume24h: 30_000_000
    },
    tradePlaybook: {
      score: 0.84,
      grade: "A",
      decision: "EXECUTE"
    },
    dataSource: {
      provider: "Binance USD-M Futures"
    },
    currentQuote: {
      exchange: "Binance",
      source: "Binance USD-M Futures last",
      symbol: "ETHUSDT",
      price: 3000,
      realtime: true
    }
  };
}

function paperConfig() {
  return {
    enabled: true,
    accountPath: null,
    initialBalance: 10000,
    riskPerTrade: 0.02,
    maxNotionalPercent: 1,
    maxOpenPositions: 6,
    minConviction: 68,
    minRiskReward: 1.3,
    minConfidence: "MEDIUM",
    minPlaybookScore: 0.5,
    adaptiveThresholds: false,
    positionRisk: positionRiskConfigFromEnv({}),
    requireExecute: false,
    requireDataSource: true,
    feeRate: 0,
    slippageBps: 0,
    dataStore: memoryStore()
  };
}

test("paper account opens high edge ideas with the higher risk budget", () => {
  const account = createPaperAccount(paperConfig());
  const snapshot = account.processSignals({
    ideas: [highEdgeIdea()],
    now: Date.UTC(2026, 5, 5, 10)
  });

  assert.equal(snapshot.openPositionCount, 1);
  assert.equal(snapshot.openPositions[0].riskAmount, 200);
  assert.equal(snapshot.openPositions[0].riskFraction, 0.02);
  assert.equal(snapshot.openPositions[0].positionRisk.qualityTier, "HIGH_EDGE");
});
