import { movingAverage } from "./indicators.js";
import { scoreOpenSourceModelBrain } from "./model-brain.js";
import { walkForwardScoreForDirection } from "./walk-forward.js";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function factor(name, score, weight, note) {
  return {
    name,
    score: round(clamp(score, 0, 1), 3),
    weight,
    contribution: round(clamp(score, 0, 1) * weight, 2),
    note
  };
}

function directionAlignment(idea) {
  const contractLongTerm = idea.longTermRegime;
  if (contractLongTerm?.biasDirection && contractLongTerm.biasDirection !== "NEUTRAL") {
    if (contractLongTerm.biasDirection === idea.direction) return contractLongTerm.regime === "transition" ? 0.75 : 1;
    return contractLongTerm.regime === "transition" ? 0.35 : 0.2;
  }

  return 0.5;
}

function marketRegimeNote(idea) {
  const contractLongTerm = idea.longTermRegime;
  if (contractLongTerm?.biasDirection && contractLongTerm.biasDirection !== "NEUTRAL") {
    const symbol = contractLongTerm.symbol ?? idea.symbol ?? "当前合约";
    const aligned = contractLongTerm.biasDirection === idea.direction;

    if (contractLongTerm.regime === "bear") {
      return aligned
        ? `${symbol} 长期熊市结构，做空方向顺合约大势`
        : `${symbol} 长期熊市结构，做多属于逆合约大势反弹单`;
    }

    if (contractLongTerm.regime === "bull") {
      return aligned
        ? `${symbol} 长期牛市结构，做多方向顺合约大势`
        : `${symbol} 长期牛市结构，做空属于逆合约大势回撤单`;
    }

    return aligned
      ? `${symbol} 长期过渡结构，方向与合约当前主偏向一致`
      : `${symbol} 长期过渡结构，方向与合约当前主偏向相反`;
  }

  return `${idea.symbol ?? "当前合约"} 长期趋势数据不足，按中性处理`;
}

function technicalTrendScore(idea) {
  const indicators = idea.indicators ?? {};
  let score = 0;

  if (idea.direction === "LONG") {
    if (indicators.ema20 > indicators.ema60) score += 0.35;
    if (indicators.macdHistogram > 0) score += 0.25;
    if (indicators.rsi >= 45 && indicators.rsi <= 70) score += 0.25;
    if (indicators.volumeRatio >= 1) score += 0.15;
  } else if (idea.direction === "SHORT") {
    if (indicators.ema20 < indicators.ema60) score += 0.35;
    if (indicators.macdHistogram < 0) score += 0.25;
    if (indicators.rsi >= 30 && indicators.rsi <= 55) score += 0.25;
    if (indicators.volumeRatio >= 1) score += 0.15;
  }

  return score;
}

function riskRewardScore(idea) {
  return clamp((idea.riskReward - 0.8) / 2.2, 0, 1);
}

function probabilityScore(idea) {
  return clamp((idea.winProbability - 0.45) / 0.3, 0, 1);
}

function probabilityNote(idea) {
  const calibrated = Number(idea.winProbability ?? 0);
  const raw = Number(idea.rawWinProbability ?? idea.winProbability ?? 0);
  const calibration = idea.probabilityCalibration;
  if (calibration?.status === "ok") {
    return `校准胜率 ${(calibrated * 100).toFixed(0)}%，原始 ${(raw * 100).toFixed(0)}%，分桶真实胜率 ${calibration.realizedRate}%`;
  }
  return `胜率估算 ${(calibrated * 100).toFixed(0)}%`;
}

function levelRoomScore(idea) {
  const rewardRoom = Math.abs(idea.takeProfit - idea.entry);
  const stopRoom = Math.abs(idea.entry - idea.stopLoss);
  const resistanceRoom = Math.abs((idea.resistance ?? idea.takeProfit) - idea.entry);
  const supportRoom = Math.abs(idea.entry - (idea.support ?? idea.stopLoss));
  const directionalRoom = idea.direction === "LONG" ? resistanceRoom : supportRoom;

  if (rewardRoom === 0 || stopRoom === 0) return 0;
  return clamp((directionalRoom / rewardRoom) * 0.7 + (rewardRoom / stopRoom) * 0.15, 0, 1);
}

function newsScore(idea) {
  const score = idea.indicators?.newsScore ?? 0;
  if (idea.direction === "LONG") return clamp((score + 1) / 2, 0, 1);
  if (idea.direction === "SHORT") return clamp((1 - score) / 2, 0, 1);
  return 0.5;
}

