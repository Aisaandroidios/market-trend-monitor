function clamp(value, min = 0, max = 1) {
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

function normalizeKey(value, fallback = "UNKNOWN") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function successRate(successes, failures) {
  const resolved = successes + failures;
  return resolved === 0 ? 0 : round((successes / resolved) * 100, 2);
}

function paperWinRate(wins, losses) {
  const resolved = wins + losses;
  return resolved === 0 ? 0 : round((wins / resolved) * 100, 2);
}

function emptyBucket(key, label = key) {
  return {
    key,
    label,
    signals: 0,
    reviewed: 0,
    successes: 0,
    failures: 0,
    pending: 0,
    successRate: 0,
    paperTrades: 0,
    paperWins: 0,
    paperLosses: 0,
    paperBreakeven: 0,
    paperWinRate: 0,
    netPnl: 0,
    avgPnl: 0,
    score: 0.5,
    sampleScore: 0
  };
}

function bucketFor(map, key, label = key) {
  const normalized = normalizeKey(key);
  if (!map.has(normalized)) map.set(normalized, emptyBucket(normalized, label ?? normalized));
  return map.get(normalized);
}

function addSignal(bucket, record) {
  if (!["LONG", "SHORT"].includes(record?.direction)) return;
  bucket.signals += 1;
}

function addReview(bucket, review) {
  if (!review?.outcome) return;

  bucket.reviewed += 1;
  if (review.outcome === "RIGHT") bucket.successes += 1;
  else if (review.outcome === "WRONG") bucket.failures += 1;
  else bucket.pending += 1;
}

function addPaperTrade(bucket, trade) {
  const pnl = finite(trade?.netPnl, 0);
  bucket.paperTrades += 1;
  bucket.netPnl = round(bucket.netPnl + pnl, 2);
  if (pnl > 0) bucket.paperWins += 1;
  else if (pnl < 0) bucket.paperLosses += 1;
  else bucket.paperBreakeven += 1;
}

function modelConfidence(record) {
  return record?.modelBrain?.confidence
    ?? record?.modelSignal?.confidence
    ?? "UNKNOWN";
}

function regimeLabel(record) {
  const regime = record?.contractLongTermRegime ?? record?.longTermRegime;
  if (!regime) return "UNKNOWN";
  const symbol = regime.symbol ? `${regime.symbol} ` : "";
  return `${symbol}${regime.regime ?? "unknown"}:${regime.biasDirection ?? "NEUTRAL"}`;
}

function groupSignalKeys(record) {
  const direction = normalizeKey(record.direction);
  const symbol = normalizeKey(record.symbol);

  return {
    bySymbol: symbol,
    byDirection: direction,
    bySymbolDirection: `${symbol}:${direction}`,
    byRiskMode: normalizeKey(record.riskMode),
    byConfidence: normalizeKey(record.confidence),
    byRegime: regimeLabel(record),
    byModelConfidence: modelConfidence(record)
  };
}

function groupReviewKeys(record) {
  const review = record.previousSignalReview ?? {};
  const direction = normalizeKey(review.previousDirection ?? record.direction);
  const symbol = normalizeKey(record.symbol);

  return {
    bySymbol: symbol,
    byDirection: direction,
    bySymbolDirection: `${symbol}:${direction}`,
    byRiskMode: normalizeKey(record.riskMode),
    byConfidence: normalizeKey(record.confidence),
    byRegime: regimeLabel(record),
    byModelConfidence: modelConfidence(record)
  };
}

function groupTradeKeys(trade) {
  const direction = normalizeKey(trade.direction);
  const symbol = normalizeKey(trade.symbol);

  return {
    bySymbol: symbol,
    byDirection: direction,
    bySymbolDirection: `${symbol}:${direction}`,
    byConfidence: normalizeKey(trade.confidence)
  };
}

function paperPerformanceScore(bucket) {
  if (bucket.paperTrades === 0) return null;
  const winComponent = bucket.paperWinRate / 100;
  const pnlComponent = clamp(0.5 + (bucket.avgPnl / 400), 0, 1);
  return (winComponent * 0.65) + (pnlComponent * 0.35);
}

function reviewPerformanceScore(bucket) {
  const resolved = bucket.successes + bucket.failures;
  if (resolved === 0) return null;
  return bucket.successRate / 100;
}

function finalizeBucket(bucket) {
  bucket.successRate = successRate(bucket.successes, bucket.failures);
  bucket.paperWinRate = paperWinRate(bucket.paperWins, bucket.paperLosses);
  bucket.avgPnl = bucket.paperTrades === 0 ? 0 : round(bucket.netPnl / bucket.paperTrades, 2);

  const reviewScore = reviewPerformanceScore(bucket);
  const paperScore = paperPerformanceScore(bucket);
  const sampleScore = clamp(((bucket.successes + bucket.failures) / 8) + (bucket.paperTrades / 6), 0, 1);
  bucket.sampleScore = round(sampleScore, 3);

  if (reviewScore === null && paperScore === null) {
    bucket.score = 0.5;
  } else if (reviewScore !== null && paperScore !== null) {
    bucket.score = round((reviewScore * 0.55) + (paperScore * 0.45), 3);
  } else {
    bucket.score = round(reviewScore ?? paperScore, 3);
  }

  return bucket;
}

function finalizeMap(map, limit = 12) {
  return Array.from(map.values())
    .map(finalizeBucket)
    .filter((bucket) => bucket.signals > 0 || bucket.reviewed > 0 || bucket.paperTrades > 0)
    .sort((left, right) => {
      const rightSamples = right.reviewed + right.paperTrades;
      const leftSamples = left.reviewed + left.paperTrades;
      if (rightSamples !== leftSamples) return rightSamples - leftSamples;
      return right.score - left.score;
    })
    .slice(0, limit);
}

function buildGroups() {
  return {
    bySymbol: new Map(),
    byDirection: new Map(),
    bySymbolDirection: new Map(),
    byRiskMode: new Map(),
    byConfidence: new Map(),
    byRegime: new Map(),
    byModelConfidence: new Map()
  };
}

function forEachGroup(groups, keys, callback) {
  for (const [groupName, key] of Object.entries(keys)) {
    if (!groups[groupName]) continue;
    const bucket = bucketFor(groups[groupName], key);
    callback(bucket, groupName);
  }
}

function actionableSignal(record) {
  return record
    && ["LONG", "SHORT"].includes(record.direction)
    && finite(record.entry) !== null
    && finite(record.takeProfit) !== null
    && finite(record.stopLoss) !== null;
}

function reviewedSignal(record) {
  const review = record?.previousSignalReview;
  return review?.outcome && ["RIGHT", "WRONG", "PENDING"].includes(review.outcome);
}

function closedPaperTrade(trade) {
  return trade
    && trade.status === "CLOSED"
    && ["LONG", "SHORT"].includes(trade.direction)
    && finite(trade.netPnl) !== null;
}

function totalSummary(signalRecords, paperTrades) {
  const total = emptyBucket("TOTAL", "TOTAL");
  for (const record of signalRecords) {
    if (actionableSignal(record)) addSignal(total, record);
    if (reviewedSignal(record)) addReview(total, record.previousSignalReview);
  }
  for (const trade of paperTrades) {
    if (closedPaperTrade(trade)) addPaperTrade(total, trade);
  }
  return finalizeBucket(total);
}

function reliableBucket(bucket) {
  return bucket.sampleScore >= 0.35 && ((bucket.successes + bucket.failures) >= 2 || bucket.paperTrades >= 2);
}

function strengthScore(bucket) {
  return (bucket.score * 0.75) + (bucket.sampleScore * 0.25);
}

function weaknessScore(bucket) {
  return ((1 - bucket.score) * 0.75) + (bucket.sampleScore * 0.25);
}

function buildStrengthsAndWeaknesses(groups) {
  const candidates = [
    ...groups.bySymbolDirection,
    ...groups.bySymbol,
    ...groups.byRiskMode,
    ...groups.byRegime
  ].filter(reliableBucket);

  const strengths = candidates
    .filter((bucket) => bucket.score >= 0.58 || bucket.netPnl > 0)
    .sort((left, right) => strengthScore(right) - strengthScore(left))
    .slice(0, 5);

  const weaknesses = candidates
    .filter((bucket) => bucket.score <= 0.45 || bucket.netPnl < 0)
    .sort((left, right) => weaknessScore(right) - weaknessScore(left))
    .slice(0, 5);

  return { strengths, weaknesses };
}

function describeBucket(bucket) {
  const reviewText = bucket.reviewed > 0
    ? `复盘 ${bucket.successes}/${bucket.successes + bucket.failures}`
    : "复盘样本不足";
  const paperText = bucket.paperTrades > 0
    ? `模拟 ${bucket.paperWins}/${bucket.paperTrades}，PnL ${round(bucket.netPnl, 2)}`
    : "模拟样本不足";

  return `${bucket.label}: ${reviewText}，${paperText}`;
}

function buildRecommendations({ total, strengths, weaknesses }) {
  const recommendations = [];

  if ((total.reviewed + total.paperTrades) < 4) {
    recommendations.push("归因样本还少，先继续收集信号复盘和模拟成交，不急着大幅调参。");
  }
  if (strengths.length) {
    recommendations.push(`优先保留强项: ${describeBucket(strengths[0])}。`);
  }
  if (weaknesses.length) {
    recommendations.push(`自动降低弱项权重: ${describeBucket(weaknesses[0])}。`);
  }
  if (total.paperTrades > 0 && total.netPnl < 0) {
    recommendations.push("模拟账户累计为负时，提高最低综合分和交易员检查门槛，减少低质量开仓。");
  }
  if (total.reviewed >= 6 && total.successRate >= 62 && total.netPnl >= 0) {
    recommendations.push("历史复盘和模拟账户同时偏正，可以允许高分信号更快触发机会推送。");
  }

  return recommendations.slice(0, 4);
}

function policyHints(strengths, weaknesses) {
  return {
    boost: strengths.map((bucket) => bucket.key).slice(0, 5),
    reduce: weaknesses.map((bucket) => bucket.key).slice(0, 5),
    avoidSymbols: weaknesses
      .filter((bucket) => !bucket.key.includes(":") && bucket.paperTrades >= 2 && bucket.netPnl < 0)
      .map((bucket) => bucket.key)
      .slice(0, 5)
  };
}

export function buildPerformanceAttribution({
  signalRecords = [],
  paperTrades = [],
  now = Date.now(),
  limit = 12
} = {}) {
  const groups = buildGroups();

  for (const record of signalRecords) {
    if (actionableSignal(record)) {
      forEachGroup(groups, groupSignalKeys(record), (bucket) => addSignal(bucket, record));
    }
    if (reviewedSignal(record)) {
      forEachGroup(groups, groupReviewKeys(record), (bucket) => addReview(bucket, record.previousSignalReview));
    }
  }

  for (const trade of paperTrades) {
    if (!closedPaperTrade(trade)) continue;
    forEachGroup(groups, groupTradeKeys(trade), (bucket) => addPaperTrade(bucket, trade));
  }

  const finalizedGroups = Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [key, finalizeMap(value, limit)])
  );
  const total = totalSummary(signalRecords, paperTrades);
  const { strengths, weaknesses } = buildStrengthsAndWeaknesses(finalizedGroups);

  return {
    generatedAt: new Date(now).toISOString(),
    total,
    groups: finalizedGroups,
    strengths,
    weaknesses,
    recommendations: buildRecommendations({ total, strengths, weaknesses }),
    policyHints: policyHints(strengths, weaknesses)
  };
}

