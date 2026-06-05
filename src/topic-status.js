import { equityMetadataForSymbol } from "./equity-metadata.js";
import { normalizeTelegramTopicSymbol } from "./notifiers.js";

function ideaForSymbol(tradeIdeas, symbol) {
  if (tradeIdeas instanceof Map) return tradeIdeas.get(symbol);
  return tradeIdeas?.[symbol];
}

function baseFromSymbol(symbol) {
  return String(symbol ?? "")
    .toUpperCase()
    .replace(/[-_\s]/g, "")
    .replace(/USDT$|USDC$/, "");
}

function isWaitStatusIdea(idea) {
  return idea?.direction === "NEUTRAL" || idea?.action === "WAIT";
}

export function topicStatusCandidateSymbols({ topicMap = {}, tradeIdeas = new Map() } = {}) {
  return Object.keys(topicMap)
    .map((symbol) => normalizeTelegramTopicSymbol(symbol))
    .filter((symbol) => {
      if (!equityMetadataForSymbol(symbol)) return false;
      const idea = ideaForSymbol(tradeIdeas, symbol);
      return !idea || isWaitStatusIdea(idea);
    });
}

export function tickerForTopicStatus(symbol, tickers = []) {
  const metadata = equityMetadataForSymbol(symbol);
  const base = baseFromSymbol(symbol);
  const aliases = new Set([
    normalizeTelegramTopicSymbol(symbol),
    base,
    metadata?.stockSymbol,
    metadata?.stockSymbol?.replace(/\.US$/i, "")
  ].filter(Boolean).map((value) => String(value).toUpperCase()));

  return tickers.find((ticker) => {
    const tickerSymbols = [
      ticker.symbol,
      ticker.sourceSymbol,
      normalizeTelegramTopicSymbol(ticker.symbol),
      normalizeTelegramTopicSymbol(ticker.sourceSymbol)
    ].filter(Boolean).map((value) => String(value).toUpperCase());

    return tickerSymbols.some((tickerSymbol) => aliases.has(tickerSymbol));
  });
}

export function topicStatusStateKey({ idea, ticker } = {}) {
  if (idea) {
    return [
      idea.direction ?? "NEUTRAL",
      idea.action ?? "WAIT",
      idea.dataSource?.provider ?? idea.currentQuote?.source ?? "unknown"
    ].join(":");
  }

  return `NO_STRATEGY:${ticker?.provider ?? ticker?.source ?? "none"}`;
}

export function shouldSendTopicStatusHeartbeat({
  symbol,
  stateKey,
  memory,
  nowMs = Date.now(),
  cooldownMs
}) {
  const previous = memory.get(symbol);
  if (!previous) return true;
  if (previous.stateKey !== stateKey) return true;
  return nowMs - previous.sentAt >= cooldownMs;
}