function newsFactorNote(idea) {
  const score = idea.indicators?.newsScore ?? 0;
  if (Math.abs(score) < 0.05) return "新闻面接近中性，未给方向加成";

  const bias = score > 0 ? "偏多" : "偏空";
  const aligned = (score > 0 && idea.direction === "LONG") || (score < 0 && idea.direction === "SHORT");
  return aligned
    ? `新闻面${bias}，与${idea.direction}方向一致`
    : `新闻面${bias}，与${idea.direction}方向相反`;
}

function moneyFlowScore(idea) {
  const moneyFlow = idea.moneyFlow;
  if (!moneyFlow?.biasDirection || moneyFlow.biasDirection === "NEUTRAL") return 0.5;
  if (moneyFlow.biasDirection === idea.direction) return 1;
  return 0.2;
}

function moneyFlowNote(idea) {
  const moneyFlow = idea.moneyFlow;
  if (!moneyFlow) return "资金流向未记录，按中性处理";

  const bias = moneyFlow.biasDirection === "LONG"
    ? "偏流入"
    : moneyFlow.biasDirection === "SHORT"
      ? "偏流出"
      : "中性";
  const aligned = moneyFlow.biasDirection === idea.direction;
  if (moneyFlow.biasDirection === "NEUTRAL") return `资金流向${bias}，未给方向加成`;
  return aligned
    ? `资金流向${bias}，与${idea.direction}方向一致`
    : `资金流向${bias}，与${idea.direction}方向相反`;
}

function derivativesScore(idea) {
  const derivatives = idea.derivatives;
  if (!derivatives?.ok || !derivatives.biasDirection || derivatives.biasDirection === "NEUTRAL") return 0.5;
  if (derivatives.biasDirection === idea.direction) return 1;
  return 0.2;
}

function derivativesNote(idea) {
  const derivatives = idea.derivatives;
  if (!derivatives) return "衍生品/盘口数据未返回，按中性处理";
  if (!derivatives.ok) return `衍生品/盘口数据不可用: ${derivatives.reason ?? derivatives.error ?? "unknown"}`;
  const aligned = derivatives.biasDirection === idea.direction;
  if (derivatives.biasDirection === "NEUTRAL") return `衍生品/盘口中性，${derivatives.detail}`;
  return aligned
    ? `衍生品/盘口偏 ${derivatives.biasDirection}，与当前方向一致；${derivatives.detail}`
    : `衍生品/盘口偏 ${derivatives.biasDirection}，与当前方向相反；${derivatives.detail}`;
}

function volatilityScore(idea) {
  const atr = idea.indicators?.atr ?? 0;
  if (!idea.entry || !atr) return 0.5;
  const atrPercent = atr / idea.entry;
  return clamp(1 - ((atrPercent - 0.01) / 0.08), 0.2, 1);
}

function adaptiveFeedbackScore(idea) {
  return clamp(idea.strategyFeedback?.score ?? 0.5, 0, 1);
}

function adaptiveFeedbackNote(idea) {
  return idea.strategyFeedback?.note ?? "历史策略反馈样本不足，按中性处理";
}

function executionQualityScore(idea) {
  return clamp(idea.tradePlaybook?.score ?? 0.5, 0, 1);
}

function executionQualityNote(idea) {
  const playbook = idea.tradePlaybook;
  if (!playbook) return "交易员执行检查未生成，按中性处理";
  return `${playbook.summary} 执行质量 ${playbook.grade}，决策 ${playbook.decision}。`;
}

function modelBrainFactor(idea, marketContext) {
  const brain = scoreOpenSourceModelBrain(idea, { marketContext });
  return {
    brain,
    factor: factor("open_source_model_brain", brain.score, 7, brain.note)
  };
}

function walkForwardFactor(idea) {
  const validation = idea.walkForward;
  if (!validation) {
    return factor("walk_forward_validation", 0.5, 7, "Walk-forward 样本未生成，按中性处理");
  }

  const score = walkForwardScoreForDirection(validation, idea.direction);
  const metrics = validation.testMetrics ?? {};
  const support = validation.supportDirection ?? "NEUTRAL";
  const note = validation.status === "ok"
    ? `Walk-forward 测试支持 ${support}，测试胜率 ${metrics.winRate ?? 0}%，期望R ${metrics.expectancyR ?? 0}，窗口 ${validation.positiveWindows ?? 0}/${validation.windows ?? 0}`
    : validation.warnings?.[0] ?? "Walk-forward 数据不足，按中性处理";

  return factor("walk_forward_validation", score, 7, note);
}

