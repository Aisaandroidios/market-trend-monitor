const defaultWatchlist = [
  { symbol: "SPY.US", market: "stocks" },
  { symbol: "QQQ.US", market: "stocks" },
  { symbol: "NVDA.US", market: "stocks" },
  { symbol: "TSLA.US", market: "stocks" },
  { symbol: "AAPL.US", market: "stocks" },
  { symbol: "AMD.US", market: "stocks" },
  { symbol: "META.US", market: "stocks" },
  { symbol: "MSFT.US", market: "stocks" },
  { symbol: "GOOGL.US", market: "stocks" },
  { symbol: "AMZN.US", market: "stocks" },
  { symbol: "SNDK.US", market: "stocks" },
  { symbol: "NOW.US", market: "stocks" },
  { symbol: "IBM.US", market: "stocks" },
  { symbol: "DELL.US", market: "stocks" },
  { symbol: "SMCI.US", market: "stocks" },
  { symbol: "MCD.US", market: "stocks" },
  { symbol: "XAUUSD", market: "commodities" },
  { symbol: "GLD.US", market: "commodities" },
  { symbol: "CL.F", market: "commodities" },
  { symbol: "USO.US", market: "commodities" },
  { symbol: "XAGUSD", market: "commodities" }
];

export function stooqSymbolToDisplay(symbol) {
  return symbol.endsWith(".US") ? symbol.slice(0, -3) : symbol;
}

function parseNumber(value) {
  if (!value || value === "N/D") return 0;
  return Number(value);
}

export function parseStooqCsv(csv, { market, provider = "stooq" }) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("Stooq response did not include a quote row");
  }

  const [symbol, date, time, open, high, low, close, volume] = lines[1].split(",");
  if (!symbol || close === "N/D") {
    throw new Error("Stooq response did not include a valid quote");
  }

  const price = parseNumber(close);
  const openPrice = parseNumber(open);
  const baseVolume = parseNumber(volume);
  const eventTime = Number(new Date(`${date}T${time}Z`));

  return {
    symbol: stooqSymbolToDisplay(symbol),
    sourceSymbol: symbol,
    market,
    provider,
    price,
    open: openPrice,
    high: parseNumber(high),
    low: parseNumber(low),
    baseVolume,
    quoteVolume: baseVolume > 0 ? price * baseVolume : 0,
    changePercent: openPrice === 0 ? 0 : ((price - openPrice) / openPrice) * 100,
    eventTime
  };
}

export function createStooqPoller({
  tickerStore,
  watchlist = defaultWatchlist,
  intervalMs = 60000,
  fetchImpl = globalThis.fetch,
  onStatus,
  onTickers
}) {
  let stopped = false;
  let timer = null;

  async function fetchTicker(item) {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(item.symbol.toLowerCase())}&f=sd2t2ohlcv&h&e=csv`;
    const response = await fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Stooq ${item.symbol} returned HTTP ${response.status}`);
    }

    return parseStooqCsv(await response.text(), {
      market: item.market,
      provider: "stooq"
    });
  }

  async function poll() {
    if (stopped) return;
    onStatus?.("polling");

    try {
      let applied = 0;

      for (const item of watchlist) {
        try {
          tickerStore.upsertTicker(await fetchTicker(item));
          applied += 1;
        } catch {
          // Public quote sources occasionally skip a symbol; keep the rest of the poll healthy.
        }
      }

      onStatus?.(applied > 0 ? "connected" : "error");
      if (applied > 0) onTickers?.();
    } catch {
      onStatus?.("error");
    } finally {
      if (!stopped) timer = setTimeout(poll, intervalMs);
    }
  }

  poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export { defaultWatchlist };
