import {
  averageTrueRange,
  bollingerBands,
  exponentialMovingAverage,
  macd,
  movingAverage,
  relativeStrengthIndex,
  supportResistance
} from "./indicators.js";
import { buildProfessionalTradePlaybook } from "./trade-playbook.js";

let binanceKlineBackoffUntil = Number(process.env.BINANCE_KLINE_BACKOFF_UNTIL ?? 0);
const hyperliquidCoinBySymbol = new Map(Object.entries({
  BTCUSDT: "BTC",
  ETHUSDT: "ETH",
  SOLUSDT: "SOL",
  BNBUSDT: "BNB",
  XRPUSDT: "XRP",
  DOGEUSDT: "DOGE",
  ADAUSDT: "ADA",
  AVAXUSDT: "AVAX",
  LINKUSDT: "LINK",
  NEARUSDT: "NEAR",
  ZECUSDT: "ZEC",
  WLDUSDT: "WLD",
  HYPEUSDT: "HYPE",

  QQQUSDT: "xyz:XYZ100",
  XYZ100USDT: "xyz:XYZ100",
  SPYUSDT: "xyz:SP500",
  SP500USDT: "xyz:SP500",

  AAPLUSDT: "xyz:AAPL",
  APPLEUSDT: "xyz:AAPL",
  MSFTUSDT: "xyz:MSFT",
  NVDAUSDT: "xyz:NVDA",
  TSLAUSDT: "xyz:TSLA",
  ORCLUSDT: "xyz:ORCL",
  AMDUSDT: "xyz:AMD",
  GOOGUSDT: "xyz:GOOGL",
  GOOGLUSDT: "xyz:GOOGL",
  METAUSDT: "xyz:META",
  MUUSDT: "xyz:MU",
  MRVLUSDT: "xyz:MRVL",
  INTCUSDT: "xyz:INTC",
  AVGOUSDT: "xyz:AVGO",
  TSMUSDT: "xyz:TSM",
  ARMUSDT: "xyz:ARM",
  IBMUSDT: "xyz:IBM",
  SNDKUSDT: "xyz:SNDK",
  CRCLUSDT: "xyz:CRCL",
  SPCXUSDT: "xyz:SPCX",
  DELLUSDT: "xyz:DELL",
  MSTRUSDT: "xyz:MSTR",
  EWYUSDT: "xyz:EWY",
  COINUSDT: "xyz:COIN",

  XAUUSDT: "xyz:GOLD",
  GOLDUSDT: "xyz:GOLD",
  XAGUSDT: "xyz:SILVER",
  SILVERUSDT: "xyz:SILVER",
  CLUSDT: "xyz:CL",
  WTIOILUSDT: "xyz:CL",
  BRENTOILUSDT: "xyz:BRENTOIL"
}));
const intervalMs = {
  "1m": 60000,
  "3m": 180000,
  "5m": 300000,
  "15m": 900000,
  "30m": 1800000,
  "1h": 3600000,
  "2h": 7200000,
  "4h": 14400000,
  "8h": 28800000,
  "12h": 43200000,
  "1d": 86400000
};

export function parseBinanceKlines(rawKlines) {
  return rawKlines.map((kline) => ({
    openTime: Number(kline[0]),
    open: Number(kline[1]),
    high: Number(kline[2]),
    low: Number(kline[3]),
    close: Number(kline[4]),
    volume: Number(kline[5]),
    closeTime: Number(kline[6])
  }));
}

export function parseBinanceFutures24hTickers(rawTickers) {
  const tickers = Array.isArray(rawTickers) ? rawTickers : [rawTickers];
  return tickers
    .map((ticker) => ({
      symbol: String(ticker.symbol ?? "").toUpperCase(),
      quoteVolume: Number(ticker.quoteVolume ?? 0),
      volume: Number(ticker.volume ?? 0),
      priceChangePercent: Number(ticker.priceChangePercent ?? 0)
    }))
    .filter((ticker) => ticker.symbol && Number.isFinite(ticker.quoteVolume));
}