function supportingAndRisks(idea, factors) {
  const supporting = factors
    .filter((item) => item.score >= 0.65)
    .map((item) => item.note);
  const risks = factors
    .filter((item) => item.score < 0.5)
    .map((item) => item.note);

  if (idea.winProbability < 0.6) risks.push("胜率估算没有达到高置信区间");
  if (idea.probabilityCalibration?.adjustmentPercent < -3) {
    risks.push(`胜率校准下调 ${Math.abs(idea.probabilityCalibration.adjustmentPercent)}%，原始概率偏乐观`);
  }
  if ((idea.indicators?.newsScore ?? 0) === 0) {
    risks.push(idea.news?.detail ?? "新闻情绪未配置或当前为中性");
  }
  if (idea.riskReward < 1.5) risks.push("风险收益比偏低");
  if (idea.action === "WAIT") risks.push("交易动作仍为 WAIT，说明当前只是观察方向，不是立即开单。");
  if (idea.walkForward?.warnings?.length) risks.push(idea.walkForward.warnings[0]);
  if (idea.walkForward?.status === "ok" && idea.walkForward.supportDirection !== "NEUTRAL" && idea.walkForward.supportDirection !== idea.direction) {
    risks.push(`Walk-forward 未来窗口更支持 ${idea.walkForward.supportDirection}，与当前 ${idea.direction} 相反`);
  }
  if (idea.derivatives?.ok && idea.derivatives.biasDirection !== "NEUTRAL" && idea.derivatives.biasDirection !== idea.direction) {
    risks.push(`衍生品/盘口偏 ${idea.derivatives.biasDirection}，与当前 ${idea.direction} 相反`);
  }
  if (idea.eventRisk?.status === "block") risks.push(`事件风险 BLOCK: ${idea.eventRisk.detail}`);
  if (idea.eventRisk?.status === "reduce") risks.push(`事件风险 REDUCE: ${idea.eventRisk.detail}`);

  return { supporting, risks };
}

export function scoreTradeIdea(idea, { marketContext = {} } = {}) {
  if (!idea || idea.direction === "NEUTRAL") {
    return null;
  }

  const modelBrain = modelBrainFactor(idea, marketContext);
  const factors = [
    factor("win_probability", probabilityScore(idea), 12, probabilityNote(idea)),
    factor("risk_reward", riskRewardScore(idea), 9, `风险收益比 ${idea.riskReward}`),
    factor("technical_trend", technicalTrendScore(idea), 11, idea.reason),
    factor("support_resistance_room", levelRoomScore(idea), 7, `支撑 ${idea.support} / 压力 ${idea.resistance}`),
    factor("news_sentiment", newsScore(idea), 5, newsFactorNote(idea)),
    factor("money_flow", moneyFlowScore(idea), 6, moneyFlowNote(idea)),
    factor("volatility_control", volatilityScore(idea), 5, `ATR ${idea.indicators?.atr ?? "--"}`),
    factor("market_regime", directionAlignment(idea), 8, marketRegimeNote(idea)),
    factor("adaptive_feedback", adaptiveFeedbackScore(idea), 8, adaptiveFeedbackNote(idea)),
    factor("execution_quality", executionQualityScore(idea), 8, executionQualityNote(idea)),
    modelBrain.factor,
    walkForwardFactor(idea),
    factor("derivatives_positioning", derivativesScore(idea), 7, derivativesNote(idea))
  ];

  const convictionScore = round(factors.reduce((sum, item) => sum + item.contribution, 0), 2);
  const { supporting, risks } = supportingAndRisks(idea, factors);

  return {
    ...idea,
    rank: null,
    convictionScore,
    confidence: convictionScore >= 82 ? "HIGH" : convictionScore >= 68 ? "MEDIUM" : "LOW",
    factors,
    modelBrain: modelBrain.brain,
    supporting,
    risks
  };
}

function roundPrice(value) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 1000) return Number(value.toFixed(2));
  if (value >= 1) return Number(value.toFixed(4));
  return Number(value.toFixed(8));
}

