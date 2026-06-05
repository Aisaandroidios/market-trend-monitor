import { scoreTradeIdea } from "./conviction.js";
import { decisionIntervalForUsMarketSession } from "./market-session.js";
import { normalizeTelegramTopicSymbol } from "./notifiers.js";

const defaultOpportunityScanIntervals = {
  regular: 900000,
  near_open: 1800000,
  premarket: 3600000,
  after_hours: 3600000,
  off_hours: 14400000,
  weekend: 14400000
};

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function envInterval(env, name, fallback) {
  return positiveNumber(env[name], fallback);
}

function confidenceRank(confidence) {
  if (confidence === "HIGH") return 3;
  if (confidence === "MEDIUM") return 2;
  if (confidence === "LOW") return 1;
  return 0;
}

function isActionable(idea) {
  return ["LONG", "SHORT"].includes(idea?.direction) && idea?.action !== "WAIT";
}

export function opportunityScanScheduleConfigFromEnv({
  fixedIntervalMs = 600000,
  env = process.env
} = {}) {
  return {
    scheduleEnabled: !["0", "false", "no", "off"].includes(String(env.OPPORTUNITY_SCAN_ENABLED ?? "true").toLowerCase()),
    fixedIntervalMs: positiveNumber(env.OPPORTUNITY_SCAN_FIXED_INTERVAL_MS, fixedIntervalMs),
    intervals: {
      regular: envInterval(env, "OPPORTUNITY_SCAN_REGULAR_INTERVAL_MS", defaultOpportunityScanIntervals.regular),
      near_open: envInterval(env, "OPPORTUNITY_SCAN_NEAR_OPEN_INTERVAL_MS", defaultOpportunityScanIntervals.near_open),
      premarket: envInterval(env, "OPPORTUNITY_SCAN_PREMARKET_INTERVAL_MS", defaultOpportunityScanIntervals.premarket),
      after_hours: envInterval(env, "OPPORTUNITY_SCAN_AFTER_HOURS_INTERVAL_MS", defaultOpportunityScanIntervals.after_hours),
      off_hours: envInterval(env, "OPPORTUNITY_SCAN_OFF_HOURS_INTERVAL_MS", defaultOpportunityScanIntervals.off_hours),
      weekend: envInterval(env, "OPPORTUNITY_SCAN_WEEKEND_INTERVAL_MS", defaultOpportunityScanIntervals.weekend)
    }
  };
}

export function opportunityScanIntervalForUsMarketSession(options = {}) {
  return decisionIntervalForUsMarketSession(options);
}

export function opportunityStateKey(idea) {
  const scoreBucket = Math.floor(Number(idea.convictionScore ?? 0) / 5) * 5;
  const modelBucket = Math.floor(Number(idea.modelBrain?.score ?? 0) * 10);
  return [
    idea.symbol,
    idea.direction,
    idea.action,
    idea.confidence ?? "LOW",
    scoreBucket,
    idea.tradePlaybook?.decision ?? "UNKNOWN",
    modelBucket
  ].join(":");
}

function alertReasons({ idea, previous, minFirstScore, scoreJump }) {
  const reasons = [];
  const score = Number(idea.convictionScore ?? 0);

  if (!previous && score >= minFirstScore) reasons.push("新高置信机会");
  if (previous?.direction && previous.direction !== idea.direction) reasons.push("方向变化");
  if (previous?.convictionScore !== undefined && score - Number(previous.convictionScore) >= scoreJump) {
    reasons.push(`综合分提升 ${Number(previous.convictionScore).toFixed(2)} -> ${score.toFixed(2)}`);
  }
  if (confidenceRank(idea.confidence) > confidenceRank(previous?.confidence)) reasons.push("置信度升级");
  if ((idea.modelBrain?.score ?? 0) >= 0.78) reasons.push("模型大脑共振");
  if (idea.walkForward?.status === "ok" && idea.walkForward.supportDirection === idea.direction && Number(idea.walkForward.validationScore ?? 0) >= 0.58) {
    reasons.push("Walk-forward 支持当前方向");
  }
  if (idea.probabilityCalibration?.status === "ok" && Number(idea.probabilityCalibration.calibratedPercent ?? 0) >= 60) {
    reasons.push("校准胜率达标");
  }
  if (idea.derivatives?.ok && idea.derivatives.biasDirection === idea.direction) {
    reasons.push("衍生品/盘口同向");
  }
  if (idea.eventRisk?.status === "clear" || !idea.eventRisk) {
    if (score >= minFirstScore && Number(idea.tradePlaybook?.score ?? 0) >= 0.65) reasons.push("优质策略条件共振");
  }

  return reasons;
}

export function selectOpportunityAlerts({
  tradeIdeas = [],
  marketContext = {},
  lastAlerts = new Map(),
  nowMs = Date.now(),
  cooldownMs = 1800000,
  strategyPolicy = null,
  minConviction = 68,
  minFirstScore = 74,
  scoreJump = 6,
  maxAlerts = 5,
  skipSymbols = new Set()
} = {}) {
  const normalizedSkips = new Set([...skipSymbols].map((symbol) => normalizeTelegramTopicSymbol(symbol)));
  const effectiveMinConviction = Number(strategyPolicy?.minConviction ?? minConviction);
  const effectiveMinFirstScore = Number(strategyPolicy?.minFirstOpportunityScore ?? minFirstScore);
  const effectiveScoreJump = Number(strategyPolicy?.scoreJump ?? scoreJump);

  return tradeIdeas
    .map((idea) => {
      const scored = idea.convictionScore !== undefined ? idea : scoreTradeIdea(idea, { marketContext });
      if (!scored) return null;
      return { ...scored, marketContext };
    })
    .filter((idea) => isActionable(idea))
    .filter((idea) => !normalizedSkips.has(normalizeTelegramTopicSymbol(idea.symbol)))
    .filter((idea) => Number(idea.convictionScore ?? 0) >= effectiveMinConviction)
    .map((idea) => {
      const previous = lastAlerts.get(idea.symbol);
      const stateKey = opportunityStateKey(idea);
      const inCooldown = previous?.sentAt && nowMs - previous.sentAt < cooldownMs;
      const sameState = previous?.stateKey === stateKey;
      const reasons = alertReasons({
        idea,
        previous,
        minFirstScore: effectiveMinFirstScore,
        scoreJump: effectiveScoreJump
      });

      if (inCooldown && sameState) return null;
      if (reasons.length === 0) return null;

      return {
        idea,
        stateKey,
        reasons,
        sentAt: nowMs
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right.idea.convictionScore ?? 0) - (left.idea.convictionScore ?? 0))
    .slice(0, maxAlerts);
}