function roundPrice(value) {
  if (value >= 1000) return Number(value.toFixed(2));
  if (value >= 1) return Number(value.toFixed(4));
  return Number(value.toFixed(8));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseBinanceBanUntil(message) {
  const match = String(message).match(/banned until (\d+)/i);
  return match ? Number(match[1]) : 0;
}

export function resetBinanceKlineBackoff() {
  binanceKlineBackoffUntil = 0;
}

function listFromEnv(value, fallback) {
  if (!value) return fallback;
  const items = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function cleanBaseUrl(baseUrl) {
  return String(baseUrl).replace(/\/+$/, "");
}

function defaultBinanceFuturesBaseUrls() {
  return listFromEnv(process.env.BINANCE_FUTURES_BASE_URLS, [
    "https://fapi.binance.com",
    "https://fapi1.binance.com",
    "https://fapi2.binance.com",
    "https://fapi3.binance.com",
    "https://fapi4.binance.com"
  ]);
}

function hyperliquidCoinForSymbol(symbol) {
  return hyperliquidCoinBySymbol.get(symbol) ?? null;
}

export function hyperliquidCoinForDecisionSymbol(symbol) {
  return hyperliquidCoinForSymbol(symbol);
}

function fallbackVolumeSymbols(ticker) {
  const symbol = String(ticker.symbol ?? "").toUpperCase();
  const market = String(ticker.market ?? "").toLowerCase();
  const symbols = new Set([symbol]);

  if (market === "stocks" && !symbol.endsWith("USDT")) {
    symbols.add(`${symbol}USDT`);
  }

  if (symbol === "GOOG") symbols.add("GOOGLUSDT");
  if (symbol === "GOOGL") symbols.add("GOOGUSDT");
  if (symbol === "XAUUSD") symbols.add("XAUUSDT");
  if (symbol === "XAGUSD") symbols.add("SILVERUSDT");
  if (symbol === "CL.F") symbols.add("CLUSDT");
  if (symbol === "BZUSDT" || symbol === "BRENTOIL") symbols.add("BRENTOILUSDT");

  return symbols;
}

export function rankSymbolsByDailyVolume({ symbols, futuresStats = [], fallbackTickers = [] }) {
  const volumeBySymbol = new Map();

  for (const ticker of fallbackTickers) {
    const quoteVolume = Number(ticker.quoteVolume ?? 0);
    if (!Number.isFinite(quoteVolume) || quoteVolume <= 0) continue;

    for (const symbol of fallbackVolumeSymbols(ticker)) {
      volumeBySymbol.set(symbol, Math.max(volumeBySymbol.get(symbol) ?? 0, quoteVolume));
    }
  }

  for (const stat of futuresStats) {
    const symbol = String(stat.symbol ?? "").toUpperCase();
    const quoteVolume = Number(stat.quoteVolume ?? 0);
    if (!symbol || !Number.isFinite(quoteVolume) || quoteVolume < 0) continue;
    volumeBySymbol.set(symbol, quoteVolume);
  }

  return symbols
    .map((symbol, index) => ({
      symbol,
      index,
      quoteVolume: volumeBySymbol.get(symbol) ?? 0
    }))
    .sort((left, right) => right.quoteVolume - left.quoteVolume || left.index - right.index)
    .map((item) => item.symbol);
}

function parseHyperliquidCandles(rawCandles) {
  return rawCandles.map((candle) => ({
    openTime: Number(candle.t),
    open: Number(candle.o),
    high: Number(candle.h),
    low: Number(candle.l),
    close: Number(candle.c),
    volume: Number(candle.v),
    closeTime: Number(candle.T)
  }));
}

function withCandleDataSource(candles, dataSource) {
  Object.defineProperty(candles, "dataSource", {
    value: dataSource,
    enumerable: false,
    configurable: true
  });
  return candles;
}

async function fetchHyperliquidCandles({
  symbol,
  interval,
  limit,
  hyperliquidUrl = process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info",
  fetchImpl
}) {
  const coin = hyperliquidCoinForSymbol(symbol);
  const durationMs = intervalMs[interval];
  if (!coin || !durationMs) {
    throw new Error(`No DEX candle fallback available for ${symbol} ${interval}`);
  }

  const endTime = Date.now();
  const startTime = endTime - (limit * durationMs);
  const response = await fetchImpl(hyperliquidUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: {
        coin,
        interval,
        startTime,
        endTime
      }
    })
  });
  if (!response.ok) {
    const body = typeof response.text === "function" ? await response.text() : "";
    throw new Error(`Hyperliquid candles ${symbol} returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  return withCandleDataSource(parseHyperliquidCandles(await response.json()).slice(-limit), {
    provider: "Hyperliquid USDC Perps",
    exchange: "Hyperliquid",
    reference: "info/candleSnapshot",
    quoteSymbol: coin,
    interval
  });
}

async function fetchBinanceFuturesCandles({
  symbol,
  interval,
  limit,
  binanceFuturesBaseUrls = defaultBinanceFuturesBaseUrls(),
  fetchImpl
}) {
  if (Date.now() < binanceKlineBackoffUntil) {
    throw new Error(`Binance futures klines backed off until ${new Date(binanceKlineBackoffUntil).toISOString()}`);
  }

  const errors = [];
  for (const baseUrl of binanceFuturesBaseUrls) {
    const url = `${cleanBaseUrl(baseUrl)}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
    const response = await fetchImpl(url);
    if (response.ok) {
      return withCandleDataSource(parseBinanceKlines(await response.json()), {
        provider: "Binance USD-M Futures",
        exchange: "Binance",
        reference: "fapi/v1/klines",
        quoteSymbol: symbol,
        interval
      });
    }

    const body = typeof response.text === "function" ? await response.text() : "";
    errors.push(`HTTP ${response.status}${body ? `: ${body}` : ""}`);

    if (response.status === 418) {
      const bannedUntil = parseBinanceBanUntil(body);
      if (bannedUntil > Date.now()) binanceKlineBackoffUntil = bannedUntil;
      break;
    }
  }

  throw new Error(`Binance klines ${symbol} failed: ${errors.join(" | ")}`);
}

