import {
  averageTrueRange,
  exponentialMovingAverage,
  relativeStrengthIndex
} from "./indicators.js";

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeCandles(candles = []) {
  return candles
    .map((candle, index) => ({
      index,
      openTime: finite(candle.openTime, index),
      closeTime: finite(candle.closeTime, candle.openTime ?? index),
      open: finite(candle.open, candle.close),
      high: finite(candle.high, candle.close),
      low: finite(candle.low, candle.close),
      close: finite(candle.close),
      volume: finite(candle.volume, 0)
    }))
    .filter((candle) => candle.close > 0 && candle.high >= candle.low)
    .sort((left, right) => left.openTime - right.openTime);
}

function defaultParameterGrid() {
  const fastPeriods = [10, 20];
  const slowPeriods = [40, 60];
  const atrStops = [1.25, 1.65];
  const riskRewards = [1.35, 1.75];
  const rows = [];

  for (const fast of fastPeriods) {
    for (const slow of slowPeriods) {
      if (fast >= slow) continue;
      for (const atrStop of atrStops) {
        for (const riskReward of riskRewards) {
          rows.push({
            fast,
            slow,
            rsiLongMin: 44,
            rsiLongMax: 70,
            rsiShortMin: 30,
            rsiShortMax: 56,
            atrStop,
            riskReward,
            maxHoldBars: 18
          });
        }
      }
    }
  }

  return rows;
}

function signalDirection(candles, index, params) {
  const history = candles.slice(0, index + 1);
  const closes = history.map((candle) => candle.close);
  if (history.length < params.slow + 5) return "NEUTRAL";

  const fastSeries = exponentialMovingAverage(closes, params.fast);
  const slowSeries = exponentialMovingAverage(closes, params.slow);
  const fast = fastSeries.at(-1);
  const slow = slowSeries.at(-1);
  const previousFast = fastSeries.at(-4) ?? fast;
  const previousSlow = slowSeries.at(-4) ?? slow;
  const rsi = relativeStrengthIndex(closes, 14);

  if (fast > slow && fast >= previousFast && slow >= previousSlow && rsi >= params.rsiLongMin && rsi <= params.rsiLongMax) {
    return "LONG";
  }
  if (fast < slow && fast <= previousFast && slow <= previousSlow && rsi >= params.rsiShortMin && rsi <= params.rsiShortMax) {
    return "SHORT";
  }
  return "NEUTRAL";
}

function openTrade({ candles, index, params, direction }) {
  const entryCandle = candles[index + 1];
  const history = candles.slice(0, index + 1);
  const atr = Math.max(averageTrueRange(history, 14), entryCandle.close * 0.004);
  const entry = entryCandle.open || entryCandle.close;
  const stopDistance = Math.max(atr * params.atrStop, entry * 0.004);
  const targetDistance = stopDistance * params.riskReward;

  return {
    direction,
    entryIndex: index + 1,
    entryTime: entryCandle.openTime,
    entry,
    stopLoss: direction === "LONG" ? entry - stopDistance : entry + stopDistance,
    takeProfit: direction === "LONG" ? entry + targetDistance : entry - targetDistance,
    stopDistance,
    maxExitIndex: Math.min(candles.length - 1, index + 1 + params.maxHoldBars)
  };
}

function closeTrade({ trade, candle, index, reason }) {
  const exit = reason === "TAKE_PROFIT"
    ? trade.takeProfit
    : reason === "STOP_LOSS"
      ? trade.stopLoss
      : candle.close;
  const pnl = trade.direction === "LONG"
    ? exit - trade.entry
    : trade.entry - exit;
  const rMultiple = trade.stopDistance === 0 ? 0 : pnl / trade.stopDistance;

  return {
    direction: trade.direction,
    entryIndex: trade.entryIndex,
    exitIndex: index,
    entryTime: trade.entryTime,
    exitTime: candle.closeTime,
    entry: round(trade.entry, 8),
    exit: round(exit, 8),
    reason,
    rMultiple: round(rMultiple, 4),
    win: rMultiple > 0
  };
}

function maybeCloseTrade(trade, candle, index) {
  if (!trade) return null;

  if (trade.direction === "LONG") {
    const hitStop = candle.low <= trade.stopLoss;
    const hitTarget = candle.high >= trade.takeProfit;
    if (hitStop) return closeTrade({ trade, candle, index, reason: "STOP_LOSS" });
    if (hitTarget) return closeTrade({ trade, candle, index, reason: "TAKE_PROFIT" });
  }

  if (trade.direction === "SHORT") {
    const hitStop = candle.high >= trade.stopLoss;
    const hitTarget = candle.low <= trade.takeProfit;
    if (hitStop) return closeTrade({ trade, candle, index, reason: "STOP_LOSS" });
    if (hitTarget) return closeTrade({ trade, candle, index, reason: "TAKE_PROFIT" });
  }

  if (index >= trade.maxExitIndex) return closeTrade({ trade, candle, index, reason: "TIME_EXIT" });
  return null;
}