export function inferSymbolLongTermRegime({ symbol = "BTCUSDT", dailyCandles = [] } = {}) {
  const normalizedSymbol = String(symbol || "BTCUSDT").toUpperCase();
  if (dailyCandles.length < 200) {
    return {
      symbol: normalizedSymbol,
      regime: "unknown",
      riskMode: "mixed",
      ...(normalizedSymbol === "BTCUSDT" ? { btcDirection: "NEUTRAL" } : {}),
      biasDirection: "NEUTRAL",
      note: `${normalizedSymbol} 日线历史不足，长期趋势暂不参与加权。`
    };
  }

  const closes = dailyCandles.map((candle) => candle.close);
  const price = closes.at(-1);
  const sma50 = movingAverage(closes, 50);
  const sma200 = movingAverage(closes, 200);
  const previousSma50 = movingAverage(closes.slice(0, -20), 50);
  const high180 = Math.max(...dailyCandles.slice(-180).map((candle) => candle.high));
  const drawdownFromHigh = high180 === 0 ? 0 : (price - high180) / high180;
  const sma50SlopePercent = previousSma50 === 0 ? 0 : (sma50 - previousSma50) / previousSma50;

  const bear = price < sma200 && sma50 < sma200 && sma50SlopePercent < 0 && drawdownFromHigh <= -0.12;
  const bull = price > sma200 && sma50 > sma200 && sma50SlopePercent > 0 && drawdownFromHigh > -0.12;
  const regime = bear ? "bear" : bull ? "bull" : "transition";
  const biasDirection = regime === "bear" ? "SHORT" : regime === "bull" ? "LONG" : price >= sma200 ? "LONG" : "SHORT";
  const riskMode = regime === "bear" ? "risk_off" : regime === "bull" ? "risk_on" : "mixed";
  const note = regime === "bear"
    ? `${normalizedSymbol} 日线处于熊市结构：价格低于 200 日均线，50 日均线低于 200 日均线且斜率向下，反弹优先找空头性价比。`
    : regime === "bull"
      ? `${normalizedSymbol} 日线处于牛市结构：价格站上 200 日均线，50 日均线高于 200 日均线且斜率向上，回撤优先找多头性价比。`
      : `${normalizedSymbol} 日线处于过渡结构：长期趋势没有单边确认，降低追单权重。`;

  return {
    symbol: normalizedSymbol,
    regime,
    riskMode,
    ...(normalizedSymbol === "BTCUSDT" ? { btcDirection: biasDirection } : {}),
    biasDirection,
    price: roundPrice(price),
    sma50: roundPrice(sma50),
    sma200: roundPrice(sma200),
    drawdownFromHigh: Number(drawdownFromHigh.toFixed(4)),
    sma50SlopePercent: Number(sma50SlopePercent.toFixed(4)),
    note
  };
}

export function inferLongTermRegime({ btcDailyCandles = [] } = {}) {
  return inferSymbolLongTermRegime({
    symbol: "BTCUSDT",
    dailyCandles: btcDailyCandles
  });
}

export function inferMarketContext({ tradeIdeas = [], commodities = [], longTermRegime = null } = {}) {
  const btc = tradeIdeas.find((idea) => idea.symbol === "BTCUSDT");
  const gold = commodities.find((ticker) => ticker.symbol === "XAUUSD" || ticker.symbol === "GLD");
  const oil = commodities.find((ticker) => ticker.symbol === "CL.F" || ticker.symbol === "USO");

  const btcDirection = longTermRegime?.btcDirection ?? btc?.direction ?? "NEUTRAL";
  const goldDirection = (gold?.changePercent ?? 0) > 0.5 ? "LONG" : (gold?.changePercent ?? 0) < -0.5 ? "SHORT" : "NEUTRAL";
  const oilDirection = (oil?.changePercent ?? 0) > 0.5 ? "LONG" : (oil?.changePercent ?? 0) < -0.5 ? "SHORT" : "NEUTRAL";
  const riskMode = longTermRegime?.riskMode ?? (btcDirection === "LONG" && goldDirection !== "LONG"
    ? "risk_on"
    : btcDirection === "SHORT" && goldDirection === "LONG"
      ? "risk_off"
      : "mixed");

  return { riskMode, btcDirection, goldDirection, oilDirection, longTermRegime };
}

function broadMarketBias(context = {}) {
  const longTermBias = context.longTermRegime?.biasDirection;
  if (["LONG", "SHORT"].includes(longTermBias)) return longTermBias;
  if (["LONG", "SHORT"].includes(context.btcDirection)) return context.btcDirection;
  if (context.riskMode === "risk_on") return "LONG";
  if (context.riskMode === "risk_off") return "SHORT";
  return "NEUTRAL";
}

function broadMarketKey(context = {}) {
  return [
    context.riskMode ?? "unknown",
    broadMarketBias(context),
    context.longTermRegime?.regime ?? "unknown"
  ].join(":");
}

function marketActionForBias(bias) {
  if (bias === "LONG") return "RISK_ON";
  if (bias === "SHORT") return "RISK_OFF";
  return "WAIT";
}

