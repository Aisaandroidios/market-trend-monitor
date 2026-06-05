import { existsSync, readFileSync } from "node:fs";

function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 3) {
  return Number(value.toFixed(digits));
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function directionScore({ direction, biasDirection, aligned = 1, opposed = 0.2, neutral = 0.5 }) {
  if (!["LONG", "SHORT"].includes(direction)) return neutral;
  if (!["LONG", "SHORT"].includes(biasDirection)) return neutral;
  return biasDirection === direction ? aligned : opposed;
}

function technicalFeatureScore(idea) {
  const indicators = idea.indicators ?? {};
  let score = 0.45;

  if (idea.direction === "LONG") {
    if (indicators.ema20 > indicators.ema60) score += 0.18;
    if (indicators.macdHistogram > 0) score += 0.16;
    if (indicators.rsi >= 45 && indicators.rsi <= 68) score += 0.12;
    if (indicators.volumeRatio >= 1.05) score += 0.09;
  } else if (idea.direction === "SHORT") {
    if (indicators.ema20 < indicators.ema60) score += 0.18;
    if (indicators.macdHistogram < 0) score += 0.16;
    if (indicators.rsi >= 32 && indicators.rsi <= 55) score += 0.12;
    if (indicators.volumeRatio >= 1.05) score += 0.09;
  }

  const news = Number(indicators.newsScore ?? 0);
  if ((news > 0 && idea.direction === "LONG") || (news < 0 && idea.direction === "SHORT")) score += 0.05;
  if ((news > 0 && idea.direction === "SHORT") || (news < 0 && idea.direction === "LONG")) score -= 0.05;

  return clamp(score);
}

function vectorBacktestGateScore(idea) {
  const feedback = idea.strategyFeedback;
  const base = clamp(((idea.riskReward ?? 1) - 0.8) / 2.2);
  if (!feedback || Number(feedback.sampleSize ?? 0) < 3) {
    return clamp((base * 0.65) + 0.25);
  }

  const history = clamp(Number(feedback.score ?? 0.5));
  return clamp((base * 0.45) + (history * 0.55));
}

function finrlPolicyScore(idea) {
  const playbookScore = clamp(Number(idea.tradePlaybook?.score ?? 0.5));
  const atr = Number(idea.indicators?.atr ?? 0);
  const entry = Number(idea.entry ?? 0);
  const atrPercent = entry > 0 ? atr / entry : 0.03;
  const volatilityControl = clamp(1 - ((atrPercent - 0.01) / 0.08), 0.2, 1);
  const moneyFlow = directionScore({
    direction: idea.direction,
    biasDirection: idea.moneyFlow?.biasDirection,
    aligned: 1,
    opposed: 0.25,
    neutral: 0.55
  });

  return clamp((playbookScore * 0.45) + (volatilityControl * 0.25) + (moneyFlow * 0.3));
}

function qlibRegimeScore(idea) {
  return directionScore({
    direction: idea.direction,
    biasDirection: idea.longTermRegime?.biasDirection,
    aligned: idea.longTermRegime?.regime === "transition" ? 0.75 : 1,
    opposed: idea.longTermRegime?.regime === "transition" ? 0.35 : 0.18,
    neutral: 0.5
  });
}

function externalModelScore(idea, signal) {
  if (!signal) return null;
  const probability = clamp(Number(signal.probability ?? signal.score ?? 0.5));
  const direction = String(signal.direction ?? "").toUpperCase();
  if (!["LONG", "SHORT"].includes(direction)) return probability;
  return direction === idea.direction ? probability : 1 - probability;
}

function confidenceFromScore(score) {
  if (score >= 0.82) return "HIGH";
  if (score >= 0.66) return "MEDIUM";
  return "LOW";
}

export const openSourceBrainModels = [
  "Qlib-compatible regime model",
  "LightGBM-compatible tabular model",
  "vectorbt-compatible backtest gate",
  "FinRL-compatible policy/risk model"
];

export function scoreOpenSourceModelBrain(idea, { marketContext = {} } = {}) {
  if (!idea || !["LONG", "SHORT"].includes(idea.direction)) {
    return {
      provider: "Open Quant Ensemble",
      models: openSourceBrainModels,
      score: 0.5,
      confidence: "LOW",
      biasDirection: "NEUTRAL",
      note: "开源模型大脑未收到可执行方向，按中性处理。"
    };
  }

  const external = idea.modelSignal ?? null;
  const components = {
    qlibRegime: qlibRegimeScore(idea),
    lightgbmFeatures: technicalFeatureScore(idea),
    vectorbtBacktest: vectorBacktestGateScore(idea),
    finrlPolicy: finrlPolicyScore(idea)
  };

  let score = (
    components.qlibRegime * 0.28
    + components.lightgbmFeatures * 0.27
    + components.vectorbtBacktest * 0.2
    + components.finrlPolicy * 0.25
  );

  const externalScore = externalModelScore(idea, external);
  if (externalScore !== null) {
    score = (score * 0.55) + (externalScore * 0.45);
  }

  const roundedScore = round(clamp(score));
  const provider = external?.provider ? `Open Quant Ensemble + ${external.provider}` : "Open Quant Ensemble";
  const externalText = external?.provider ? `；外部模型 ${external.provider} 同步参与` : "";

  return {
    provider: "Open Quant Ensemble",
    activeProvider: provider,
    models: openSourceBrainModels,
    score: roundedScore,
    confidence: confidenceFromScore(roundedScore),
    biasDirection: idea.direction,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value)])),
    ...(external ? { external } : {}),
    note: `开源模型大脑支持 ${idea.symbol} ${idea.direction}，模型分 ${(roundedScore * 100).toFixed(0)}%${externalText}。`
  };
}

export function loadExternalModelSignals({
  filePath = process.env.MODEL_BRAIN_SIGNALS_PATH,
  raw
} = {}) {
  let content = raw;
  if (content === undefined) {
    if (!filePath || !existsSync(filePath)) return new Map();
    content = readFileSync(filePath, "utf8");
  }

  try {
    const parsed = JSON.parse(content);
    const rows = Array.isArray(parsed) ? parsed : parsed.signals ?? [];
    return new Map(
      rows
        .map((row) => [normalizeSymbol(row.symbol), row])
        .filter(([symbol]) => symbol)
    );
  } catch {
    return new Map();
  }
}
