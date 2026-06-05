import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBestSignal,
  buildMarketReversalSignal,
  inferLongTermRegime,
  inferSymbolLongTermRegime,
  scoreTradeIdea
} from "../src/conviction.js";

const longIdea = {
  symbol: "BTCUSDT",
  market: "crypto",
  direction: "LONG",
  action: "BUY",
  entry: 100,
  takeProfit: 114,
  stopLoss: 94,
  riskReward: 2.33,
  winProbability: 0.64,
  support: 92,
  resistance: 118,
  indicators: {
    ema20: 103,
    ema60: 98,
    rsi: 58,
    macdHistogram: 2.4,
    atr: 3,
    volumeRatio: 1.4,
    newsScore: 0.25
  },
  reason: "EMA20 above EMA60; RSI 58; MACD histogram 2.4; news score 0.25"
};

const shortIdea = {
  symbol: "ETHUSDT",
  market: "crypto",
  direction: "SHORT",
  action: "SELL",
  entry: 100,
  takeProfit: 95,
  stopLoss: 106,
  riskReward: 0.83,
  winProbability: 0.52,
  support: 94,
  resistance: 112,
  indicators: {
    ema20: 97,
    ema60: 102,
    rsi: 44,
    macdHistogram: -1.1,
    atr: 4,
    volumeRatio: 0.8,
    newsScore: -0.1
  },
  reason: "EMA20 below EMA60; RSI 44; MACD histogram -1.1; news score -0.1"
};

test("scores a trade idea with factor attribution", () => {
  const scored = scoreTradeIdea(longIdea, {
    marketContext: { riskMode: "risk_on", btcDirection: "LONG", goldDirection: "NEUTRAL" }
  });

  assert.equal(scored.symbol, "BTCUSDT");
  assert.equal(scored.direction, "LONG");
  assert.ok(scored.convictionScore > 60);
  assert.ok(scored.factors.some((factor) => factor.name === "technical_trend"));
  assert.ok(scored.factors.some((factor) => factor.name === "money_flow"));
  assert.ok(scored.supporting.length > 0);
  assert.ok(Array.isArray(scored.risks));
});

test("builds the best signal from ranked ideas", () => {
  const best = buildBestSignal({
    tradeIdeas: [shortIdea, longIdea],
    marketContext: { riskMode: "risk_on", btcDirection: "LONG", goldDirection: "NEUTRAL" },
    generatedAt: 1780480000000
  });

  assert.equal(best.symbol, "BTCUSDT");
  assert.equal(best.direction, "LONG");
  assert.equal(best.action, "BUY");
  assert.equal(best.rank, 1);
  assert.equal(best.alternatives.length, 1);
  assert.ok(best.summary.includes("BTCUSDT"));
});

test("returns a wait signal when no idea has enough conviction", () => {
  const best = buildBestSignal({
    tradeIdeas: [{ ...shortIdea, winProbability: 0.45, riskReward: 0.6 }],
    marketContext: { riskMode: "mixed", btcDirection: "NEUTRAL", goldDirection: "NEUTRAL" },
    minimumConviction: 65,
    generatedAt: 1780480000000
  });

  assert.equal(best.symbol, "MARKET");
  assert.equal(best.direction, "WAIT");
  assert.equal(best.action, "WAIT");
});

function dailyCandlesFromCloses(closes) {
  return closes.map((close, index) => ({
    openTime: index * 86400000,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000 + index,
    closeTime: (index * 86400000) + 86399999
  }));
}

test("infers BTC long-term bear regime from daily trend structure", () => {
  const closes = Array.from({ length: 240 }, (_, index) => 100000 - (index * 150));
  const regime = inferLongTermRegime({
    btcDailyCandles: dailyCandlesFromCloses(closes)
  });

  assert.equal(regime.regime, "bear");
  assert.equal(regime.riskMode, "risk_off");
  assert.equal(regime.biasDirection, "SHORT");
  assert.ok(regime.note.includes("熊市"));
});

test("infers symbol-specific long-term regime without BTC wording", () => {
  const closes = Array.from({ length: 240 }, (_, index) => 5000 - (index * 8));
  const regime = inferSymbolLongTermRegime({
    symbol: "ETHUSDT",
    dailyCandles: dailyCandlesFromCloses(closes)
  });

  assert.equal(regime.symbol, "ETHUSDT");
  assert.equal(regime.regime, "bear");
  assert.equal(regime.biasDirection, "SHORT");
  assert.ok(regime.note.includes("ETHUSDT 日线"));
  assert.equal(regime.note.includes("BTC 日线"), false);
});

test("uses the contract long-term regime before the broad BTC context", () => {
  const ethBearRegime = {
    symbol: "ETHUSDT",
    regime: "bear",
    riskMode: "risk_off",
    biasDirection: "SHORT",
    note: "ETHUSDT 日线处于熊市结构，反弹优先找空头性价比。"
  };
  const broadBtcBullContext = {
    riskMode: "risk_on",
    btcDirection: "LONG",
    longTermRegime: {
      symbol: "BTCUSDT",
      regime: "bull",
      riskMode: "risk_on",
      biasDirection: "LONG",
      note: "BTCUSDT 日线处于牛市结构，回撤优先找多头性价比。"
    }
  };

  const long = scoreTradeIdea({
    ...longIdea,
    symbol: "ETHUSDT",
    market: "futures",
    longTermRegime: ethBearRegime
  }, { marketContext: broadBtcBullContext });
  const short = scoreTradeIdea({
    ...shortIdea,
    symbol: "ETHUSDT",
    market: "futures",
    riskReward: 2.33,
    winProbability: 0.64,
    indicators: {
      ...shortIdea.indicators,
      volumeRatio: 1.4
    },
    longTermRegime: ethBearRegime
  }, { marketContext: broadBtcBullContext });

  const regimeFactor = short.factors.find((item) => item.name === "market_regime");

  assert.ok(short.convictionScore > long.convictionScore);
  assert.ok(regimeFactor.note.includes("ETHUSDT 长期熊市结构"));
  assert.equal(regimeFactor.note.includes("BTC 长期牛市"), false);
  assert.ok(long.risks.some((item) => item.includes("ETHUSDT 长期熊市结构")));
});

