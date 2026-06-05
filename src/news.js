const cryptoBases = new Set([
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "LINK",
  "ZEC",
  "NEAR",
  "WLD"
]);
const newsScoreCache = new Map();

function baseSymbol(symbol) {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function alphaVantageTicker(symbol) {
  const base = baseSymbol(symbol);
  return cryptoBases.has(base) ? `CRYPTO:${base}` : base;
}

function envNumber(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) ? value : fallback;
}

async function fetchWithTimeout(url, { fetchImpl, timeoutMs }) {
  let timer = null;
  try {
    return await Promise.race([
      fetchImpl(url),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("news_provider_timeout")), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cacheKey(symbol, env) {
  const provider = env.ALPHA_VANTAGE_API_KEY ? "alpha" : env.FINNHUB_API_KEY ? "finnhub" : "none";
  return `${provider}:${symbol}`;
}

function cachedNewsInsight({ symbol, env, now, ttlMs }) {
  if (ttlMs <= 0) return null;

  const cached = newsScoreCache.get(cacheKey(symbol, env));
  if (!cached) return null;
  if (now - cached.updatedAt > ttlMs) return null;
  return cached.insight;
}

function rememberNewsInsight({ symbol, env, now, ttlMs, insight }) {
  if (ttlMs <= 0) return;
  newsScoreCache.set(cacheKey(symbol, env), { insight, updatedAt: now });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function extractAlphaVantageSentiment(payload) {
  const scores = (payload.feed ?? [])
    .map((item) => Number(item.overall_sentiment_score))
    .filter(Number.isFinite);

  if (scores.length === 0) return 0;
  return clamp(scores.reduce((sum, score) => sum + score, 0) / scores.length, -1, 1);
}

export function extractFinnhubSentiment(payload) {
  const score = Number(payload.sentiment?.bullishPercent) - Number(payload.sentiment?.bearishPercent);
  return Number.isFinite(score) ? Number(clamp(score, -1, 1).toFixed(4)) : 0;
}

function alphaVantageInsightFromPayload(payload) {
  if (payload.Information || payload.Note) return null;

  const score = extractAlphaVantageSentiment(payload);
  const feedCount = payload.feed?.length ?? 0;
  return {
    score,
    source: "Alpha Vantage",
    status: Math.abs(score) >= 0.05 ? "scored" : "neutral",
    detail: feedCount > 0
      ? `${feedCount}条，${score > 0 ? "偏多" : score < 0 ? "偏空" : "中性"}`
      : "中性"
  };
}

function finnhubInsightFromPayload(payload) {
  if (!payload.sentiment) return null;

  const score = extractFinnhubSentiment(payload);
  return {
    score,
    source: "Finnhub",
    status: Math.abs(score) >= 0.05 ? "scored" : "neutral",
    detail: score > 0 ? "偏多" : score < 0 ? "偏空" : "中性"
  };
}

async function alphaVantageNewsInsight({ symbol, apiKey, fetchImpl, timeoutMs }) {
  const ticker = alphaVantageTicker(symbol);
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, { fetchImpl, timeoutMs });
  if (!response.ok) return null;
  return alphaVantageInsightFromPayload(await response.json());
}

async function finnhubNewsInsight({ symbol, apiKey, fetchImpl, timeoutMs }) {
  const ticker = baseSymbol(symbol);
  const url = `https://finnhub.io/api/v1/news-sentiment?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, { fetchImpl, timeoutMs });
  if (!response.ok) return null;
  return finnhubInsightFromPayload(await response.json());
}

export async function getNewsInsight({
  symbol,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now()
}) {
  const timeoutMs = envNumber(env, "NEWS_TIMEOUT_MS", 1200);
  const cacheTtlMs = envNumber(env, "NEWS_CACHE_TTL_MS", 3600000);
  const cached = cachedNewsInsight({ symbol, env, now, ttlMs: cacheTtlMs });
  if (cached !== null) return cached;

  try {
    if (env.ALPHA_VANTAGE_API_KEY) {
      const alphaInsight = await alphaVantageNewsInsight({
        symbol,
        apiKey: env.ALPHA_VANTAGE_API_KEY,
        fetchImpl,
        timeoutMs
      });
      if (alphaInsight !== null) {
        rememberNewsInsight({ symbol, env, now, ttlMs: cacheTtlMs, insight: alphaInsight });
        return alphaInsight;
      }
    }

    if (env.FINNHUB_API_KEY) {
      const finnhubInsight = await finnhubNewsInsight({
        symbol,
        apiKey: env.FINNHUB_API_KEY,
        fetchImpl,
        timeoutMs
      });
      if (finnhubInsight !== null) {
        rememberNewsInsight({ symbol, env, now, ttlMs: cacheTtlMs, insight: finnhubInsight });
        return finnhubInsight;
      }
    }
  } catch {
    return {
      score: 0,
      source: "news",
      status: "timeout",
      detail: "超时按中性"
    };
  }

  return {
    score: 0,
    source: env.ALPHA_VANTAGE_API_KEY || env.FINNHUB_API_KEY ? "Alpha Vantage/Finnhub" : "none",
    status: env.ALPHA_VANTAGE_API_KEY || env.FINNHUB_API_KEY ? "unavailable" : "unconfigured",
    detail: env.ALPHA_VANTAGE_API_KEY || env.FINNHUB_API_KEY
      ? "不可用按中性"
      : "未配置"
  };
}

export async function getNewsScore(options) {
  return (await getNewsInsight(options)).score;
}
