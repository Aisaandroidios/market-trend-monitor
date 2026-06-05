function clamp(value, min = -1, max = 1) {
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

function listFromEnv(value, fallback) {
  if (!value) return fallback;
  const list = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return list.length ? list : fallback;
}

function enabled(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function cleanBaseUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function binanceFuturesBaseUrls() {
  return listFromEnv(process.env.BINANCE_FUTURES_BASE_URLS, [
    "https://fapi.binance.com",
    "https://fapi1.binance.com",
    "https://fapi2.binance.com",
    "https://fapi3.binance.com",
    "https://fapi4.binance.com"
  ]);
}

async function fetchJsonFromBases({ path, query = {}, baseUrls = binanceFuturesBaseUrls(), fetchImpl = globalThis.fetch }) {
  const params = new URLSearchParams(query);
  const errors = [];

  for (const baseUrl of baseUrls) {
    const url = `${cleanBaseUrl(baseUrl)}${path}?${params.toString()}`;
    const response = await fetchImpl(url);
    if (response.ok) return response.json();
    const body = typeof response.text === "function" ? await response.text() : "";
    errors.push(`HTTP ${response.status}${body ? `: ${body}` : ""}`);
  }

  throw new Error(errors.join(" | "));
}

function orderBookImbalance(depth) {
  const bids = Array.isArray(depth?.bids) ? depth.bids : [];
  const asks = Array.isArray(depth?.asks) ? depth.asks : [];
  const bidNotional = bids.reduce((sum, [price, quantity]) => sum + (finite(price, 0) * finite(quantity, 0)), 0);
  const askNotional = asks.reduce((sum, [price, quantity]) => sum + (finite(price, 0) * finite(quantity, 0)), 0);
  const total = bidNotional + askNotional;
  return total === 0 ? 0 : clamp((bidNotional - askNotional) / total);
}

function derivativesBias({ orderBook, longShortRatio, basisPercent }) {
  let score = 0;
  if (orderBook > 0.08) score += 0.45;
  if (orderBook < -0.08) score -= 0.45;
  if (longShortRatio !== null) {
    if (longShortRatio > 1.8) score -= 0.25;
    else if (longShortRatio > 1.1) score += 0.12;
    else if (longShortRatio < 0.75) score += 0.25;
    else if (longShortRatio < 0.95) score -= 0.12;
  }
  if (basisPercent > 0.35) score += 0.15;
  if (basisPercent < -0.35) score -= 0.15;

  const biasDirection = score >= 0.25 ? "LONG" : score <= -0.25 ? "SHORT" : "NEUTRAL";
  return {
    score: round(score, 3),
    biasDirection
  };
}

export async function fetchDerivativesSnapshot({
  symbol,
  fetchImpl = globalThis.fetch,
  baseUrls = binanceFuturesBaseUrls()
} = {}) {
  if (!enabled(process.env.DERIVATIVES_DATA_ENABLED, true)) {
    return { symbol, ok: false, skipped: true, reason: "disabled" };
  }

  const normalizedSymbol = String(symbol ?? "").toUpperCase();
  if (!normalizedSymbol.endsWith("USDT")) {
    return { symbol: normalizedSymbol, ok: false, skipped: true, reason: "non_usdt_symbol" };
  }

  try {
    const [openInterest, premium, depth, ratioRows] = await Promise.all([
      fetchJsonFromBases({ path: "/fapi/v1/openInterest", query: { symbol: normalizedSymbol }, baseUrls, fetchImpl }),
      fetchJsonFromBases({ path: "/fapi/v1/premiumIndex", query: { symbol: normalizedSymbol }, baseUrls, fetchImpl }),
      fetchJsonFromBases({ path: "/fapi/v1/depth", query: { symbol: normalizedSymbol, limit: 20 }, baseUrls, fetchImpl }),
      fetchJsonFromBases({ path: "/futures/data/globalLongShortAccountRatio", query: { symbol: normalizedSymbol, period: "1h", limit: 1 }, baseUrls, fetchImpl }).catch(() => [])
    ]);
    const markPrice = finite(premium.markPrice);
    const indexPrice = finite(premium.indexPrice);
    const basisPercent = markPrice && indexPrice ? ((markPrice - indexPrice) / indexPrice) * 100 : 0;
    const orderBook = orderBookImbalance(depth);
    const longShortRatio = finite(Array.isArray(ratioRows) ? ratioRows.at(-1)?.longShortRatio : null, null);
    const bias = derivativesBias({ orderBook, longShortRatio, basisPercent });

    return {
      ok: true,
      symbol: normalizedSymbol,
      provider: "Binance USD-M Futures",
      openInterest: finite(openInterest.openInterest, null),
      markPrice,
      indexPrice,
      basisPercent: round(basisPercent, 4),
      lastFundingRate: finite(premium.lastFundingRate, null),
      longShortRatio,
      orderBookImbalance: round(orderBook, 4),
      biasDirection: bias.biasDirection,
      score: bias.score,
      detail: `OI ${round(openInterest.openInterest, 2)}，盘口失衡 ${round(orderBook * 100, 2)}%，多空比 ${longShortRatio ?? "--"}，基差 ${round(basisPercent, 3)}%。`
    };
  } catch (error) {
    return {
      ok: false,
      symbol: normalizedSymbol,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function fetchDerivativesSnapshotsConcurrent({
  symbols = [],
  fetchImpl = globalThis.fetch,
  concurrency = Number(process.env.DERIVATIVES_DATA_CONCURRENCY ?? 4),
  limit = Number(process.env.DERIVATIVES_DATA_LIMIT ?? 20)
} = {}) {
  const uniqueSymbols = [...new Set(symbols.map((symbol) => String(symbol).toUpperCase()).filter(Boolean))].slice(0, limit);
  const results = new Array(uniqueSymbols.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, uniqueSymbols.length || 1));

  async function worker() {
    while (nextIndex < uniqueSymbols.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fetchDerivativesSnapshot({ symbol: uniqueSymbols[index], fetchImpl });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