export function attributionSliceForIdea(attribution, { symbol, direction } = {}) {
  if (!attribution?.groups) return null;
  const symbolDirection = `${normalizeKey(symbol)}:${normalizeKey(direction)}`;

  return attribution.groups.bySymbolDirection?.find((bucket) => bucket.key === symbolDirection)
    ?? attribution.groups.bySymbol?.find((bucket) => bucket.key === normalizeKey(symbol))
    ?? null;
}

export function buildAttributionStrategyFeedback(baseFeedback, attributionSlice) {
  if (!baseFeedback || !attributionSlice || !reliableBucket(attributionSlice)) return baseFeedback;

  const baseScore = finite(baseFeedback.score, 0.5);
  const attributionScore = finite(attributionSlice.score, 0.5);
  const sampleWeight = clamp(attributionSlice.sampleScore, 0.2, 0.55);
  const score = clamp((baseScore * (1 - sampleWeight)) + (attributionScore * sampleWeight), 0.1, 0.95);
  const sampleSize = Math.max(
    finite(baseFeedback.sampleSize, 0),
    attributionSlice.reviewed + attributionSlice.paperTrades
  );
  const note = `${baseFeedback.note} 归因: ${describeBucket(attributionSlice)}，自动权重 ${round(sampleWeight * 100, 0)}%。`;

  return {
    ...baseFeedback,
    sampleSize,
    score: round(score, 3),
    adjustment: round((score - 0.5) * 10, 2),
    attribution: attributionSlice,
    note
  };
}
