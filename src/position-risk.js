function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolFromEnv(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function numberFromEnv(env, name, fallback) {
  const number = Number(env[name]);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function baseAsset(symbol) {
  return normalizeSymbol(symbol)
    .replace(/USDT$/, "")
    .replace(/USDC$/, "")
    .replace(/USD$/, "");
}

const bucketDefinitions = [
  ["crypto_major", ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX", "LINK"]],
  ["crypto_alt", ["HYPE", "ZEC", "WLD", "NEAR", "COIN"]],
  ["equity_index", ["QQQ", "XYZ100", "SPY", "SP500", "SPCX", "SOXL", "EWY"]],
  ["mega_cap_tech", ["AAPL", "APPLE", "MSFT", "GOOG", "GOOGL", "META", "TSLA", "ORCL", "IBM", "NOW"]],
  ["ai_semis", ["NVDA", "AMD", "MU", "MRVL", "AVGO", "INTC", "TSM", "ARM", "SMCI", "QCOM"]],
  ["commodities_metals", ["XAU", "GOLD", "XAG", "SILVER"]],
  ["commodities_energy", ["CL", "WTIOIL", "BZ", "BRENTOIL"]]
];

export function assetRiskBucket(symbol) {
  const asset = baseAsset(symbol);
  for (const [bucket, assets] of bucketDefinitions) {
    if (assets.includes(asset)) return bucket;
  }
  if (asset.includes("OIL")) return "commodities_energy";
  return asset ? "other" : "unknown";
}

export function positionRiskConfigFromEnv(env = process.env) {
  return {
    enabled: boolFromEnv(env.PAPER_POSITION_RISK_ENABLED, true),
    minRiskPerTrade: clamp(numberFromEnv(env, "PAPER_MIN_RISK_PER_TRADE", 0.0025), 0.0005, 0.05),
    maxRiskPerTrade: clamp(numberFromEnv(env, "PAPER_MAX_RISK_PER_TRADE", 0.01), 0.001, 0.05),
    dailyMaxLossPercent: clamp(numberFromEnv(env, "PAPER_DAILY_MAX_LOSS_PCT", 0.03), 0.001, 0.5),
    weeklyMaxLossPercent: clamp(numberFromEnv(env, "PAPER_WEEKLY_MAX_LOSS_PCT", 0.07), 0.002, 0.8),
    maxConsecutiveLosses: Math.max(1, Math.trunc(numberFromEnv(env, "PAPER_MAX_CONSECUTIVE_LOSSES", 4))),
    firstLossCut: Math.max(1, Math.trunc(numberFromEnv(env, "PAPER_LOSS_STREAK_CUT_1", 2))),
    secondLossCut: Math.max(1, Math.trunc(numberFromEnv(env, "PAPER_LOSS_STREAK_CUT_2", 3))),
    sameBucketMaxPositions: Math.max(1, Math.trunc(numberFromEnv(env, "PAPER_SAME_BUCKET_MAX_POSITIONS", 3))),
    sameBucketMaxRiskPercent: clamp(numberFromEnv(env, "PAPER_SAME_BUCKET_MAX_RISK_PCT", 0.025), 0.001, 0.5),
    highAtrPercent: clamp(numberFromEnv(env, "PAPER_HIGH_ATR_PCT", 0.055), 0.002, 1),
    maxAtrPercent: clamp(numberFromEnv(env, "PAPER_MAX_ATR_PCT", 0.12), 0.005, 1),
    minRiskReward: clamp(numberFromEnv(env, "PAPER_ENGINE_MIN_RR", 1.2), 0.5, 5),
    minQuoteVolume24h: Math.max(0, numberFromEnv(env, "PAPER_MIN_QUOTE_VOLUME_24H", 5_000_000)),
    hardMinQuoteVolume24h: Math.max(0, numberFromEnv(env, "PAPER_HARD_MIN_QUOTE_VOLUME_24H", 50_000)),
    hardLowVolumeRatio: clamp(numberFromEnv(env, "PAPER_HARD_LOW_VOLUME_RATIO", 0.25), 0.01, 5),
    lowVolumeRatio: clamp(numberFromEnv(env, "PAPER_LOW_VOLUME_RATIO", 0.65), 0.05, 5)
  };
}

function currentLossStreak(trades = []) {
  let count = 0;
  for (const trade of trades.slice().reverse()) {
    const pnl = finite(trade.netPnl, 0);
    if (pnl < 0) count += 1;
    else if (pnl > 0) break;
  }
  return count;
}

function periodLossPercent(stats = {}, equity) {
  const netPnl = finite(stats.netPnl, 0);
  if (netPnl >= 0) return 0;
  return Math.abs(netPnl) / Math.max(1, equity);
}

function atrPercent(idea) {
  const atr = finite(idea?.indicators?.atr, 0);
  const entry = finite(idea?.entry ?? idea?.price ?? idea?.currentPrice, 0);
  return entry > 0 ? Math.abs(atr / entry) : 0;
}

function volumeRatio(idea) {
  return finite(idea?.indicators?.volumeRatio, 1);
}

function quoteVolume24h(idea) {
  return finite(idea?.moneyFlow?.quoteVolume24h, null);
}

function bucketOpenRisk(positions = [], bucket) {
  return positions
    .filter((position) => position.riskBucket === bucket)
    .reduce((sum, position) => sum + finite(position.riskAmount, 0), 0);
}

function sameBucketPositions(positions = [], bucket) {
  return positions.filter((position) => position.riskBucket === bucket).length;
}

function volatilityMultiplier(idea, config) {
  const atrPct = atrPercent(idea);
  if (atrPct >= config.maxAtrPercent) return 0;
  if (atrPct >= config.highAtrPercent) {
    const span = Math.max(0.0001, config.maxAtrPercent - config.highAtrPercent);
    return clamp(0.65 - (((atrPct - config.highAtrPercent) / span) * 0.4), 0.2, 0.65);
  }
  if (atrPct <= 0.008) return 0.85;
  return 1;
}

function confidenceMultiplier(idea) {
  if (idea?.confidence === "HIGH") return 1;
  if (idea?.confidence === "MEDIUM") return 0.75;
  return 0.45;
}

function rrMultiplier(idea, config) {
  const rr = finite(idea?.riskReward, 0);
  if (rr < config.minRiskReward) return 0;
  if (rr < 1.45) return 0.55;
  if (rr < 1.8) return 0.8;
  return 1;
}

function liquidityMultiplier(idea, config) {
  const ratio = volumeRatio(idea);
  const quoteVolume = quoteVolume24h(idea);
  let multiplier = 1;

  if (quoteVolume !== null && quoteVolume > 0 && quoteVolume < config.hardMinQuoteVolume24h) return 0;

  if (ratio <= 0) multiplier *= 0.55;
  else if (ratio < config.hardLowVolumeRatio) multiplier *= 0.25;
  else if (ratio < config.lowVolumeRatio) multiplier *= 0.35;
  else if (ratio < 0.85) multiplier *= 0.55;
  else if (ratio < 1) multiplier *= 0.75;

  if (quoteVolume === null || quoteVolume <= 0) {
    multiplier *= 0.65;
  } else if (quoteVolume < config.minQuoteVolume24h * 0.25) {
    multiplier *= 0.45;
  } else if (quoteVolume < config.minQuoteVolume24h) {
    multiplier *= 0.65;
  }

  return clamp(multiplier, 0.12, 1);
}

function lossStreakMultiplier(streak, config) {
  if (streak >= config.maxConsecutiveLosses) return 0;
  if (streak >= config.secondLossCut) return 0.25;
  if (streak >= config.firstLossCut) return 0.5;
  return 1;
}

function dayWeekBlocks({ stats, equity, config }) {
  const dayLoss = periodLossPercent(stats?.periods?.day, equity);
  const weekLoss = periodLossPercent(stats?.periods?.week, equity);
  const blocks = [];

  if (dayLoss >= config.dailyMaxLossPercent) blocks.push(`今日亏损 ${round(dayLoss * 100, 2)}% 已触发日内最大亏损`);
  if (weekLoss >= config.weeklyMaxLossPercent) blocks.push(`本周亏损 ${round(weekLoss * 100, 2)}% 已触发周最大亏损`);

  return {
    dayLossPercent: round(dayLoss * 100, 3),
    weekLossPercent: round(weekLoss * 100, 3),
    blocks
  };
}

export function evaluatePositionRisk({
  state,
  stats,
  idea,
  config = {},
  now = Date.now()
} = {}) {
  const riskConfig = config.positionRisk ?? positionRiskConfigFromEnv();
  const equity = Math.max(1, finite(state?.equity, state?.balance ?? 1));
  const baseRisk = clamp(finite(config.riskPerTrade, 0.005), riskConfig.minRiskPerTrade, riskConfig.maxRiskPerTrade);
  const bucket = assetRiskBucket(idea?.symbol);
  const lossStreak = currentLossStreak(state?.closedTrades ?? []);
  const openPositions = state?.openPositions ?? [];
  const bucketCount = sameBucketPositions(openPositions, bucket);
  const bucketRisk = bucketOpenRisk(openPositions, bucket);
  const bucketRiskPercent = bucketRisk / equity;
  const period = dayWeekBlocks({ stats, equity, config: riskConfig });
  const multipliers = {
    volatility: volatilityMultiplier(idea, riskConfig),
    confidence: confidenceMultiplier(idea),
    riskReward: rrMultiplier(idea, riskConfig),
    liquidity: liquidityMultiplier(idea, riskConfig),
    lossStreak: lossStreakMultiplier(lossStreak, riskConfig)
  };
  const blocks = [...period.blocks];
  const warnings = [];

  if (lossStreak >= riskConfig.maxConsecutiveLosses) blocks.push(`连续亏损 ${lossStreak} 次，暂停新开仓`);
  if (bucketCount >= riskConfig.sameBucketMaxPositions) blocks.push(`${bucket} 同类持仓已达 ${bucketCount} 个`);
  if (bucketRiskPercent >= riskConfig.sameBucketMaxRiskPercent) blocks.push(`${bucket} 同类风险 ${round(bucketRiskPercent * 100, 2)}% 已达上限`);
  if (multipliers.volatility === 0) blocks.push(`ATR/价格 ${round(atrPercent(idea) * 100, 2)}% 过高`);
  if (multipliers.riskReward === 0) blocks.push(`风险收益比 ${idea?.riskReward ?? "--"} 不足`);
  if (multipliers.liquidity === 0) blocks.push("极端低流动性，禁止开仓");

  if (multipliers.lossStreak < 1 && multipliers.lossStreak > 0) warnings.push(`连续亏损 ${lossStreak} 次，自动降仓`);
  if (multipliers.volatility < 1 && multipliers.volatility > 0) warnings.push(`波动偏高，仓位缩放 ${round(multipliers.volatility * 100, 0)}%`);
  if (multipliers.confidence < 1) warnings.push(`置信度 ${idea?.confidence ?? "LOW"}，降低风险预算`);
  if (multipliers.liquidity < 1 && multipliers.liquidity > 0) warnings.push("流动性偏薄，小资金降仓执行");

  const scale = Object.values(multipliers).reduce((product, value) => product * value, 1);
  const riskFraction = riskConfig.enabled ? clamp(baseRisk * scale, 0, riskConfig.maxRiskPerTrade) : finite(config.riskPerTrade, 0.005);
  const riskAmount = equity * riskFraction;

  return {
    enabled: riskConfig.enabled,
    ok: !riskConfig.enabled || (blocks.length === 0 && riskAmount > 0),
    evaluatedAt: new Date(now).toISOString(),
    symbol: idea?.symbol,
    direction: idea?.direction,
    bucket,
    baseRiskFraction: round(baseRisk, 6),
    riskFraction: round(riskFraction, 6),
    riskAmount: round(riskAmount, 2),
    multipliers,
    consecutiveLosses: lossStreak,
    dayLossPercent: period.dayLossPercent,
    weekLossPercent: period.weekLossPercent,
    sameBucketPositions: bucketCount,
    sameBucketRiskPercent: round(bucketRiskPercent * 100, 3),
    atrPercent: round(atrPercent(idea) * 100, 3),
    volumeRatio: round(volumeRatio(idea), 3),
    quoteVolume24h: quoteVolume24h(idea),
    blocks,
    warnings,
    summary: blocks[0] ?? warnings.join("；") ?? "仓位风险检查通过"
  };
}
