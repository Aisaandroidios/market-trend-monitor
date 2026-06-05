function roundPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  if (Math.abs(number) >= 1000) return Number(number.toFixed(2));
  if (Math.abs(number) >= 1) return Number(number.toFixed(4));
  return Number(number.toFixed(8));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function syntheticAtr(ticker) {
  const price = Number(ticker.price ?? 0);
  const high = Number(ticker.high ?? 0);
  const low = Number(ticker.low ?? 0);
  const open = Number(ticker.open ?? 0);
  const range = high > 0 && low > 0 && high > low ? high - low : 0;
  const openMove = open > 0 ? Math.abs(price - open) : 0;
  const fallback = price * 0.018;
  return Math.max(range * 0.55, openMove * 0.9, fallback);
}

function supportResistance(ticker, atr) {
  const price = Number(ticker.price ?? 0);
  const high = Number(ticker.high ?? 0);
  const low = Number(ticker.low ?? 0);

  return {
    support: roundPrice(low > 0 ? Math.min(low, price - atr) : price - atr),
    resistance: roundPrice(high > 0 ? Math.max(high, price + atr) : price + atr)
  };
}

function snapshotRiskReward({ direction, price, atr, support, resistance, changePercent, quoteVolume }) {
  if (!["LONG", "SHORT"].includes(direction)) return 0;

  const directionalRoom = direction === "LONG" ? resistance - price : price - support;
  const roomRatio = atr > 0 ? directionalRoom / atr : 1;
  const momentum = clamp(Math.abs(changePercent) / 3, 0, 1);
  const liquidity = quoteVolume > 50_000_000 ? 0.22 : quoteVolume > 5_000_000 ? 0.12 : 0;
  const roomCap = clamp(roomRatio - 0.15, 0.8, 2.4);
  const desired = 1.05 + (momentum * 0.45) + liquidity;

  return Number(clamp(desired, 0.85, Math.max(0.85, roomCap)).toFixed(2));
}

function directionFromTicker(ticker) {
  const changePercent = Number(ticker.changePercent ?? 0);
  const price = Number(ticker.price ?? 0);
  const open = Number(ticker.open ?? 0);
  const openBias = open > 0 ? ((price - open) / open) * 100 : changePercent;

  if (changePercent >= 0.45 && openBias >= 0.2) return "LONG";
  if (changePercent <= -0.45 && openBias <= -0.2) return "SHORT";
  return "NEUTRAL";
}

function topicSymbolFromTicker(ticker) {
  if (ticker.market === "commodities") {
    if (ticker.symbol === "XAUUSD" || ticker.symbol === "GLD") return "XAUUSD";
    if (ticker.symbol === "XAGUSD") return "XAGUSD";
    if (ticker.symbol === "CL.F" || ticker.symbol === "USO") return "CL.F";
  }

  return String(ticker.symbol ?? "").endsWith("USDT")
    ? ticker.symbol
    : `${ticker.symbol}USDT`;
}

function quoteSymbolFromTicker(ticker, symbol) {
  if (ticker.market === "commodities" && ["XAUUSD", "XAGUSD", "CL.F"].includes(symbol)) return symbol;
  return ticker.sourceSymbol ?? ticker.symbol ?? symbol;
}