function equityDrawdown(trades) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    equity += trade.rMultiple;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  return maxDrawdown;
}

function metricsForTrades(trades = []) {
  const wins = trades.filter((trade) => trade.rMultiple > 0);
  const losses = trades.filter((trade) => trade.rMultiple < 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.rMultiple, 0));
  const totalR = trades.reduce((sum, trade) => sum + trade.rMultiple, 0);
  const tradeCount = trades.length;
  const winRate = tradeCount === 0 ? 0 : wins.length / tradeCount;
  const expectancyR = tradeCount === 0 ? 0 : totalR / tradeCount;
  const profitFactor = grossLoss === 0 ? (grossWin > 0 ? 99 : 0) : grossWin / grossLoss;

  return {
    trades: tradeCount,
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate * 100, 2),
    totalR: round(totalR, 3),
    expectancyR: round(expectancyR, 3),
    profitFactor: round(profitFactor, 3),
    maxDrawdownR: round(equityDrawdown(trades), 3),
    longTrades: trades.filter((trade) => trade.direction === "LONG").length,
    shortTrades: trades.filter((trade) => trade.direction === "SHORT").length,
    longR: round(trades.filter((trade) => trade.direction === "LONG").reduce((sum, trade) => sum + trade.rMultiple, 0), 3),
    shortR: round(trades.filter((trade) => trade.direction === "SHORT").reduce((sum, trade) => sum + trade.rMultiple, 0), 3)
  };
}

function objective(metrics) {
  if (metrics.trades < 2) return -999;
  const tradePenalty = metrics.trades < 4 ? 0.25 : 0;
  return metrics.expectancyR + ((metrics.winRate - 50) / 200) + Math.min(metrics.profitFactor, 3) * 0.08 - (metrics.maxDrawdownR * 0.08) - tradePenalty;
}

export function simulateStrategy({
  candles = [],
  params,
  directionFilter = "BOTH",
  startIndex = null
} = {}) {
  const normalized = normalizeCandles(candles);
  if (normalized.length < params.slow + 8) {
    return {
      trades: [],
      metrics: metricsForTrades([])
    };
  }

  const trades = [];
  let open = null;
  const firstSignalIndex = Math.max(params.slow + 5, startIndex ?? params.slow + 5);

  for (let index = firstSignalIndex; index < normalized.length - 1; index += 1) {
    if (open) {
      const closed = maybeCloseTrade(open, normalized[index], index);
      if (closed) {
        trades.push(closed);
        open = null;
      }
      continue;
    }

    const direction = signalDirection(normalized, index, params);
    if (direction === "NEUTRAL") continue;
    if (directionFilter !== "BOTH" && direction !== directionFilter) continue;
    open = openTrade({ candles: normalized, index, params, direction });
  }

  if (open) {
    trades.push(closeTrade({
      trade: open,
      candle: normalized.at(-1),
      index: normalized.length - 1,
      reason: "END_OF_WINDOW"
    }));
  }

  return {
    trades,
    metrics: metricsForTrades(trades)
  };
}

function chooseBestParams({ candles, grid, directionFilter }) {
  let best = null;

  for (const params of grid) {
    const result = simulateStrategy({ candles, params, directionFilter });
    const score = objective(result.metrics);
    if (!best || score > best.objective) {
      best = {
        params,
        objective: round(score, 4),
        metrics: result.metrics
      };
    }
  }

  return best;
}

function windowLabel(candles) {
  const start = candles.at(0)?.openTime;
  const end = candles.at(-1)?.closeTime;
  return {
    start: start ? new Date(start).toISOString() : null,
    end: end ? new Date(end).toISOString() : null
  };
}

function directionSupport(metrics) {
  if (metrics.longR > metrics.shortR && metrics.longR > 0) return "LONG";
  if (metrics.shortR > metrics.longR && metrics.shortR > 0) return "SHORT";
  return "NEUTRAL";
}

function validationScore(metrics, windows) {
  if (metrics.trades < 3 || windows === 0) return 0.5;
  const winScore = clamp((metrics.winRate - 42) / 28, 0, 1);
  const expectancyScore = clamp((metrics.expectancyR + 0.15) / 0.55, 0, 1);
  const pfScore = clamp((metrics.profitFactor - 0.85) / 1.4, 0, 1);
  const drawdownScore = clamp(1 - (metrics.maxDrawdownR / 4), 0, 1);

  return round((winScore * 0.28) + (expectancyScore * 0.34) + (pfScore * 0.23) + (drawdownScore * 0.15), 3);
}

