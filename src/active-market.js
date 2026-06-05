const excludedCryptoBases = new Set([
  "USDC",
  "FDUSD",
  "TUSD",
  "USDP",
  "USD1",
  "DAI",
  "EUR",
  "EURI",
  "AEUR",
  "BUSD",
  "USTC"
]);

export function isActionableCryptoSymbol(symbol) {
  const normalized = String(symbol ?? "").toUpperCase();
  if (!normalized.endsWith("USDT")) return false;

  const base = normalized.slice(0, -4);
  if (!base) return false;
  if (excludedCryptoBases.has(base)) return false;
  if (base.includes("UP") || base.includes("DOWN") || base.includes("BULL") || base.includes("BEAR")) return false;

  return true;
}

export function activeCryptoSymbols(tickers, { limit = 8 } = {}) {
  return tickers
    .filter((ticker) => ticker.market === "crypto")
    .filter((ticker) => isActionableCryptoSymbol(ticker.symbol))
    .sort((left, right) => right.quoteVolume - left.quoteVolume)
    .slice(0, limit)
    .map((ticker) => ticker.symbol);
}

function topByVolume(items, limit) {
  return items
    .slice()
    .sort((left, right) => right.quoteVolume - left.quoteVolume)
    .slice(0, limit);
}

export function activeMarketSnapshot({
  tickers = [],
  stocks = [],
  commodities = [],
  cryptoLimit = 8,
  stockLimit = 6,
  commodityLimit = 4
}) {
  const activeCryptoSet = new Set(activeCryptoSymbols(tickers, { limit: cryptoLimit }));

  return {
    crypto: tickers.filter((ticker) => activeCryptoSet.has(ticker.symbol)),
    stocks: topByVolume(stocks, stockLimit),
    commodities: topByVolume(commodities, commodityLimit)
  };
}
