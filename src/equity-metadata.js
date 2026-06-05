const equityMetadataByBase = {
  MCD: {
    companyName: "McDonald's Corporation",
    stockSymbol: "MCD.US",
    binanceFuturesSymbol: "MCDUSDT",
    binanceFuturesStatus: "disconnected",
    binanceSpotSymbol: "MCDUSDT",
    binanceSpotStatus: "unlisted",
    hyperliquidSymbol: "xyz:MCD",
    hyperliquidStatus: "disconnected"
  },
  SMCI: {
    companyName: "Super Micro Computer, Inc.",
    stockSymbol: "SMCI.US",
    binanceFuturesSymbol: "SMCIUSDT",
    binanceFuturesStatus: "disconnected",
    binanceSpotSymbol: "SMCIUSDT",
    binanceSpotStatus: "unlisted",
    hyperliquidSymbol: "xyz:SMCI",
    hyperliquidStatus: "disconnected"
  },
  IBM: {
    companyName: "International Business Machines Corporation",
    stockSymbol: "IBM.US",
    binanceFuturesSymbol: "IBMUSDT",
    binanceFuturesStatus: "connected",
    binanceSpotSymbol: "IBMUSDT",
    binanceSpotStatus: "unlisted",
    hyperliquidSymbol: "xyz:IBM",
    hyperliquidStatus: "connected"
  },
  DELL: {
    companyName: "Dell Technologies Inc.",
    stockSymbol: "DELL.US",
    binanceFuturesSymbol: "DELLUSDT",
    binanceFuturesStatus: "connected",
    binanceSpotSymbol: "DELLUSDT",
    binanceSpotStatus: "unlisted",
    hyperliquidSymbol: "xyz:DELL",
    hyperliquidStatus: "connected"
  },
  NOW: {
    companyName: "ServiceNow, Inc.",
    stockSymbol: "NOW.US",
    binanceFuturesSymbol: "NOWUSDT",
    binanceFuturesStatus: "connected",
    binanceSpotSymbol: "NOWUSDT",
    binanceSpotStatus: "unlisted",
    hyperliquidSymbol: "xyz:NOW",
    hyperliquidStatus: "disconnected"
  }
};

function baseSymbol(symbol = "") {
  return String(symbol).toUpperCase().replace(/[-_\s]/g, "").replace(/USDT$|USDC$/, "");
}

export function equityMetadataForSymbol(symbol) {
  return equityMetadataByBase[baseSymbol(symbol)] ?? null;
}

export function sourceStatusLabel(status) {
  const labels = {
    connected: "已连上",
    disconnected: "未连上",
    unlisted: "未上现货"
  };
  return labels[status] ?? "未知";
}

export { equityMetadataByBase };