function confidence(score, metrics) {
  if (metrics.trades < 4) return "LOW";
  if (score >= 0.72) return "HIGH";
  if (score >= 0.56) return "MEDIUM";
  return "LOW";
}

function warningsFor({ candles, windows, testMetrics, trainMetrics }) {
  const warnings = [];
  if (candles.length < 120) warnings.push("K线样本不足，walk-forward 只能低权重参考。");
  if (windows < 2) warnings.push("滚动窗口数量不足，可能对结构断裂不敏感。");
  if (testMetrics.trades < 4) warnings.push("未来窗口成交样本少，参数稳定性不足。");
  if (trainMetrics.expectancyR > 0 && testMetrics.expectancyR < 0) warnings.push("训练窗口为正、测试窗口为负，存在过拟合或结构切换风险。");
  if (testMetrics.maxDrawdownR >= 3) warnings.push("测试窗口最大回撤偏高。");
  return warnings;
}

export function runWalkForwardBacktest({
  symbol,
  candles = [],
  trainWindow = Number(process.env.WALK_FORWARD_TRAIN_WINDOW ?? 84),
  testWindow = Number(process.env.WALK_FORWARD_TEST_WINDOW ?? 24),
  step = Number(process.env.WALK_FORWARD_STEP_WINDOW ?? 24),
  directionFilter = "BOTH",
  enabled = process.env.WALK_FORWARD_ENABLED !== "false",
  grid = defaultParameterGrid()
} = {}) {
  if (!enabled) {
    return {
      enabled: false,
      symbol,
      status: "disabled",
      validationScore: 0.5,
      confidence: "LOW",
      supportDirection: "NEUTRAL",
      warnings: ["Walk-forward disabled"]
    };
  }

  const normalized = normalizeCandles(candles);
  if (normalized.length < trainWindow + Math.max(12, testWindow)) {
    return {
      enabled: true,
      symbol,
      status: "insufficient_data",
      candleCount: normalized.length,
      validationScore: 0.5,
      confidence: "LOW",
      supportDirection: "NEUTRAL",
      warnings: ["K线样本不足，walk-forward 暂按中性处理。"]
    };
  }

  const windows = [];
  const trainTrades = [];
  const testTrades = [];

  for (let start = 0; start + trainWindow + testWindow <= normalized.length; start += step) {
    const train = normalized.slice(start, start + trainWindow);
    const test = normalized.slice(start + trainWindow, start + trainWindow + testWindow);
    const best = chooseBestParams({ candles: train, grid, directionFilter });
    if (!best) continue;

    const warmup = train.slice(-Math.max(best.params.slow + 10, 70));
    const testInput = [...warmup, ...test];
    const testResult = simulateStrategy({
      candles: testInput,
      params: best.params,
      directionFilter,
      startIndex: Math.max(0, warmup.length - 1)
    });
    trainTrades.push(...simulateStrategy({ candles: train, params: best.params, directionFilter }).trades);
    testTrades.push(...testResult.trades);
    windows.push({
      train: windowLabel(train),
      test: windowLabel(test),
      params: best.params,
      trainMetrics: best.metrics,
      testMetrics: testResult.metrics,
      objective: best.objective
    });
  }

  const trainMetrics = metricsForTrades(trainTrades);
  const testMetrics = metricsForTrades(testTrades);
  const score = validationScore(testMetrics, windows.length);
  const supportDirection = directionSupport(testMetrics);
  const warnings = warningsFor({ candles: normalized, windows: windows.length, testMetrics, trainMetrics });
  const positiveWindows = windows.filter((window) => window.testMetrics.totalR > 0).length;

  return {
    enabled: true,
    symbol,
    status: "ok",
    candleCount: normalized.length,
    windows: windows.length,
    positiveWindows,
    positiveWindowRate: windows.length === 0 ? 0 : round((positiveWindows / windows.length) * 100, 2),
    validationScore: score,
    confidence: confidence(score, testMetrics),
    supportDirection,
    trainMetrics,
    testMetrics,
    selectedParams: windows.at(-1)?.params ?? null,
    biasControls: {
      lookAhead: "signal candle closes before next candle entry",
      walkForward: "parameters selected on train window and evaluated on later test window",
      survivorship: "uses current monitored universe; not a historical constituent universe"
    },
    warnings
  };
}

export function walkForwardScoreForDirection(walkForward, direction) {
  if (!walkForward?.enabled || walkForward.status !== "ok") return 0.5;
  if (!["LONG", "SHORT"].includes(direction)) return 0.5;
  if (walkForward.supportDirection === direction) return clamp(0.45 + (walkForward.validationScore * 0.55), 0, 1);
  if (walkForward.supportDirection === "NEUTRAL") return clamp(0.35 + (walkForward.validationScore * 0.25), 0.25, 0.65);
  return clamp(0.55 - (walkForward.validationScore * 0.45), 0.1, 0.55);
}
