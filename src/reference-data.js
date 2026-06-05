import { equityMetadataForSymbol } from "./equity-metadata.js";
import { fetchTradingViewCandles } from "./tradingview-data.js";
import { fetchYahooCandles } from "./yahoo-data.js";

const defaultProviders = [
  "tradingview",
  "yahoo",
  "alpha_vantage",
  "twelve_data",
  "alpaca",
  "finnhub"
];

function enabled(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function listFromEnv(value, fallback = defaultProviders) {
  const list = String(value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return list.length ? list : fallback;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTopicSymbol(symbol = "") {
  return String(symbol)
    .toUpperCase()
    .replace(/[-_\s]/g, "")
    .replace(/USDT$|USDC$/, "");
}

function equitySymbol(symbol) {
  const metadata = equityMetadataForSymbol(symbol);
  if (metadata?.stockSymbol) return metadata.stockSymbol.replace(/\.US$/i, "");

  const base = normalizeTopicSymbol(symbol);
  const aliases = {
    APPLE: "AAPL",
    SP500: "SPY",
    SPCX: "SPY",
    XYZ100: "QQQ",
    NASDAQ100: "QQQ",
    XAU: "GLD",
    XAUUSD: "GLD",
    GOLD: "GLD",
    XAG: "SLV",
    XAGUSD: "SLV",
    SILVER: "SLV",
    CL: "USO",
    CLF: "USO",
    WTIOIL: "USO",
    BZ: "BNO",
    BRENTOIL: "BNO"
  };
  return aliases[base] ?? base;
}

function twelveDataSymbol(symbol) {
  const base = normalizeTopicSymbol(symbol);
  const aliases = {
    APPLE: "AAPL",
    XAU: "XAU/USD",
    XAUUSD: "XAU/USD",
    GOLD: "XAU/USD",
    XAG: "XAG/USD",
    XAGUSD: "XAG/USD",
    SILVER: "XAG/USD",
    CL: "WTI/USD",
    CLF: "WTI/USD",
    WTIOIL: "WTI/USD",
    BZ: "BRENT/USD",
    BRENTOIL: "BRENT/USD",
    SP500: "SPY",
    SPCX: "SPY",
    XYZ100: "QQQ"
  };
  return aliases[base] ?? equitySymbol(symbol);
}

function alphaInterval(interval) {
  const map = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "60min"
  };
  return map[interval] ?? "60min";
}

function finnhubResolution(interval) {
  const map = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "1d": "D"
  };
  return map[interval] ?? "60";
}

function alpacaTimeframe(interval) {
  const map = {
    "1m": "1Min",
    "5m": "5Min",
    "15m": "15Min",
    "30m": "30Min",
    "1h": "1Hour",
    "1d": "1Day"
  };
  return map[interval] ?? "1Hour";
}

function candleFromValues({ open, high, low, close, volume = 0, time }) {
  const closeValue = finiteNumber(close, 0);
  if (closeValue <= 0) return null;
  const openTime = Number(time);
  return {
    openTime: Number.isFinite(openTime) ? openTime : undefined,
    eventTime: Number.isFinite(openTime) ? openTime : undefined,
    open: finiteNumber(open, closeValue),
    high: finiteNumber(high, closeValue),
    low: finiteNumber(low, closeValue),
    close: closeValue,
    volume: finiteNumber(volume, 0)
  };
}

function sortCandles(candles, limit) {
  return candles
    .filter(Boolean)
    .sort((left, right) => finiteNumber(left.openTime ?? left.eventTime, 0) - finiteNumber(right.openTime ?? right.eventTime, 0))
    .slice(-limit);
}

function withDataSource({ candles, provider, exchange, reference, quoteSymbol, interval }) {
  const dataSource = {
    provider,
    exchange,
    reference,
    quoteSymbol,
    interval
  };
  Object.defineProperty(candles, "dataSource", {
    value: dataSource,
    enumerable: false
  });
  return {
    ok: true,
    symbol: quoteSymbol,
    candles,
    dataSource
  };
}

async function fetchJson(url, {
  fetchImpl = globalThis.fetch,
  headers,
  timeoutMs = Number(process.env.REFERENCE_DATA_TIMEOUT_MS ?? 7000)
} = {}) {
  const options = { headers };
  if (typeof AbortSignal?.timeout === "function") {
    options.signal = AbortSignal.timeout(timeoutMs);
  }
  const response = await fetchImpl(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchAlphaVantageCandles({
  symbol,
  interval,
  limit,
  fetchImpl,
  apiKey = process.env.ALPHA_VANTAGE_API_KEY
}) {
  if (!apiKey) return { ok: false, skipped: true, reason: "missing_alpha_vantage_key" };
  const quoteSymbol = equitySymbol(symbol);
  const url = new URL("https://www.alphavantage.co/query");
  url.searchParams.set("function", interval === "1d" ? "TIME_SERIES_DAILY" : "TIME_SERIES_INTRADAY");
  url.searchParams.set("symbol", quoteSymbol);
  if (interval !== "1d") url.searchParams.set("interval", alphaInterval(interval));
  url.searchParams.set("outputsize", "compact");
  url.searchParams.set("apikey", apiKey);

  const payload = await fetchJson(url.toString(), { fetchImpl });
  const seriesKey = Object.keys(payload).find((key) => key.startsWith("Time Series"));
  if (!seriesKey || payload["Error Message"] || payload.Note || payload.Information) {
    return { ok: false, reason: payload["Error Message"] ?? payload.Note ?? payload.Information ?? "alpha_vantage_no_data" };
  }

  const candles = sortCandles(Object.entries(payload[seriesKey] ?? {}).map(([time, row]) => candleFromValues({
    time: Number(new Date(`${time.replace(" ", "T")}Z`)),
    open: row["1. open"],
    high: row["2. high"],
    low: row["3. low"],
    close: row["4. close"],
    volume: row["5. volume"]
  })), limit);
  if (!candles.length) return { ok: false, reason: "alpha_vantage_empty" };

  return withDataSource({
    candles,
    provider: "Alpha Vantage",
    exchange: "Alpha Vantage",
    reference: interval === "1d" ? "time_series_daily" : "time_series_intraday",
    quoteSymbol,
    interval
  });
}

async function fetchFinnhubCandles({
  symbol,
  interval,
  limit,
  fetchImpl,
  apiKey = process.env.FINNHUB_API_KEY
}) {
  if (!apiKey) return { ok: false, skipped: true, reason: "missing_finnhub_key" };
  const quoteSymbol = equitySymbol(symbol);
  const to = Math.floor(Date.now() / 1000);
  const secondsPerBar = interval === "1d" ? 86400 : 3600;
  const from = to - (secondsPerBar * Math.max(limit + 24, 96));
  const url = new URL("https://finnhub.io/api/v1/stock/candle");
  url.searchParams.set("symbol", quoteSymbol);
  url.searchParams.set("resolution", finnhubResolution(interval));
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  url.searchParams.set("token", apiKey);

  const payload = await fetchJson(url.toString(), { fetchImpl });
  if (payload.s !== "ok" || !Array.isArray(payload.t)) {
    return { ok: false, reason: payload.s ?? payload.error ?? "finnhub_no_data" };
  }

  const candles = sortCandles(payload.t.map((time, index) => candleFromValues({
    time: Number(time) * 1000,
    open: payload.o?.[index],
    high: payload.h?.[index],
    low: payload.l?.[index],
    close: payload.c?.[index],
    volume: payload.v?.[index]
  })), limit);
  if (!candles.length) return { ok: false, reason: "finnhub_empty" };

  return withDataSource({
    candles,
    provider: "Finnhub",
    exchange: "Finnhub",
    reference: "stock_candle",
    quoteSymbol,
    interval
  });
}

async function fetchAlpacaCandles({
  symbol,
  interval,
  limit,
  fetchImpl,
  keyId = process.env.ALPACA_API_KEY_ID,
  secretKey = process.env.ALPACA_API_SECRET_KEY,
  feed = process.env.ALPACA_DATA_FEED ?? "iex"
}) {
  if (!keyId || !secretKey) return { ok: false, skipped: true, reason: "missing_alpaca_keys" };
  const quoteSymbol = equitySymbol(symbol);
  const url = new URL(process.env.ALPACA_DATA_BARS_URL ?? "https://data.alpaca.markets/v2/stocks/bars");
  url.searchParams.set("symbols", quoteSymbol);
  url.searchParams.set("timeframe", alpacaTimeframe(interval));
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 10000)));
  url.searchParams.set("adjustment", process.env.ALPACA_ADJUSTMENT ?? "raw");
  url.searchParams.set("feed", feed);
  url.searchParams.set("sort", "asc");

  const payload = await fetchJson(url.toString(), {
    fetchImpl,
    headers: {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secretKey
    }
  });
  const rows = payload.bars?.[quoteSymbol] ?? payload.bars?.[quoteSymbol.toUpperCase()] ?? [];
  const candles = sortCandles(rows.map((row) => candleFromValues({
    time: Number(new Date(row.t)),
    open: row.o,
    high: row.h,
    low: row.l,
    close: row.c,
    volume: row.v
  })), limit);
  if (!candles.length) return { ok: false, reason: "alpaca_empty" };

  return withDataSource({
    candles,
    provider: "Alpaca Market Data",
    exchange: `Alpaca ${feed.toUpperCase()}`,
    reference: "stock_bars",
    quoteSymbol,
    interval
  });
}

