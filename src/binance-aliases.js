import { normalizeTelegramTopicSymbol } from "./notifiers.js";

const directBinanceSymbols = new Set([
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "ZECUSDT",
  "NEARUSDT",
  "WLDUSDT",
  "HYPEUSDT",
  "QQQUSDT",
  "XYZ100USDT",
  "SP500USDT",
  "SPYUSDT",
  "NVDAUSDT",
  "AAPLUSDT",
  "MSFTUSDT",
  "TSLAUSDT",
  "ORCLUSDT",
  "AMDUSDT",
  "GOOGLUSDT",
  "METAUSDT",
  "TSMUSDT",
  "MUUSDT",
  "AVGOUSDT",
  "QCOMUSDT",
  "MRVLUSDT",
  "INTCUSDT",
  "JPMUSDT",
  "DRAMUSDT",
  "ARMUSDT",
  "NOKUSDT",
  "IBMUSDT",
  "CRMUSDT",
  "SNDKUSDT",
  "NOWUSDT",
  "CRCLUSDT",
  "SPCXUSDT",
  "DELLUSDT",
  "MSTRUSDT",
  "WMTUSDT",
  "SOXLUSDT",
  "EWYUSDT",
  "COINUSDT",
  "XAUUSDT",
  "PAXGUSDT",
  "XAUTUSDT",
  "SILVERUSDT",
  "CLUSDT",
  "BRENTOILUSDT"
]);

const topicToBinance = {
  APPLE: "AAPLUSDT",
  XAUUSD: "XAUUSDT",
  GOLD: "XAUUSDT",
  GLD: "XAUUSDT",
  XAGUSD: "SILVERUSDT",
  "CL.F": "CLUSDT",
  BZ: "BRENTOILUSDT",
  BZUSDT: "BRENTOILUSDT",
  BRENTOIL: "BRENTOILUSDT",
  GOOG: "GOOGLUSDT",
  GOOGUSDT: "GOOGLUSDT",
  GOOGL: "GOOGLUSDT",
  PAXGUSDT: "PAXGUSDT",
  XAUUSDT: "XAUUSDT",
  XAUTUSDT: "XAUTUSDT"
};

const binanceToDisplay = {
  XAUUSDT: "XAUUSD",
  XAUTUSDT: "XAUUSD",
  PAXGUSDT: "PAXGUSDT",
  SILVERUSDT: "XAGUSD",
  CLUSDT: "CL.F",
  BRENTOILUSDT: "BZUSDT",
  GOOGLUSDT: "GOOGUSDT"
};

export function binanceSymbolForTopicSymbol(symbol) {
  const normalized = normalizeTelegramTopicSymbol(symbol);
  if (directBinanceSymbols.has(normalized)) return normalized;
  return topicToBinance[normalized] ?? null;
}

export function displaySymbolForBinanceSymbol(symbol) {
  return binanceToDisplay[symbol] ?? symbol;
}

export function decisionSymbolsWithBinanceAliases({ topicMap = {}, baseSymbols = [] }) {
  const symbols = new Set();

  for (const symbol of baseSymbols) {
    const mapped = binanceSymbolForTopicSymbol(symbol);
    if (mapped) symbols.add(mapped);
  }

  for (const symbol of Object.keys(topicMap)) {
    const mapped = binanceSymbolForTopicSymbol(symbol);
    if (mapped) symbols.add(mapped);
  }

  return Array.from(symbols);
}