export function buildSnapshotTradeIdea({
  ticker,
  symbol = topicSymbolFromTicker(ticker),
  generatedAt = Date.now()
} = {}) {
  if (!ticker || !Number.isFinite(Number(ticker.price)) || Number(ticker.price) <= 0) return null;

  const direction = directionFromTicker(ticker);
  const price = Number(ticker.price);
  const atr = syntheticAtr(ticker);
  const { support, resistance } = supportResistance(ticker, atr);
  let action = direction === "LONG" ? "BUY" : direction === "SHORT" ? "SELL" : "WAIT";
  const changePercent = Number(ticker.changePercent ?? 0);
  const quoteVolume = Number(ticker.quoteVolume ?? 0);
  const riskReward = snapshotRiskReward({
    direction,
    price,
    atr,
    support,
    resistance,
    changePercent,
    quoteVolume
  });
  const takeProfit = direction === "LONG"
    ? roundPrice(price + (atr * riskReward))
    : direction === "SHORT"
      ? roundPrice(price - (atr * riskReward))
      : roundPrice(price);
  const stopLoss = direction === "LONG"
    ? roundPrice(price - atr)
    : direction === "SHORT"
      ? roundPrice(price + atr)
      : roundPrice(price);
  if (riskReward < 1.15) action = "WAIT";
  const volumeRatio = quoteVolume > 0 ? 1.05 : 0.85;
  const moneyFlowDirection = direction === "LONG" ? "LONG" : direction === "SHORT" ? "SHORT" : "NEUTRAL";

  return {
    symbol,
    market: ticker.market ?? "snapshot",
    direction,
    action,
    entry: roundPrice(price),
    takeProfit,
    stopLoss,
    riskReward,
    winProbability: direction === "NEUTRAL" ? 0.5 : Math.min(0.63, 0.54 + (Math.min(Math.abs(changePercent), 3) * 0.03)),
    support,
    resistance,
    indicators: {
      ema20: direction === "LONG" ? price + (atr * 0.15) : direction === "SHORT" ? price - (atr * 0.15) : price,
      ema60: direction === "LONG" ? price - (atr * 0.15) : direction === "SHORT" ? price + (atr * 0.15) : price,
      rsi: direction === "LONG" ? 58 : direction === "SHORT" ? 42 : 50,
      macdHistogram: direction === "LONG" ? Number((atr / Math.max(price, 1)).toFixed(6)) : direction === "SHORT" ? Number((-atr / Math.max(price, 1)).toFixed(6)) : 0,
      atr: roundPrice(atr),
      volumeRatio,
      newsScore: 0
    },
    moneyFlow: {
      status: direction === "LONG" ? "inflow" : direction === "SHORT" ? "outflow" : "neutral",
      biasDirection: moneyFlowDirection,
      netFlowPercent: changePercent,
      volumeRatio,
      quoteVolume24h: Number(ticker.quoteVolume ?? 0),
      priceChange24h: changePercent,
      alignment: direction === "NEUTRAL" ? "neutral" : "aligned",
      detail: `${ticker.provider ?? "snapshot"} 快照显示涨跌 ${changePercent.toFixed(2)}%，按降级资金流向处理。`
    },
    dataSource: {
      provider: ticker.provider ?? "snapshot",
      exchange: ticker.provider ?? "snapshot",
      reference: "quote_snapshot",
      quoteSymbol: quoteSymbolFromTicker(ticker, symbol),
      interval: "snapshot"
    },
    currentQuote: {
      exchange: ticker.provider ?? "snapshot",
      source: ticker.provider ?? "snapshot",
      symbol: quoteSymbolFromTicker(ticker, symbol),
      price: roundPrice(price)
    },
    news: {
      score: 0,
      source: "news",
      status: "neutral",
      detail: "快照降级策略未绑定实时新闻，新闻面按中性。"
    },
    tradePlaybook: {
      score: direction === "NEUTRAL" ? 0.35 : 0.58,
      grade: direction === "NEUTRAL" ? "D" : "C",
      decision: direction === "NEUTRAL" ? "WATCH" : "WATCH",
      summary: "快照降级策略，允许观察，不按完整K线高置信执行。",
      checks: [
        { name: "快照方向", status: direction === "NEUTRAL" ? "WARN" : "PASS", note: `日内涨跌 ${changePercent.toFixed(2)}%` },
        { name: "数据完整度", status: "WARN", note: "使用报价快照，不是完整1h K线" }
      ],
      risks: ["快照策略缺少完整K线结构，仓位必须更轻。"]
    },
    tradePlan: {
      modelAdjusted: false,
      summary: `快照动态RR ${riskReward}，按日内波动、成交额和支撑压力空间保守估算。`
    },
    generatedAt: new Date(generatedAt).toISOString(),
    reason: `snapshot ${ticker.provider ?? "quote"} change ${changePercent.toFixed(2)}%; active fallback data`
  };
}
