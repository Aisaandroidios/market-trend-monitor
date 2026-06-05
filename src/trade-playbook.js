function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function statusFromScore(score) {
  if (score >= 0.7) return "PASS";
  if (score >= 0.45) return "WARN";
  return "FAIL";
}

function gradeFromScore(score) {
  if (score >= 0.75) return "A";
  if (score >= 0.6) return "B";
  if (score >= 0.45) return "C";
  return "D";
}

function tradeDecision(score) {
  if (score >= 0.65) return "EXECUTE";
  if (score >= 0.5) return "WATCH";
  return "WAIT_FOR_BETTER_ENTRY";
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function trendCheck({ direction, price, indicators }) {
  const ema20 = finite(indicators.ema20);
  const ema60 = finite(indicators.ema60);
  let score = 0.5;

  if (direction === "LONG") {
    score = price >= ema20 && ema20 >= ema60 ? 1 : price >= ema20 || ema20 >= ema60 ? 0.6 : 0.2;
  } else if (direction === "SHORT") {
    score = price <= ema20 && ema20 <= ema60 ? 1 : price <= ema20 || ema20 <= ema60 ? 0.6 : 0.2;
  }

  return {
    name: "趋势共振",
    score,
    status: statusFromScore(score),
    note: direction === "LONG"
      ? `价格/EMA20/EMA60 ${price >= ema20 && ema20 >= ema60 ? "多头排列" : "未完全多头排列"}`
      : `价格/EMA20/EMA60 ${price <= ema20 && ema20 <= ema60 ? "空头排列" : "未完全空头排列"}`
  };
}

function locationCheck({ direction, price, takeProfit, support, resistance, indicators }) {
  const atr = Math.max(finite(indicators.atr), price * 0.005);
  const rewardRoom = Math.abs(takeProfit - price);
  const supportDistance = Math.abs(price - support);
  const resistanceDistance = Math.abs(resistance - price);
  const directionalRoom = direction === "LONG" ? resistanceDistance : supportDistance;
  const pullbackDistance = direction === "LONG" ? supportDistance : resistanceDistance;

  const rewardCoverage = rewardRoom === 0 ? 0 : directionalRoom / rewardRoom;
  const pullbackQuality = clamp(1 - (pullbackDistance / (atr * 3)), 0, 1);
  const roomQuality = clamp(rewardCoverage / 1.2, 0, 1);
  const score = clamp((roomQuality * 0.65) + (pullbackQuality * 0.35), 0, 1);
  const chaseRisk = direction === "LONG"
    ? resistanceDistance <= atr || price > resistance - atr
    : supportDistance <= atr || price < support + atr;

  return {
    name: "位置性价比",
    score: chaseRisk ? Math.min(score, 0.3) : score,
    status: statusFromScore(chaseRisk ? Math.min(score, 0.3) : score),
    note: chaseRisk
      ? "价格已经接近目标侧关键位，追单风险高"
      : `目标侧空间约 ${round(directionalRoom / atr, 2)} ATR，入场侧距离约 ${round(pullbackDistance / atr, 2)} ATR`
  };
}

function liquidityCheck({ indicators }) {
  const volumeRatio = finite(indicators.volumeRatio, 1);
  const score = volumeRatio >= 1.2 ? 1 : volumeRatio >= 0.85 ? 0.65 : 0.25;
  return {
    name: "流动性/量能",
    score,
    status: statusFromScore(score),
    note: `当前成交量倍率 ${round(volumeRatio, 2)}`
  };
}

function volatilityCheck({ price, indicators }) {
  const atr = finite(indicators.atr);
  const atrPercent = price > 0 ? atr / price : 0;
  const score = atrPercent >= 0.004 && atrPercent <= 0.06
    ? 1
    : atrPercent <= 0.1
      ? 0.55
      : 0.25;
  return {
    name: "波动可控",
    score,
    status: statusFromScore(score),
    note: `ATR/价格 ${round(atrPercent * 100, 2)}%`
  };
}

function invalidationCheck({ price, stopLoss, takeProfit }) {
  const stopDistance = Math.abs(price - stopLoss);
  const targetDistance = Math.abs(takeProfit - price);
  const stopPercent = price > 0 ? stopDistance / price : 0;
  const riskReward = stopDistance === 0 ? 0 : targetDistance / stopDistance;
  const stopQuality = stopPercent >= 0.004 && stopPercent <= 0.06 ? 1 : stopPercent <= 0.1 ? 0.55 : 0.25;
  const rrQuality = riskReward >= 1.8 ? 1 : riskReward >= 1.2 ? 0.65 : 0.25;
  const score = (stopQuality * 0.45) + (rrQuality * 0.55);

  return {
    name: "失效位/盈亏比",
    score,
    status: statusFromScore(score),
    note: `止损距离 ${round(stopPercent * 100, 2)}%，风险收益比 ${round(riskReward, 2)}`
  };
}

function momentumCheck({ direction, indicators }) {
  const rsi = finite(indicators.rsi, 50);
  let score = 0.5;
  if (direction === "LONG") {
    score = rsi >= 45 && rsi <= 68 ? 1 : rsi > 72 ? 0.25 : 0.55;
  } else if (direction === "SHORT") {
    score = rsi >= 32 && rsi <= 55 ? 1 : rsi < 25 ? 0.25 : 0.55;
  }

  return {
    name: "动量不过热",
    score,
    status: statusFromScore(score),
    note: `RSI ${round(rsi, 2)}`
  };
}

export function buildProfessionalTradePlaybook({
  symbol,
  direction,
  price,
  takeProfit,
  stopLoss,
  support,
  resistance,
  indicators = {}
} = {}) {
  if (!["LONG", "SHORT"].includes(direction)) return null;

  const checks = [
    trendCheck({ direction, price, indicators }),
    locationCheck({ direction, price, takeProfit, support, resistance, indicators }),
    liquidityCheck({ indicators }),
    volatilityCheck({ price, indicators }),
    invalidationCheck({ price, stopLoss, takeProfit }),
    momentumCheck({ direction, indicators })
  ];
  const rawScore = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;
  const failCount = checks.filter((check) => check.status === "FAIL").length;
  const hasLocationFail = checks.some((check) => check.name === "位置性价比" && check.status === "FAIL");
  const adjustedScore = clamp(rawScore - (failCount * 0.06), 0, hasLocationFail ? 0.45 : 1);
  const score = round(adjustedScore, 3);
  const grade = gradeFromScore(score);
  const decision = tradeDecision(score);
  const risks = checks
    .filter((check) => check.status === "FAIL")
    .map((check) => {
      if (check.name === "位置性价比") return `位置性价比不合格：${check.note}，不要追单。`;
      return `${check.name}不合格：${check.note}`;
    });
  const strengths = checks
    .filter((check) => check.status === "PASS")
    .map((check) => `${check.name}: ${check.note}`);

  return {
    symbol,
    direction,
    score,
    grade,
    decision,
    checks,
    strengths,
    risks,
    summary: `执行质量 ${grade}，${decision === "EXECUTE" ? "允许按计划执行" : decision === "WATCH" ? "观察等待确认" : "等待更好入场"}。`
  };
}