async function fetchTwelveDataCandles({
  symbol,
  interval,
  limit,
  fetchImpl,
  apiKey = process.env.TWELVE_DATA_API_KEY
}) {
  if (!apiKey) return { ok: false, skipped: true, reason: "missing_twelve_data_key" };
  const quoteSymbol = twelveDataSymbol(symbol);
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", quoteSymbol);
  url.searchParams.set("interval", interval === "1d" ? "1day" : interval);
  url.searchParams.set("outputsize", String(Math.min(Math.max(limit, 1), 5000)));
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", apiKey);

  const payload = await fetchJson(url.toString(), { fetchImpl });
  if (payload.status === "error" || !Array.isArray(payload.values)) {
    return { ok: false, reason: payload.message ?? "twelve_data_no_data" };
  }

  const candles = sortCandles(payload.values.map((row) => candleFromValues({
    time: Number(new Date(String(row.datetime).replace(" ", "T"))),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume
  })), limit);
  if (!candles.length) return { ok: false, reason: "twelve_data_empty" };

  return withDataSource({
    candles,
    provider: "Twelve Data",
    exchange: payload.meta?.exchange ?? "Twelve Data",
    reference: "time_series",
    quoteSymbol: payload.meta?.symbol ?? quoteSymbol,
    interval
  });
}