export async function fetchBinanceFutures24hStats({
  symbols = [],
  binanceFuturesBaseUrls = defaultBinanceFuturesBaseUrls(),
  fetchImpl = globalThis.fetch
}) {
  const allowedSymbols = new Set(symbols.map((symbol) => String(symbol).toUpperCase()));
  const errors = [];

  for (const baseUrl of binanceFuturesBaseUrls) {
    const url = `${cleanBaseUrl(baseUrl)}/fapi/v1/ticker/24hr`;
    const response = await fetchImpl(url);
    if (response.ok) {
      const stats = parseBinanceFutures24hTickers(await response.json());
      return allowedSymbols.size === 0
        ? stats
        : stats.filter((stat) => allowedSymbols.has(stat.symbol));
    }

    const body = typeof response.text === "function" ? await response.text() : "";
    errors.push(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  throw new Error(`Binance futures 24h ticker stats failed: ${errors.join(" | ")}`);
}

function scoreLong({ price, ema20, ema60, rsi, macdValue, volumeRatio, newsScore, moneyFlow }) {
  let score = 0;
  if (price > ema20) score += 1;
  if (ema20 > ema60) score += 1;
  if (macdValue.histogram > 0) score += 1;
  if (rsi >= 45 && rsi <= 72) score += 1;
  if (volumeRatio > 1.05) score += 0.5;
  if (newsScore > 0) score += 0.5;
  if (moneyFlow?.biasDirection === "LONG") score += 0.5;
  if (moneyFlow?.biasDirection === "SHORT") score -= 0.25;
  return score;
}

function scoreShort({ price, ema20, ema60, rsi, macdValue, volumeRatio, newsScore, moneyFlow }) {
  let score = 0;
  if (price < ema20) score += 1;
  if (ema20 < ema60) score += 1;
  if (macdValue.histogram < 0) score += 1;
  if (rsi >= 28 && rsi <= 55) score += 1;
  if (volumeRatio > 1.05) score += 0.5;
  if (newsScore < 0) score += 0.5;
  if (moneyFlow?.biasDirection === "SHORT") score += 0.5;
  if (moneyFlow?.biasDirection === "LONG") score -= 0.25;
  return score;
}

function buildMoneyFlowInsight({ candles = [], futuresStat = null, volumeRatio = 1, direction = "NEUTRAL" } = {}) {
  const recentCandles = candles.slice(-12);
  let inflowQuote = 0;
  let outflowQuote = 0;

  for (const candle of recentCandles) {
    const close = finiteNumber(candle.close);
    const open = finiteNumber(candle.open);
    const high = finiteNumber(candle.high, close);
    const low = finiteNumber(candle.low, close);
    const volume = finiteNumber(candle.volume);
    const typicalPrice = (high + low + close) / 3;
    const quoteTurnover = Math.max(0, typicalPrice * volume);

    if (close > open) inflowQuote += quoteTurnover;
    if (close < open) outflowQuote += quoteTurnover;
  }

  const totalQuote = inflowQuote + outflowQuote;
  const netFlowPercent = totalQuote === 0 ? 0 : Number((((inflowQuote - outflowQuote) / totalQuote) * 100).toFixed(2));
  const biasDirection = netFlowPercent >= 8 ? "LONG" : netFlowPercent <= -8 ? "SHORT" : "NEUTRAL";
  const status = biasDirection === "LONG" ? "inflow" : biasDirection === "SHORT" ? "outflow" : "neutral";
  const alignment = direction !== "NEUTRAL" && biasDirection !== "NEUTRAL"
    ? biasDirection === direction ? "aligned" : "against"
    : "neutral";
  const flowText = status === "inflow" ? "流入" : status === "outflow" ? "流出" : "中性";
  const supportText = alignment === "aligned"
    ? `方向支持 ${direction}`
    : alignment === "against"
      ? `方向压制 ${direction}`
      : "方向未确认";

  return {
    status,
    biasDirection,
    netFlowPercent,
    volumeRatio: Number(finiteNumber(volumeRatio, 1).toFixed(2)),
    quoteVolume24h: finiteNumber(futuresStat?.quoteVolume, null),
    priceChange24h: finiteNumber(futuresStat?.priceChangePercent, null),
    alignment,
    detail: `近12根K线资金偏${flowText}，${supportText}。`
  };
}

export function buildTradeIdea({
  symbol,
  market,
  price,
  candles,
  newsScore = 0,
  news = null,
  dataSource = candles?.dataSource,
  currentQuote = null,
  futuresStat = null,
  generatedAt = Date.now()
}) {
  const quote = currentQuote ?? (dataSource ? {
    exchange: dataSource.exchange,
    source: dataSource.provider,
    symbol: dataSource.quoteSymbol ?? symbol,
    price: roundPrice(price)
  } : null);

  if (candles.length < 30) {
    return {
      symbol,
      market,
      dataSource,
      currentQuote: quote,
      action: "WAIT",
      direction: "NEUTRAL",
      reason: "Not enough candle history for a decision",
      generatedAt: new Date(generatedAt).toISOString()
    };
  }

  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const ema20 = exponentialMovingAverage(closes, 20).at(-1);
  const ema60 = exponentialMovingAverage(closes, 60).at(-1);
  const rsi = relativeStrengthIndex(closes, 14);
  const macdValue = macd(closes);
  const atr = averageTrueRange(candles, 14);
  const bands = bollingerBands(closes, 20, 2);
  const levels = supportResistance(candles, 80);
  const averageVolume = movingAverage(volumes, 20);
  const volumeRatio = averageVolume === 0 ? 1 : volumes.at(-1) / averageVolume;
  const directionalMoneyFlow = buildMoneyFlowInsight({ candles, futuresStat, volumeRatio });

  const longScore = scoreLong({ price, ema20, ema60, rsi, macdValue, volumeRatio, newsScore, moneyFlow: directionalMoneyFlow });
  const shortScore = scoreShort({ price, ema20, ema60, rsi, macdValue, volumeRatio, newsScore, moneyFlow: directionalMoneyFlow });
  const direction = longScore > shortScore ? "LONG" : shortScore > longScore ? "SHORT" : "NEUTRAL";
  const score = Math.max(longScore, shortScore);
  const action = direction === "LONG" ? "BUY" : direction === "SHORT" ? "SELL" : "WAIT";
  const moneyFlow = {
    ...directionalMoneyFlow,
    alignment: direction !== "NEUTRAL" && directionalMoneyFlow.biasDirection !== "NEUTRAL"
      ? directionalMoneyFlow.biasDirection === direction ? "aligned" : "against"
      : "neutral",
    detail: buildMoneyFlowInsight({ candles, futuresStat, volumeRatio, direction }).detail
  };

  const stopDistance = Math.max(atr * 1.5, price * 0.01);
  const targetDistance = stopDistance * 2;
  const stopLoss = direction === "LONG"
    ? price - stopDistance
    : direction === "SHORT"
      ? price + stopDistance
      : price;
  const takeProfit = direction === "LONG"
    ? price + targetDistance
    : direction === "SHORT"
      ? price - targetDistance
      : price;
  const riskReward = stopDistance === 0 ? 0 : targetDistance / stopDistance;
  const winProbability = direction === "NEUTRAL"
    ? 0.5
    : clamp(0.45 + (score * 0.045) + (Math.abs(newsScore) * 0.05), 0.45, 0.78);
  const roundedEntry = roundPrice(price);
  const roundedTakeProfit = roundPrice(takeProfit);
  const roundedStopLoss = roundPrice(stopLoss);
  const roundedSupport = roundPrice(levels.support);
  const roundedResistance = roundPrice(levels.resistance);
  const roundedIndicators = {
    ema20: roundPrice(ema20),
    ema60: roundPrice(ema60),
    rsi: Number(rsi.toFixed(2)),
    macd: Number(macdValue.macd.toFixed(6)),
    macdSignal: Number(macdValue.signal.toFixed(6)),
    macdHistogram: Number(macdValue.histogram.toFixed(6)),
    atr: roundPrice(atr),
    bollingerUpper: roundPrice(bands.upper),
    bollingerMiddle: roundPrice(bands.middle),
    bollingerLower: roundPrice(bands.lower),
    volumeRatio: Number(volumeRatio.toFixed(2)),
    newsScore: Number(newsScore.toFixed(2))
  };
  const tradePlaybook = buildProfessionalTradePlaybook({
    symbol,
    direction,
    price: roundedEntry,
    takeProfit: roundedTakeProfit,
    stopLoss: roundedStopLoss,
    support: roundedSupport,
    resistance: roundedResistance,
    indicators: roundedIndicators
  });

  return {
    id: `${market}:${symbol}:${direction}:${generatedAt}`,
    symbol,
    market,
    news,
    dataSource,
    currentQuote: quote,
    moneyFlow,
    tradePlaybook,
    action,
    direction,
    entry: roundedEntry,
    takeProfit: roundedTakeProfit,
    stopLoss: roundedStopLoss,
    riskReward: Number(riskReward.toFixed(2)),
    winProbability: Number(winProbability.toFixed(2)),
    support: roundedSupport,
    resistance: roundedResistance,
    indicators: roundedIndicators,
    reason: [
      `EMA20 ${ema20 > ema60 ? "above" : "below"} EMA60`,
      `RSI ${rsi.toFixed(2)}`,
      `MACD histogram ${macdValue.histogram.toFixed(4)}`,
      `news score ${newsScore.toFixed(2)}`
    ].join("; "),
    generatedAt: new Date(generatedAt).toISOString()
  };
}

export async function fetchBinanceCandles({
  symbol,
  interval = "1h",
  limit = 120,
  market = "spot",
  fetchImpl = globalThis.fetch,
  binanceFuturesBaseUrls,
  dexFallback = true,
  hyperliquidUrl
}) {
  if (market === "futures") {
    try {
      return await fetchBinanceFuturesCandles({
        symbol,
        interval,
        limit,
        binanceFuturesBaseUrls,
        fetchImpl
      });
    } catch (error) {
      if (!dexFallback) throw error;
      return fetchHyperliquidCandles({
        symbol,
        interval,
        limit,
        hyperliquidUrl,
        fetchImpl
      });
    }
  }

  const baseUrl = "https://api.binance.com/api/v3/klines";
  const url = `${baseUrl}?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    const body = typeof response.text === "function" ? await response.text() : "";
    if (market === "futures" && response.status === 418) {
      const bannedUntil = parseBinanceBanUntil(body);
      if (bannedUntil > Date.now()) binanceKlineBackoffUntil = bannedUntil;
    }

    throw new Error(`Binance klines ${symbol} returned HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  return parseBinanceKlines(await response.json());
}

export async function fetchBinanceCandlesConcurrent({
  symbols,
  interval = "1h",
  limit = 120,
  market = "spot",
  concurrency = 6,
  fetchImpl = globalThis.fetch,
  binanceFuturesBaseUrls,
  dexFallback = true,
  hyperliquidUrl
}) {
  const results = new Array(symbols.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, symbols.length));

  async function worker() {
    while (nextIndex < symbols.length) {
      const index = nextIndex;
      nextIndex += 1;
      const symbol = symbols[index];

      try {
        const candles = await fetchBinanceCandles({
          symbol,
          interval,
          limit,
          market,
          fetchImpl,
          binanceFuturesBaseUrls,
          dexFallback,
          hyperliquidUrl
        });
        results[index] = { symbol, candles, dataSource: candles.dataSource };
      } catch (error) {
        results[index] = {
          symbol,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