test("does not force the broad BTC regime onto another contract", () => {
  const marketContext = {
    riskMode: "risk_off",
    btcDirection: "SHORT",
    longTermRegime: {
      regime: "bear",
      riskMode: "risk_off",
      biasDirection: "SHORT",
      note: "BTC 长期熊市结构，反弹优先看空。"
    }
  };

  const long = scoreTradeIdea({ ...longIdea, symbol: "ETHUSDT", market: "futures" }, { marketContext });
  const short = scoreTradeIdea({
    ...shortIdea,
    riskReward: 2.33,
    winProbability: 0.64,
    indicators: {
      ...shortIdea.indicators,
      volumeRatio: 1.4
    }
  }, { marketContext });

  const longRegime = long.factors.find((item) => item.name === "market_regime");
  const shortRegime = short.factors.find((item) => item.name === "market_regime");

  assert.equal(longRegime.note.includes("BTC"), false);
  assert.equal(shortRegime.note.includes("BTC"), false);
  assert.ok(longRegime.note.includes("ETHUSDT 长期趋势数据不足"));
  assert.ok(shortRegime.note.includes("ETHUSDT 长期趋势数据不足"));
});

test("uses adaptive strategy feedback to reward or penalize repeated outcomes", () => {
  const marketContext = { riskMode: "risk_on", btcDirection: "LONG", goldDirection: "NEUTRAL" };
  const rewarded = scoreTradeIdea({
    ...longIdea,
    strategyFeedback: {
      score: 0.9,
      sampleSize: 6,
      successRate: 83.33,
      adjustment: 4,
      note: "BTCUSDT LONG 历史复盘 5/6，成功率 83.33%，策略反馈加 4 分。"
    }
  }, { marketContext });
  const penalized = scoreTradeIdea({
    ...longIdea,
    strategyFeedback: {
      score: 0.2,
      sampleSize: 4,
      successRate: 25,
      adjustment: -3,
      note: "BTCUSDT LONG 历史复盘 1/4，连续错 2 次，策略反馈降 3 分。"
    }
  }, { marketContext });

  assert.ok(rewarded.convictionScore > penalized.convictionScore);
  assert.ok(rewarded.factors.some((factor) => factor.name === "adaptive_feedback"));
  assert.ok(penalized.risks.some((risk) => risk.includes("连续错")));
});

test("uses professional execution quality in conviction scoring", () => {
  const marketContext = { riskMode: "risk_on", btcDirection: "LONG", goldDirection: "NEUTRAL" };
  const executable = scoreTradeIdea({
    ...longIdea,
    tradePlaybook: {
      score: 0.9,
      grade: "A",
      decision: "EXECUTE",
      summary: "执行质量 A，允许按计划执行。"
    }
  }, { marketContext });
  const chase = scoreTradeIdea({
    ...longIdea,
    tradePlaybook: {
      score: 0.25,
      grade: "D",
      decision: "WAIT_FOR_BETTER_ENTRY",
      summary: "执行质量 D，等待更好入场。"
    }
  }, { marketContext });

  assert.ok(executable.convictionScore > chase.convictionScore);
  assert.ok(executable.factors.some((factor) => factor.name === "execution_quality"));
  assert.ok(chase.risks.some((risk) => risk.includes("执行质量 D")));
});

test("builds a market reversal signal when broad market bias flips", () => {
  const reversal = buildMarketReversalSignal({
    previousContext: {
      riskMode: "risk_on",
      btcDirection: "LONG",
      longTermRegime: { regime: "bull", biasDirection: "LONG" }
    },
    marketContext: {
      riskMode: "risk_off",
      btcDirection: "SHORT",
      longTermRegime: { regime: "bear", biasDirection: "SHORT" }
    },
    bestSignal: { symbol: "BTCUSDT", direction: "SHORT", convictionScore: 78, confidence: "MEDIUM" },
    generatedAt: 1780480000000
  });

  assert.equal(reversal.symbol, "MARKET");
  assert.equal(reversal.direction, "SHORT");
  assert.equal(reversal.action, "RISK_OFF");
  assert.equal(reversal.previousBias, "LONG");
  assert.equal(reversal.currentBias, "SHORT");
  assert.ok(reversal.summary.includes("大盘信号反转"));
});

test("does not build a market reversal signal when broad market bias is unchanged", () => {
  const reversal = buildMarketReversalSignal({
    previousContext: { riskMode: "risk_off", btcDirection: "SHORT" },
    marketContext: { riskMode: "risk_off", btcDirection: "SHORT" },
    bestSignal: { symbol: "ETHUSDT", direction: "SHORT" }
  });

  assert.equal(reversal, null);
});
