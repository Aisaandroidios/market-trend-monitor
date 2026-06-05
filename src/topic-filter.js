import { normalizeTelegramTopicSymbol, parseTelegramTopicMap } from "./notifiers.js";

export function topicSymbolsFromMap(topicMap = parseTelegramTopicMap()) {
  return new Set(Object.keys(topicMap).map(normalizeTelegramTopicSymbol));
}

function tickerTopicSymbol(ticker) {
  if (ticker.market === "stocks") return normalizeTelegramTopicSymbol(`${ticker.symbol}USDT`);
  return normalizeTelegramTopicSymbol(ticker.symbol);
}

export function filterTickersByTopicMap(tickers, topicMap = parseTelegramTopicMap()) {
  const allowed = topicSymbolsFromMap(topicMap);
  if (allowed.size === 0) return [];

  return tickers.filter((ticker) => allowed.has(tickerTopicSymbol(ticker)));
}

export function decisionSymbolsFromTopicMap(topicMap = parseTelegramTopicMap(), supportedSymbols = []) {
  const allowed = topicSymbolsFromMap(topicMap);
  if (allowed.size === 0) return supportedSymbols;

  return supportedSymbols.filter((symbol) => allowed.has(normalizeTelegramTopicSymbol(symbol)));
}
