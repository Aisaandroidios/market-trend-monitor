import { equityMetadataForSymbol } from "./equity-metadata.js";

function roundNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(6)) : 0;
}

function stockBase(metadata) {
  return metadata.stockSymbol.replace(/\.US$/i, "");
}

export function parseFinnhubStockQuote({ symbol, payload }) {
  const metadata = equityMetadataForSymbol(symbol);
  const price = Number(payload?.c);
  if (!metadata || !Number.isFinite(price) || price <= 0) return null;

  const change = Number(payload?.d);
  const changePercent = Number(payload?.dp);
  const eventSeconds = Number(payload?.t);
  const base = stockBase(metadata);

  return {
    symbol: base,
    sourceSymbol: metadata.stockSymbol,
    market: "stocks",
    provider: "finnhub",
    price,
    open: Number.isFinite(change) ? roundNumber(price - change) : price,
    high: 0,
    low: 0,
    baseVolume: 0,
    quoteVolume: 0,
    changePercent: Number.isFinite(changePercent) ? changePercent : 0,
    eventTime: Number.isFinite(eventSeconds) && eventSeconds > 0
      ? eventSeconds * 1000
      : Date.now()
  };
}

export async function fetchFinnhubStockQuote({
  symbol,
  apiKey = process.env.FINNHUB_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.QUOTE_TIMEOUT_MS ?? 2500)
} = {}) {
  const metadata = equityMetadataForSymbol(symbol);
  if (!apiKey || !metadata) return null;

  const url = new URL("https://finnhub.io/api/v1/quote");
  url.searchParams.set("symbol", stockBase(metadata));
  url.searchParams.set("token", apiKey);

  try {
    const options = typeof AbortSignal?.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {};
    const response = await fetchImpl(url.toString(), options);
    if (!response.ok) return null;
    return parseFinnhubStockQuote({
      symbol,
      payload: await response.json()
    });
  } catch {
    return null;
  }
}
