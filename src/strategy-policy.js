function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentile(values, ratio, fallback) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return fallback;
  if (sorted.length === 1) return sorted[0];

  const index = clamp((sorted.length - 1) * ratio, 0, sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];

  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (index - lower));
}

function average(values, fallback = 0) {
  const finiteValues = values.map(Number).filter(Number.isFinite);
  if (finiteValues.length === 0) return fallback;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function scoreValues(ideas) {
  return ideas
    .map((idea) => finite(idea?.convictionScore))
    .filter((value) => value !== null);
}

function actionableIdeas(ideas) {
  return ideas.filter((idea) => ["LONG", "SHORT"].includes(idea?.direction) && idea?.action !== "WAIT");
}

function volatilityMetrics(ideas) {
  const atrPercents = ideas
    .map((idea) => {
      const atr = finite(idea?.indicators?.atr);
      const entry = finite(idea?.entry);
      if (!atr || !entry) return null;
      return Math.abs(atr / entry);
    })
    .filter((value) => value !== null);
  const avgAtrPercent = average(atrPercents, 0.02);
  const p75AtrPercent = percentile(atrPercents, 0.75, avgAtrPercent);

  return {
    avgAtrPercent,
    p75AtrPercent,
    isHighVolatility: p75AtrPercent >= 0.045,
    isLowVolatility: p75AtrPercent > 0 && p75AtrPercent <= 0.012
  };
}

function liquidityMetrics(ideas) {
  const volumeRatios = ideas
    .map((idea) => finite(idea?.indicators?.volumeRatio))
    .filter((value) => value !== null);
  const avgVolumeRatio = average(volumeRatios, 1);
  const p25VolumeRatio = percentile(volumeRatios, 0.25, avgVolumeRatio);

  return {
    avgVolumeRatio,
    p25VolumeRatio,
    isThinLiquidity: p25VolumeRatio > 0 && p25VolumeRatio < 0.75,
    isStrongLiquidity: avgVolumeRatio >= 1.2
  };
}

function regimeAdjustment(marketContext = {}) {
  if (marketContext.riskMode === "mixed") return 2;
  if (marketContext.riskMode === "risk_off") return 1;
  if (marketContext.riskMode === "risk_on") return 0;
  return 1.5;
}

function confidenceLabel(score, thresholds) {
  if (score >= thresholds.high) return "HIGH";
  if (score >= thresholds.medium) return "MEDIUM";
  return "LOW";
}

function confidenceForMinScore(score, thresholds) {
  if (score >= thresholds.high) return "HIGH";
  if (score >= thresholds.medium) return "MEDIUM";
  return "LOW";
}

export function deriveStrategyPolicy({
  scoredIdeas = [],
  marketContext = {},
  now = Date.now()
} = {}) {
  const scored = scoredIdeas.filter((idea) => finite(idea?.convictionScore) !== null);
  const actionable = actionableIdeas(scored);
  const scores = scoreValues(scored);
  const actionableScores = scoreValues(actionable);
  const p50 = percentile(scores, 0.5, 62);
  const p75 = percentile(scores, 0.75, 68);
  const p90 = percentile(scores, 0.9, 78);
  const actionableP75 = percentile(actionableScores, 0.75, p75);
  const volatility = volatilityMetrics(scored);
  const liquidity = liquidityMetrics(scored);
  const regimeBump = regimeAdjustment(marketContext);
  const volatilityBump = volatility.isHighVolatility ? 2.5 : volatility.isLowVolatility ? -1 : 0;
  const liquidityBump = liquidity.isThinLiquidity ? 2 : liquidity.isStrongLiquidity ? -1 : 0;

  const medium = round(clamp((p50 * 0.35) + (p75 * 0.65), 58, 76));
  const high = round(clamp(Math.max(medium + 8, (p75 * 0.45) + (p90 * 0.55)), 70, 90));
  const minConviction = round(clamp(
    (actionableP75 * 0.55) + (p75 * 0.35) + 4 + regimeBump + volatilityBump + liquidityBump,
    58,
    82
  ));
  const minRiskReward = round(clamp(
    1.08
      + (volatility.isHighVolatility ? 0.18 : 0)
      + (liquidity.isThinLiquidity ? 0.12 : 0)
      + (marketContext.riskMode === "mixed" ? 0.08 : 0)
      - (liquidity.isStrongLiquidity ? 0.05 : 0),
    1.05,
    1.65
  ), 2);
  const minPlaybookScore = round(clamp(
    0.48
      + (volatility.isHighVolatility ? 0.06 : 0)
      + (liquidity.isThinLiquidity ? 0.04 : 0)
      + (marketContext.riskMode === "mixed" ? 0.03 : 0),
    0.45,
    0.68
  ), 2);
  const minFirstOpportunityScore = round(clamp(Math.max(minConviction + 4, p90 - 1), 64, 88));
  const scoreJump = round(clamp((p90 - p50) / 4, 3, 9));
  const minConfidence = confidenceForMinScore(minConviction, { medium, high });

  const reasons = [
    `本轮评分中位数 ${round(p50)} / P75 ${round(p75)} / P90 ${round(p90)}`,
    `ATR中枢 ${round(volatility.p75AtrPercent * 100, 2)}%，${volatility.isHighVolatility ? "高波动提高执行门槛" : volatility.isLowVolatility ? "低波动降低追价门槛" : "波动正常"}`,
    `量能均值 ${round(liquidity.avgVolumeRatio, 2)}，${liquidity.isThinLiquidity ? "流动性偏薄提高过滤" : liquidity.isStrongLiquidity ? "量能较强允许更积极" : "量能中性"}`,
    `市场环境 ${marketContext.riskMode ?? "unknown"}`
  ];

  return {
    generatedAt: new Date(now).toISOString(),
    mode: "adaptive",
    confidenceThresholds: { medium, high },
    minConviction,
    minRiskReward,
    minConfidence,
    minPlaybookScore,
    minFirstOpportunityScore,
    scoreJump,
    sampleSize: scored.length,
    actionableSampleSize: actionable.length,
    distribution: {
      median: round(p50),
      p75: round(p75),
      p90: round(p90)
    },
    marketInputs: {
      riskMode: marketContext.riskMode ?? "unknown",
      avgAtrPercent: round(volatility.avgAtrPercent * 100, 2),
      p75AtrPercent: round(volatility.p75AtrPercent * 100, 2),
      avgVolumeRatio: round(liquidity.avgVolumeRatio, 2),
      p25VolumeRatio: round(liquidity.p25VolumeRatio, 2)
    },
    reasons
  };
}

export function applyStrategyPolicyToIdea(idea, policy) {
  const score = finite(idea?.convictionScore);
  if (!idea || score === null || !policy?.confidenceThresholds) return idea;

  return {
    ...idea,
    confidence: confidenceLabel(score, policy.confidenceThresholds),
    strategyPolicy: {
      mode: policy.mode,
      minConviction: policy.minConviction,
      minRiskReward: policy.minRiskReward,
      minPlaybookScore: policy.minPlaybookScore,
      confidenceThresholds: policy.confidenceThresholds
    }
  };
}

export function applyStrategyPolicyToIdeas(ideas = [], policy) {
  return ideas.map((idea) => applyStrategyPolicyToIdea(idea, policy));
}
