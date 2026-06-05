import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  getDefaultDataStore,
  loadJsonl
} from "./data-store.js";

export function appendSignalMemory({
  filePath,
  idea,
  marketContext = {},
  generatedAt = new Date().toISOString()
}) {
  if (!idea) return false;

  const contractLongTermRegime = idea.longTermRegime ?? null;
  const broadLongTermRegime = marketContext.longTermRegime ?? null;
  const record = {
    generatedAt,
    symbol: idea.symbol,
    market: idea.market,
    direction: idea.direction,
    action: idea.action,
    entry: idea.entry,
    takeProfit: idea.takeProfit,
    stopLoss: idea.stopLoss,
    convictionScore: idea.convictionScore,
    confidence: idea.confidence,
    winProbability: idea.winProbability,
    riskReward: idea.riskReward,
    newsScore: idea.indicators?.newsScore,
    riskMode: marketContext.riskMode,
    btcDirection: marketContext.btcDirection,
    longTermRegime: contractLongTermRegime ?? broadLongTermRegime,
    contractLongTermRegime,
    broadLongTermRegime,
    modelBrain: idea.modelBrain ?? null,
    modelSignal: idea.modelSignal ?? null,
    strategyFeedback: idea.strategyFeedback ?? null,
    previousSignalReview: idea.previousSignalReview ?? null
  };

  if (filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(record)}\n`);
    return true;
  }

  getDefaultDataStore().appendSignalRecord(record);
  return true;
}

export function loadSignalMemory({
  filePath
} = {}) {
  if (filePath) return loadJsonl(filePath);

  return getDefaultDataStore().loadSignalRecords();
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function actionableRecord(record) {
  return record
    && ["LONG", "SHORT"].includes(record.direction)
    && isFiniteNumber(record.entry)
    && isFiniteNumber(record.takeProfit)
    && isFiniteNumber(record.stopLoss);
}

function signalCandlesAfter(previous, candles = []) {
  const generatedAt = Number(new Date(previous.generatedAt ?? 0));
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) return candles;

  return candles.filter((candle) => {
    const time = Number(candle.closeTime ?? candle.openTime ?? 0);
    return Number.isFinite(time) && time >= generatedAt;
  });
}

function candleHit(previous, candle) {
  const takeProfit = Number(previous.takeProfit);
  const stopLoss = Number(previous.stopLoss);
  const high = Number(candle.high);
  const low = Number(candle.low);

  if (previous.direction === "LONG") {
    const hitTakeProfit = high >= takeProfit;
    const hitStopLoss = low <= stopLoss;
    if (hitTakeProfit && hitStopLoss) return { outcome: "PENDING", label: "观察中", hit: "AMBIGUOUS" };
    if (hitTakeProfit) return { outcome: "RIGHT", label: "对", hit: "TAKE_PROFIT" };
    if (hitStopLoss) return { outcome: "WRONG", label: "错", hit: "STOP_LOSS" };
  }

  if (previous.direction === "SHORT") {
    const hitTakeProfit = low <= takeProfit;
    const hitStopLoss = high >= stopLoss;
    if (hitTakeProfit && hitStopLoss) return { outcome: "PENDING", label: "观察中", hit: "AMBIGUOUS" };
    if (hitTakeProfit) return { outcome: "RIGHT", label: "对", hit: "TAKE_PROFIT" };
    if (hitStopLoss) return { outcome: "WRONG", label: "错", hit: "STOP_LOSS" };
  }

  return null;
}

function priceDirectionReview(previous, currentPrice) {
  const entry = Number(previous.entry);
  const price = Number(currentPrice);
  const signedMove = previous.direction === "LONG"
    ? (price - entry) / entry
    : (entry - price) / entry;

  if (Math.abs(signedMove) < 0.001) {
    return { outcome: "PENDING", label: "观察中", hit: "NONE" };
  }

  return signedMove > 0
    ? { outcome: "RIGHT", label: "对", hit: "MARK_TO_MARKET" }
    : { outcome: "WRONG", label: "错", hit: "MARK_TO_MARKET" };
}

function reviewDetail({ review, previous, currentPrice, pnlPercent }) {
  if (review.hit === "TAKE_PROFIT") return `上次 ${previous.direction} 已触发止盈，本次按对处理。`;
  if (review.hit === "STOP_LOSS") return `上次 ${previous.direction} 已触发止损，本次按错处理。`;
  if (review.hit === "AMBIGUOUS") return "同一根K线同时覆盖止盈和止损，无法判断先后，继续观察。";
  if (review.outcome === "PENDING") return "当前价接近上次入场价，盈亏方向还不明显。";

  return `未触发止盈/止损，按当前价相对入场浮动 ${pnlPercent}% 判断。`;
}

export function reviewPreviousSignal({ previous, currentPrice, candles = [] } = {}) {
  if (!actionableRecord(previous) || !isFiniteNumber(currentPrice)) return null;

  let review = null;
  for (const candle of signalCandlesAfter(previous, candles)) {
    review = candleHit(previous, candle);
    if (review) break;
  }

  if (!review) review = priceDirectionReview(previous, currentPrice);

  const entry = Number(previous.entry);
  const price = Number(currentPrice);
  const pnlPercent = Number((((previous.direction === "LONG" ? price - entry : entry - price) / entry) * 100).toFixed(2));

  return {
    outcome: review.outcome,
    label: review.label,
    hit: review.hit,
    previousGeneratedAt: previous.generatedAt,
    previousDirection: previous.direction,
    previousEntry: entry,
    previousTakeProfit: Number(previous.takeProfit),
    previousStopLoss: Number(previous.stopLoss),
    currentPrice: price,
    pnlPercent,
    detail: reviewDetail({ review, previous, currentPrice: price, pnlPercent })
  };
}

export function reviewLatestSignalMemory({ records = [], symbol, currentPrice, candles = [] } = {}) {
  const previous = records
    .filter((record) => record.symbol === symbol)
    .filter(actionableRecord)
    .at(-1);

  return reviewPreviousSignal({ previous, currentPrice, candles });
}

function emptyDirectionStats() {
  return {
    reviewed: 0,
    successes: 0,
    failures: 0,
    pending: 0,
    successRate: 0
  };
}

function successRate(successes, failures) {
  const resolved = successes + failures;
  return resolved === 0 ? 0 : Number(((successes / resolved) * 100).toFixed(2));
}

function emptyPerformanceStats() {
  return {
    totalSignals: 0,
    reviewedSignals: 0,
    successes: 0,
    failures: 0,
    pending: 0,
    successRate: 0,
    long: emptyDirectionStats(),
    short: emptyDirectionStats()
  };
}

function finalizePerformanceStats(stats) {
  stats.successRate = successRate(stats.successes, stats.failures);
  stats.long.successRate = successRate(stats.long.successes, stats.long.failures);
  stats.short.successRate = successRate(stats.short.successes, stats.short.failures);
  return stats;
}

function addReviewToStats(stats, review) {
  stats.reviewedSignals += 1;
  const directionStats = review.previousDirection === "LONG"
    ? stats.long
    : review.previousDirection === "SHORT"
      ? stats.short
      : null;
  if (directionStats) directionStats.reviewed += 1;

  if (review.outcome === "RIGHT") {
    stats.successes += 1;
    if (directionStats) directionStats.successes += 1;
  } else if (review.outcome === "WRONG") {
    stats.failures += 1;
    if (directionStats) directionStats.failures += 1;
  } else {
    stats.pending += 1;
    if (directionStats) directionStats.pending += 1;
  }
}

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(Number(date)) ? date : null;
}

function localDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekKey(parts) {
  const localUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const dayOfWeek = new Date(localUtc).getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(localUtc + (mondayOffset * 24 * 60 * 60 * 1000));

  return dateKey({
    year: monday.getUTCFullYear(),
    month: monday.getUTCMonth() + 1,
    day: monday.getUTCDate()
  });
}

function periodKeys(value, timeZone) {
  const date = validDate(value);
  if (!date) return null;

  const parts = localDateParts(date, timeZone);
  return {
    day: dateKey(parts),
    week: weekKey(parts),
    month: `${parts.year}-${String(parts.month).padStart(2, "0")}`,
    year: String(parts.year)
  };
}

function reviewGeneratedAt(record) {
  return record.previousSignalReview?.previousGeneratedAt ?? record.generatedAt;
}

function summarizeRecords(records, { signalMatches = () => true, reviewMatches = () => true } = {}) {
  const stats = emptyPerformanceStats();

  for (const record of records) {
    if (actionableRecord(record) && signalMatches(record)) {
      stats.totalSignals += 1;
    }

    const review = record.previousSignalReview;
    if (review?.outcome && reviewMatches(record)) {
      addReviewToStats(stats, review);
    }
  }

  return finalizePerformanceStats(stats);
}

function summarizePeriod(records, { period, now, timeZone }) {
  const currentKeys = periodKeys(now, timeZone);
  const currentPeriodKey = currentKeys?.[period];
  if (!currentPeriodKey) return emptyPerformanceStats();

  return summarizeRecords(records, {
    signalMatches(record) {
      return periodKeys(record.generatedAt, timeZone)?.[period] === currentPeriodKey;
    },
    reviewMatches(record) {
      return periodKeys(reviewGeneratedAt(record), timeZone)?.[period] === currentPeriodKey;
    }
  });
}

export function summarizeSignalPerformance(records = [], {
  now = new Date(),
  timeZone = "Asia/Shanghai"
} = {}) {
  const stats = {
    ...summarizeRecords(records),
    periods: {
      day: summarizePeriod(records, { period: "day", now, timeZone }),
      week: summarizePeriod(records, { period: "week", now, timeZone }),
      month: summarizePeriod(records, { period: "month", now, timeZone }),
      year: summarizePeriod(records, { period: "year", now, timeZone })
    }
  };
  return stats;
}

function feedbackRecords(records, { symbol, direction }) {
  return records
    .filter((record) => record.symbol === symbol)
    .map((record) => record.previousSignalReview)
    .filter((review) => review?.previousDirection === direction)
    .filter((review) => review.outcome === "RIGHT" || review.outcome === "WRONG");
}

function consecutiveOutcomeCount(reviews, outcome) {
  let count = 0;
  for (const review of [...reviews].reverse()) {
    if (review.outcome !== outcome) break;
    count += 1;
  }
  return count;
}

function feedbackNote(feedback) {
  if (feedback.sampleSize === 0) {
    return `${feedback.symbol} ${feedback.direction} 历史复盘样本不足，策略反馈按中性处理。`;
  }

  const streak = feedback.consecutiveFailures >= 2
    ? `，连续错 ${feedback.consecutiveFailures} 次，自动降权`
    : feedback.consecutiveSuccesses >= 2
      ? `，连续对 ${feedback.consecutiveSuccesses} 次，适度加权`
      : "";

  const adjustment = feedback.adjustment > 0
    ? `加 ${feedback.adjustment} 分`
    : feedback.adjustment < 0
      ? `降 ${Math.abs(feedback.adjustment)} 分`
      : "不加不减";

  return `${feedback.symbol} ${feedback.direction} 历史复盘 ${feedback.successes}/${feedback.sampleSize}，成功率 ${feedback.successRate}%${streak}，策略反馈${adjustment}。`;
}

export function buildStrategyFeedback(records = [], { symbol, direction } = {}) {
  const reviews = feedbackRecords(records, { symbol, direction });
  const successes = reviews.filter((review) => review.outcome === "RIGHT").length;
  const failures = reviews.filter((review) => review.outcome === "WRONG").length;
  const sampleSize = successes + failures;
  const rate = successRate(successes, failures);
  const consecutiveFailures = consecutiveOutcomeCount(reviews, "WRONG");
  const consecutiveSuccesses = consecutiveOutcomeCount(reviews, "RIGHT");

  if (!symbol || !direction || sampleSize === 0) {
    const neutral = {
      symbol,
      direction,
      sampleSize: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      score: 0.5,
      adjustment: 0
    };
    return { ...neutral, note: feedbackNote(neutral) };
  }

  const rawRate = successes / sampleSize;
  const sampleConfidence = clamp(sampleSize / 6, 0.25, 1);
  const streakPenalty = consecutiveFailures >= 3 ? -0.35 : consecutiveFailures >= 2 ? -0.25 : 0;
  const streakBonus = consecutiveSuccesses >= 3 ? 0.18 : consecutiveSuccesses >= 2 ? 0.1 : 0;
  let score = clamp(0.5 + ((rawRate - 0.5) * sampleConfidence) + streakPenalty + streakBonus, 0.1, 0.95);

  if (consecutiveFailures >= 2) score = Math.min(score, 0.25);
  if (consecutiveSuccesses >= 2) score = Math.max(score, 0.65);

  const feedback = {
    symbol,
    direction,
    sampleSize,
    successes,
    failures,
    successRate: rate,
    consecutiveFailures,
    consecutiveSuccesses,
    score: Number(score.toFixed(3)),
    adjustment: Number(((score - 0.5) * 10).toFixed(2))
  };

  return { ...feedback, note: feedbackNote(feedback) };
}
