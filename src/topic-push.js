import { normalizeTelegramTopicSymbol } from "./notifiers.js";
import { tickerForTopicStatus } from "./topic-status.js";

function ideaForSymbol(tradeIdeas, symbol) {
  if (tradeIdeas instanceof Map) return tradeIdeas.get(symbol);
  return tradeIdeas?.[symbol];
}

function isActionableIdea(idea) {
  return ["LONG", "SHORT"].includes(idea?.direction) && idea?.action !== "WAIT";
}

export function completeTopicPushPlan({
  topicMap = {},
  tradeIdeas = new Map(),
  tickers = [],
  skipSymbols = new Set()
} = {}) {
  const symbols = [...new Set(
    Object.keys(topicMap)
      .map((symbol) => normalizeTelegramTopicSymbol(symbol))
      .filter(Boolean)
  )];
  const normalizedSkips = new Set([...skipSymbols].map((symbol) => normalizeTelegramTopicSymbol(symbol)));

  return symbols
    .filter((symbol) => !normalizedSkips.has(symbol))
    .map((symbol) => {
      const idea = ideaForSymbol(tradeIdeas, symbol);
      const ticker = tickerForTopicStatus(symbol, tickers);

      return {
        symbol,
        kind: isActionableIdea(idea) ? "trade_idea" : "topic_status",
        ...(idea ? { idea } : {}),
        ...(ticker ? { ticker } : {})
      };
    });
}