export function buildMarketReversalSignal({
  previousContext = null,
  marketContext = null,
  bestSignal = null,
  generatedAt = Date.now()
} = {}) {
  if (!previousContext || !marketContext) return null;

  const previousBias = broadMarketBias(previousContext);
  const currentBias = broadMarketBias(marketContext);
  const previousKey = broadMarketKey(previousContext);
  const currentKey = broadMarketKey(marketContext);
  const flipped = previousBias !== "NEUTRAL"
    && currentBias !== "NEUTRAL"
    && previousBias !== currentBias;

  if (!flipped || previousKey === currentKey) return null;

  const regime = marketContext.longTermRegime?.regime ?? "unknown";
  const bestText = bestSignal?.symbol && bestSignal.symbol !== "MARKET"
    ? `当前最高置信标的 ${bestSignal.symbol} ${bestSignal.direction}，综合分 ${bestSignal.convictionScore ?? "--"}。`
    : "当前没有单标的高置信方向，大盘先按环境反转处理。";

  return {
    id: `market-reversal:${previousKey}->${currentKey}:${generatedAt}`,
    symbol: "MARKET",
    market: "multi",
    direction: currentBias,
    action: marketActionForBias(currentBias),
    previousBias,
    currentBias,
    previousRiskMode: previousContext.riskMode ?? "unknown",
    currentRiskMode: marketContext.riskMode ?? "unknown",
    previousRegime: previousContext.longTermRegime?.regime ?? "unknown",
    currentRegime: regime,
    confidence: bestSignal?.confidence ?? "MEDIUM",
    convictionScore: bestSignal?.convictionScore ?? 0,
    marketContext,
    bestSignal: bestSignal ?? null,
    summary: `大盘信号反转：${previousBias} -> ${currentBias}，风险模式 ${previousContext.riskMode ?? "unknown"} -> ${marketContext.riskMode ?? "unknown"}。${bestText}`,
    supporting: [
      `市场偏向 ${previousBias} -> ${currentBias}`,
      `长期结构 ${previousContext.longTermRegime?.regime ?? "unknown"} -> ${regime}`,
      bestText
    ],
    risks: [
      "大盘反转初期容易反复，单标的仍需等待入场价和止损条件确认。"
    ],
    generatedAt: new Date(generatedAt).toISOString()
  };
}

export function buildBestSignal({
  tradeIdeas = [],
  marketContext = {},
  minimumConviction = 60,
  strategyPolicy = null,
  generatedAt = Date.now()
} = {}) {
  const ranked = tradeIdeas
    .map((idea) => idea?.convictionScore !== undefined && Array.isArray(idea?.factors)
      ? idea
      : scoreTradeIdea(idea, { marketContext }))
    .filter(Boolean)
    .sort((left, right) => right.convictionScore - left.convictionScore)
    .map((idea, index) => ({ ...idea, rank: index + 1 }));

  const actionableRanked = ranked
    .filter((idea) => idea.action !== "WAIT")
    .map((idea, index) => ({ ...idea, executionRank: index + 1 }));
  const best = actionableRanked[0];
  const strongestWatch = ranked[0];
  if (!best || best.convictionScore < minimumConviction) {
    return {
      id: `best:WAIT:${generatedAt}`,
      rank: 1,
      symbol: "MARKET",
      market: "multi",
      direction: "WAIT",
      action: "WAIT",
      convictionScore: strongestWatch?.convictionScore ?? 0,
      confidence: "LOW",
      summary: strongestWatch
        ? `当前没有足够清晰的可执行高置信方向；最高观察标的是 ${strongestWatch.symbol} ${strongestWatch.direction}，综合分 ${strongestWatch.convictionScore}，但动作仍为 ${strongestWatch.action}。`
        : "当前没有足够清晰的高置信方向，等待更好的风险收益比或趋势共振。",
      supporting: [],
      risks: ["最高可执行信号没有达到最低置信阈值"],
      alternatives: ranked.slice(0, 3),
      marketContext,
      strategyPolicy,
      generatedAt: new Date(generatedAt).toISOString()
    };
  }

  return {
    ...best,
    id: `best:${best.symbol}:${best.direction}:${generatedAt}`,
    summary: `${best.symbol} ${best.direction} 是当前最高置信方向，综合分 ${best.convictionScore}，动作 ${best.action}。`,
    alternatives: ranked.slice(1, 4),
    marketContext,
    strategyPolicy,
    generatedAt: new Date(generatedAt).toISOString()
  };
}
