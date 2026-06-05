import { isPlannedExitReview } from "./review-outcome.js";

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function resolvedReviews(records = []) {
  return records
    .filter((record) => isPlannedExitReview(record.previousSignalReview))
    .map((record) => ({
      symbol: record.symbol,
      direction: record.previousSignalReview?.previousDirection ?? record.direction,
      outcome: record.previousSignalReview?.outcome,
      generatedAt: record.previousSignalReview?.previousGeneratedAt ?? record.generatedAt,
      reviewedAt: record.generatedAt,
      confidence: record.confidence,
      modelConfidence: record.modelBrain?.confidence,
      modelScore: record.modelBrain?.score
    }));
}

function windowStats(reviews, size) {
  const rows = reviews.slice(-size);
  const successes = rows.filter((row) => row.outcome === "RIGHT").length;
  const failures = rows.filter((row) => row.outcome === "WRONG").length;
  const resolved = successes + failures;

  return {
    size,
    samples: rows.length,
    successes,
    failures,
    successRate: resolved === 0 ? 0 : round((successes / resolved) * 100, 2)
  };
}

function confidenceDrift(reviews) {
  const high = reviews.filter((row) => row.confidence === "HIGH" || row.modelConfidence === "HIGH").slice(-50);
  const successes = high.filter((row) => row.outcome === "RIGHT").length;
  const failures = high.filter((row) => row.outcome === "WRONG").length;
  const samples = successes + failures;

  return {
    samples,
    successes,
    failures,
    successRate: samples === 0 ? 0 : round((successes / samples) * 100, 2),
    overconfident: samples >= 6 && successes / samples < 0.5
  };
}

function dataSourceRisks(providerStatus = {}) {
  const healthyStatuses = new Set(["connected", "disabled", "polling", "configured"]);
  return Object.entries(providerStatus)
    .filter(([, status]) => !healthyStatuses.has(status))
    .map(([provider, status]) => `${provider}:${status}`);
}

export function buildModelGovernance({
  signalRecords = [],
  probabilityCalibration = null,
  providerStatus = {},
  now = Date.now()
} = {}) {
  const reviews = resolvedReviews(signalRecords);
  const windows = {
    last20: windowStats(reviews, 20),
    last50: windowStats(reviews, 50),
    last100: windowStats(reviews, 100)
  };
  const confidence = confidenceDrift(reviews);
  const sourceRisks = dataSourceRisks(providerStatus);
  const calibration = probabilityCalibration?.overall ?? {};
  const warnings = [];

  if (windows.last20.samples >= 8 && windows.last20.successRate < 45) warnings.push("最近20条胜率低于45%，模型进入观察。");
  if (windows.last50.samples >= 20 && windows.last50.successRate < 48) warnings.push("最近50条胜率低于48%，模型疑似漂移。");
  if (confidence.overconfident) warnings.push("高置信信号真实胜率不足，置信度偏高。");
  if (Number(calibration.expectedCalibrationError ?? 0) >= 12) warnings.push(`概率校准误差 ${calibration.expectedCalibrationError}%，胜率估算需降权。`);
  if (Number(calibration.overconfidence ?? 0) >= 8) warnings.push(`平均预测高于真实 ${calibration.overconfidence}%，模型偏乐观。`);
  if (sourceRisks.length) warnings.push(`数据源异常: ${sourceRisks.join(", ")}`);

  const status = warnings.some((item) => item.includes("漂移") || item.includes("异常"))
    ? "degraded"
    : warnings.length
      ? "watch"
      : "ok";
  const penalty = status === "degraded" ? 0.22 : status === "watch" ? 0.1 : 0;
  const score = clamp(1 - penalty - (Math.min(warnings.length, 4) * 0.05), 0.25, 1);

  return {
    generatedAt: new Date(now).toISOString(),
    status,
    score: round(score, 3),
    windows,
    confidence,
    calibration: {
      samples: calibration.samples ?? 0,
      expectedCalibrationError: calibration.expectedCalibrationError ?? 0,
      brierScore: calibration.brierScore ?? 0,
      overconfidence: calibration.overconfidence ?? 0
    },
    dataSources: providerStatus,
    warnings,
    action: status === "degraded" ? "REDUCE_MODEL_WEIGHT" : status === "watch" ? "WATCH" : "NONE",
    summary: warnings[0] ?? "模型治理状态正常。"
  };
}

export function applyModelGovernanceToIdea(idea, governance) {
  if (!idea || !governance) return idea;
  const modelBrain = idea.modelBrain
    ? {
        ...idea.modelBrain,
        score: round(Number(idea.modelBrain.score ?? 0.5) * governance.score, 3),
        governanceAdjusted: governance.status !== "ok"
      }
    : idea.modelBrain;

  return {
    ...idea,
    modelBrain,
    modelGovernance: governance
  };
}