async function fetchProviderCandles(provider, options) {
  if (provider === "tradingview") return fetchTradingViewCandles(options);
  if (provider === "yahoo") return fetchYahooCandles(options);
  if (provider === "alpha_vantage") return fetchAlphaVantageCandles(options);
  if (provider === "finnhub") return fetchFinnhubCandles(options);
  if (provider === "alpaca") return fetchAlpacaCandles(options);
  if (provider === "twelve_data") return fetchTwelveDataCandles(options);
  return { ok: false, skipped: true, reason: `unknown_provider:${provider}` };
}

export function referenceProviderList(env = process.env) {
  return listFromEnv(env.REFERENCE_DATA_PROVIDERS, defaultProviders);
}

export function referenceDataStatus(env = process.env) {
  const providers = referenceProviderList(env);
  return {
    providers,
    providerDetails: providers.map((provider) => ({
      provider,
      configured: provider === "tradingview"
        ? enabled(env.TRADINGVIEW_DATA_ENABLED, false)
        : provider === "yahoo"
          ? enabled(env.YAHOO_DATA_ENABLED, false)
          : provider === "alpha_vantage"
            ? Boolean(env.ALPHA_VANTAGE_API_KEY)
            : provider === "finnhub"
              ? Boolean(env.FINNHUB_API_KEY)
              : provider === "alpaca"
                ? Boolean(env.ALPACA_API_KEY_ID && env.ALPACA_API_SECRET_KEY)
                : provider === "twelve_data"
                  ? Boolean(env.TWELVE_DATA_API_KEY)
                  : false
    }))
  };
}

export async function fetchReferenceCandles({
  symbol,
  interval = "1h",
  limit = 120,
  providers = referenceProviderList(),
  fetchImpl = globalThis.fetch
} = {}) {
  const attempts = [];

  for (const provider of providers) {
    try {
      const result = await fetchProviderCandles(provider, {
        symbol,
        interval,
        limit,
        fetchImpl
      });
      attempts.push({
        provider,
        ok: Boolean(result?.ok),
        skipped: Boolean(result?.skipped),
        reason: result?.reason ?? result?.error ?? null
      });
      if (result?.ok && result.candles?.length) {
        return {
          ...result,
          providerChain: attempts
        };
      }
    } catch (error) {
      attempts.push({
        provider,
        ok: false,
        skipped: false,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    ok: false,
    symbol,
    attempts,
    reason: attempts.at(-1)?.reason ?? "reference_data_no_provider"
  };
}
