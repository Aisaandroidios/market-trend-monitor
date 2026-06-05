export function normalizeMiniTicker(raw) {
  const price = Number(raw.c);
  const open = Number(raw.o);
  const eventTime = Number(raw.E);

  return {
    symbol: String(raw.s),
    sourceSymbol: String(raw.s),
    market: "crypto",
    provider: "binance",
    price,
    open,
    high: Number(raw.h),
    low: Number(raw.l),
    baseVolume: Number(raw.v),
    quoteVolume: Number(raw.q),
    changePercent: open === 0 ? 0 : ((price - open) / open) * 100,
    eventTime: Number.isFinite(eventTime) && eventTime > 0 ? eventTime : Date.now()
  };
}

export function formatTickerForClient(ticker) {
  const eventTime = Number(ticker.eventTime);
  const safeEventTime = Number.isFinite(eventTime) && eventTime > 0 ? eventTime : Date.now();
  const formatted = {
    symbol: ticker.symbol,
    sourceSymbol: ticker.sourceSymbol,
    market: ticker.market,
    provider: ticker.provider,
    price: ticker.price,
    open: ticker.open,
    high: ticker.high,
    low: ticker.low,
    baseVolume: ticker.baseVolume,
    quoteVolume: ticker.quoteVolume,
    changePercent: ticker.changePercent,
    eventTime: safeEventTime,
    updatedAt: new Date(safeEventTime).toISOString()
  };

  for (const key of ["sourceSymbol", "market", "provider"]) {
    if (formatted[key] === undefined) delete formatted[key];
  }

  return formatted;
}

export function createTickerStore() {
  const tickers = new Map();

  function tickerKey(ticker) {
    return `${ticker.market ?? "unknown"}:${ticker.symbol}`;
  }

  return {
    upsertTicker(ticker) {
      tickers.set(tickerKey(ticker), ticker);
    },

    applyMiniTickerArray(rawTickers) {
      for (const rawTicker of rawTickers) {
        const ticker = normalizeMiniTicker(rawTicker);
        this.upsertTicker(ticker);
      }
    },

    getSnapshot({ quoteAsset = "USDT", market, limit = 500 } = {}) {
      return Array.from(tickers.values())
        .filter((ticker) => !quoteAsset || ticker.symbol.endsWith(quoteAsset))
        .filter((ticker) => !market || ticker.market === market)
        .sort((left, right) => right.quoteVolume - left.quoteVolume)
        .slice(0, limit)
        .map(formatTickerForClient);
    },

    getAll({ market } = {}) {
      return Array.from(tickers.values())
        .filter((ticker) => !market || ticker.market === market)
        .map(formatTickerForClient);
    },

    size() {
      return tickers.size;
    }
  };
}
