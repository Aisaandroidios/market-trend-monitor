import { createReadStream, existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./env.js";
import {
  buildTradeIdea,
  fetchBinanceCandlesConcurrent,
  fetchBinanceFutures24hStats,
  rankSymbolsByDailyVolume
} from "./decision-engine.js";
import { createTickerStore } from "./market.js";
import { getNewsInsight } from "./news.js";
import {
  buildBestSignal,
  buildMarketReversalSignal,
  inferMarketContext,
  inferSymbolLongTermRegime,
  scoreTradeIdea
} from "./conviction.js";
import { loadExternalModelSignals } from "./model-brain.js";
import {
  sendCompleteTopicNotification,
  sendBestSignalNotifications,
  sendMarketReversalNotifications,
  sendSignalNotifications,
  sendTradeIdeaNotifications,
  sendTopicStatusNotifications
} from "./notifiers.js";
import { createSignalEngine } from "./signals.js";
import { createStooqPoller } from "./stooq.js";
import { createTelegramCommandPoller } from "./telegram-commands.js";
import { decisionSymbolsFromTopicMap, filterTickersByTopicMap } from "./topic-filter.js";
import { normalizeTelegramTopicSymbol, parseTelegramTopicMap } from "./notifiers.js";
import { activeCryptoSymbols, activeMarketSnapshot } from "./active-market.js";
import {
  binanceSymbolForTopicSymbol,
  decisionSymbolsWithBinanceAliases,
  displaySymbolForBinanceSymbol
} from "./binance-aliases.js";
import {
  decisionIntervalForUsMarketSession,
  decisionScheduleConfigFromEnv
} from "./market-session.js";
import {
  appendSignalMemory,
  buildStrategyFeedback,
  loadSignalMemory,
  reviewLatestSignalMemory,
  summarizeSignalPerformance
} from "./signal-memory.js";
import { fetchFinnhubStockQuote } from "./stock-quote.js";
import { buildSnapshotTradeIdea } from "./snapshot-strategy.js";
import { fetchTradingViewCandles } from "./tradingview-data.js";
import { fetchYahooCandles } from "./yahoo-data.js";
import { buildPythonModelSignals } from "./python-model-signals.js";
import {
  shouldSendTopicStatusHeartbeat,
  tickerForTopicStatus,
  topicStatusCandidateSymbols,
  topicStatusStateKey
} from "./topic-status.js";
import { completeTopicPushPlan } from "./topic-push.js";
import {
  opportunityScanIntervalForUsMarketSession,
  opportunityScanScheduleConfigFromEnv,
  selectOpportunityAlerts
} from "./opportunity-scan.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPublicDir = path.join(__dirname, "..", "public");
const binanceMiniTickerUrl = "wss://stream.binance.com:9443/ws/!miniTicker@arr";
const defaultDecisionSymbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT"];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function displayLongTermRegimeForSymbol({ regime, sourceSymbol, displaySymbol } = {}) {
  if (!regime) return null;

  const source = regime.symbol ?? sourceSymbol;
  const target = displaySymbol ?? source;
  if (!target) return regime;
  if (!source || source === target) {
    return {
      ...regime,
      symbol: target
    };
  }

  const note = typeof regime.note === "string"
    ? regime.note.replace(new RegExp(escapeRegExp(source), "g"), target)
    : regime.note;

  return {
    ...regime,
    symbol: target,
    sourceSymbol: source,
    note
  };
}

function tickerMatchesDecisionSymbol(ticker, symbol) {
  const normalized = String(symbol ?? "").replace(/USDT$/, "");
  const tickerSymbol = String(ticker?.symbol ?? "");
  const sourceSymbol = String(ticker?.sourceSymbol ?? "").replace(/\.US$/i, "");
  const aliases = {
    XAUUSD: ["XAUUSD", "GLD"],
    XAGUSD: ["XAGUSD"],
    "CL.F": ["CL.F", "USO"],
    BZUSDT: ["BZ", "BRENTOIL"]
  };
  const candidates = new Set([
    normalized,
    symbol,
    ...(aliases[symbol] ?? aliases[normalized] ?? [])
  ]);

  return candidates.has(tickerSymbol) || candidates.has(sourceSymbol);
}

function tickerForDecisionSymbol(symbol, tickers = []) {
  return tickers.find((ticker) => tickerMatchesDecisionSymbol(ticker, symbol));
}

function decisionSymbolFromTicker(ticker) {
  if (!ticker?.symbol) return null;
  if (ticker.market === "commodities") return normalizeTelegramTopicSymbol(ticker.symbol);
  return normalizeTelegramTopicSymbol(ticker.symbol);
}

function activeNonCryptoDecisionSymbols({ stocks = [], commodities = [], limitStocks = 8, limitCommodities = 4 } = {}) {
  return [
    ...stocks
      .slice()
      .sort((left, right) => right.quoteVolume - left.quoteVolume)
      .slice(0, limitStocks),
    ...commodities
      .slice()
      .sort((left, right) => right.quoteVolume - left.quoteVolume)
      .slice(0, limitCommodities)
  ]
    .map(decisionSymbolFromTicker)
    .filter(Boolean);
}

function enabledFromEnv(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

function safeStaticPath(publicDir, requestPath) {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(publicDir, pathname));
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

export function createHttpServer({
  tickerStore = createTickerStore(),
  signalEngine = createSignalEngine(),
  publicDir = defaultPublicDir,
  startMarketStream = true,
  startStooqPoller = true,
  marketUrl = binanceMiniTickerUrl,
  stooqIntervalMs = Number(process.env.STOOQ_INTERVAL_MS ?? 60000),
  decisionIntervalMs = Number(process.env.DECISION_INTERVAL_MS ?? 300000),
  decisionScheduleConfig = decisionScheduleConfigFromEnv({ fixedIntervalMs: decisionIntervalMs }),
  opportunityScanScheduleConfig = opportunityScanScheduleConfigFromEnv(),
  decisionNow = () => new Date(),
  startDecisionEngine = true,
  startOpportunityScanner = enabledFromEnv(process.env.OPPORTUNITY_SCAN_ENABLED, true),
  startTelegramCommands = true,
  decisionSymbols = defaultDecisionSymbols,
  telegramTopicMap = parseTelegramTopicMap(),
  activeCryptoLimit = Number(process.env.ACTIVE_CRYPTO_LIMIT ?? 8),
  decisionKlineConcurrency = Number(process.env.BINANCE_KLINE_CONCURRENCY ?? 6),
  topicStatusHeartbeatMs = Number(process.env.TOPIC_STATUS_HEARTBEAT_MS ?? 1800000),
  opportunityAlertCooldownMs = Number(process.env.OPPORTUNITY_ALERT_COOLDOWN_MS ?? 1800000),
  decisionWarmupMs = Number(process.env.DECISION_WARMUP_MS ?? 15000),
  completeTopicPushOnSchedule = enabledFromEnv(process.env.COMPLETE_TOPIC_PUSH_ON_SCHEDULE, true)
} = {}) {
  const clients = new Set();
  const providerStatus = {
    binance: startMarketStream ? "connecting" : "disabled",
    stooq: startStooqPoller ? "connecting" : "disabled"
  };
  const recentSignals = [];
  const tradeIdeas = new Map();
  let bestSignal = null;
  let lastBestSignalKey = null;
  let lastMarketContext = null;
  let lastMarketReversalSignal = null;
  let latestLongTermRegime = null;
  let latestPythonModelBrainStatus = {
    ok: false,
    skipped: true,
    reason: "not_run"
  };
  const lastDirections = new Map();
  const lastTopicStatusHeartbeats = new Map();
  const lastOpportunityAlerts = new Map();
  let stopMarketStream = () => {};
  let stopStooqPoller = () => {};
  let stopTelegramCommands = () => {};
  let decisionTimer = null;
  let opportunityScanTimer = null;
  let decisionWarmupTimer = null;
  let decisionRunInFlight = false;
  let decisionLoopStopped = false;
  let opportunityScanLoopStopped = false;
  let latestDecisionSchedule = decisionIntervalForUsMarketSession({
    now: decisionNow(),
    ...decisionScheduleConfig
  });
  let latestOpportunityScanSchedule = opportunityScanIntervalForUsMarketSession({
    now: decisionNow(),
    ...opportunityScanScheduleConfig
  });
  const topicDecisionSymbols = decisionSymbolsWithBinanceAliases({
    topicMap: telegramTopicMap,
    baseSymbols: decisionSymbolsFromTopicMap(telegramTopicMap, decisionSymbols)
  });

  function allTickers() {
    return tickerStore.getAll()
      .sort((left, right) => {
        if (left.market === right.market) return right.quoteVolume - left.quoteVolume;
        return String(left.market).localeCompare(String(right.market));
      });
  }

  function recordSignals(signals) {
    for (const signal of signals) {
      recentSignals.unshift(signal);
      sendSignalNotifications({ signal, tradeIdea: tradeIdeas.get(signal.symbol) }).catch(() => {});
    }
    recentSignals.splice(100);
  }

  function updateBestSignal() {
    const marketContext = inferMarketContext({
      tradeIdeas: Array.from(tradeIdeas.values()),
      commodities: tickerStore.getAll({ market: "commodities" }),
      longTermRegime: latestLongTermRegime
    });

    bestSignal = buildBestSignal({
      tradeIdeas: Array.from(tradeIdeas.values()),
      marketContext,
      generatedAt: Date.now()
    });

    const marketReversalSignal = buildMarketReversalSignal({
      previousContext: lastMarketContext,
      marketContext,
      bestSignal,
      generatedAt: Date.now()
    });
    if (marketReversalSignal) {
      lastMarketReversalSignal = marketReversalSignal;
      recentSignals.unshift(marketReversalSignal);
      recentSignals.splice(100);
      sendMarketReversalNotifications({ signal: marketReversalSignal }).catch(() => {});
    }
    lastMarketContext = marketContext;

    const signalKey = `${bestSignal.symbol}:${bestSignal.direction}:${bestSignal.action}`;
    if (signalKey !== lastBestSignalKey) {
      lastBestSignalKey = signalKey;
      appendSignalMemory({
        idea: bestSignal,
        marketContext,
        generatedAt: bestSignal.generatedAt
      });
      sendBestSignalNotifications({ signal: bestSignal }).catch(() => {});
    }
  }

  async function sendTopicStatusHeartbeats() {
    const candidates = topicStatusCandidateSymbols({
      topicMap: telegramTopicMap,
      tradeIdeas
    });
    if (candidates.length === 0) return;

    const tickers = tickerStore.getAll();
    const nowMs = Date.now();

    for (const symbol of candidates) {
      const idea = tradeIdeas.get(symbol);
      let ticker = tickerForTopicStatus(symbol, tickers);
      if (!ticker && !idea) {
        ticker = await fetchFinnhubStockQuote({ symbol });
      }
      const stateKey = topicStatusStateKey({ idea, ticker });

      if (!shouldSendTopicStatusHeartbeat({
        symbol,
        stateKey,
        memory: lastTopicStatusHeartbeats,
        nowMs,
        cooldownMs: topicStatusHeartbeatMs
      })) {
        continue;
      }

      try {
        const result = await sendTopicStatusNotifications({
          symbol,
          idea,
          ticker,
          telegram: { topicMap: telegramTopicMap }
        });
        if (result.telegram?.ok) {
          lastTopicStatusHeartbeats.set(symbol, { stateKey, sentAt: nowMs });
        }
      } catch {
        // Status heartbeats are best-effort and should never stop strategy evaluation.
      }
    }
  }

  async function sendCompleteTopicPushes({ skipSymbols = new Set() } = {}) {
    const marketContext = inferMarketContext({
      tradeIdeas: Array.from(tradeIdeas.values()),
      commodities: tickerStore.getAll({ market: "commodities" }),
      longTermRegime: latestLongTermRegime
    });
    const plan = completeTopicPushPlan({
      topicMap: telegramTopicMap,
      tradeIdeas,
      tickers: tickerStore.getAll(),
      skipSymbols
    });

    for (const item of plan) {
      try {
        let ticker = item.ticker;
        if (!ticker && !item.idea) {
          ticker = await fetchFinnhubStockQuote({ symbol: item.symbol });
        }

        const result = await sendCompleteTopicNotification({
          ...item,
          idea: item.idea ? { ...item.idea, marketContext } : item.idea,
          ticker,
          telegram: { topicMap: telegramTopicMap }
        });

        if (result.telegram?.ok && item.kind === "topic_status") {
          lastTopicStatusHeartbeats.set(item.symbol, {
            stateKey: topicStatusStateKey({ idea: item.idea, ticker }),
            sentAt: Date.now()
          });
        }
      } catch {
        // A failed topic push should not block the rest of the scheduled batch.
      }
    }
  }

  async function sendOpportunityScanAlerts({ skipSymbols = new Set() } = {}) {
    const marketContext = inferMarketContext({
      tradeIdeas: Array.from(tradeIdeas.values()),
      commodities: tickerStore.getAll({ market: "commodities" }),
      longTermRegime: latestLongTermRegime
    });
    const nowMs = Date.now();
    const alerts = selectOpportunityAlerts({
      tradeIdeas: Array.from(tradeIdeas.values()),
      marketContext,
      lastAlerts: lastOpportunityAlerts,
      skipSymbols,
      nowMs,
      cooldownMs: opportunityAlertCooldownMs
    });

    for (const alert of alerts) {
      const idea = {
        ...alert.idea,
        marketContext,
        opportunityScan: {
          reasons: alert.reasons,
          stateKey: alert.stateKey,
          sentAt: new Date(nowMs).toISOString()
        }
      };

      appendSignalMemory({
        idea,
        marketContext,
        generatedAt: idea.generatedAt ?? new Date(nowMs).toISOString()
      });
      await sendTradeIdeaNotifications({ idea });
      lastOpportunityAlerts.set(idea.symbol, {
        stateKey: alert.stateKey,
        direction: idea.direction,
        confidence: idea.confidence,
        convictionScore: idea.convictionScore,
        sentAt: nowMs
      });
    }
  }

  async function evaluateTradeIdeas({ pushMode = "complete" } = {}) {
    const changedDirectionSymbols = new Set();
    const allTickerSnapshot = tickerStore.getAll();
    const stockTickers = tickerStore.getAll({ market: "stocks" });
    const commodityTickers = tickerStore.getAll({ market: "commodities" });
    const activeReferenceSymbols = activeNonCryptoDecisionSymbols({
      stocks: stockTickers,
      commodities: commodityTickers
    });
    const activeReferenceBinanceSymbols = activeReferenceSymbols
      .map((symbol) => binanceSymbolForTopicSymbol(symbol))
      .filter(Boolean);
    const unrankedDecisionSymbols = Array.from(new Set([
      ...topicDecisionSymbols,
      ...activeCryptoSymbols(tickerStore.getAll({ market: "crypto" }), { limit: activeCryptoLimit }),
      ...activeReferenceBinanceSymbols
    ]));
    let futuresStats = [];

    try {
      futuresStats = await fetchBinanceFutures24hStats({
        symbols: unrankedDecisionSymbols
      });
    } catch {
      // If the ranking endpoint is unavailable, keep the strategy loop running with local ticker volume.
    }

    const activeDecisionSymbols = rankSymbolsByDailyVolume({
      symbols: unrankedDecisionSymbols,
      futuresStats,
      fallbackTickers: tickerStore.getAll()
    });
    const futuresStatBySymbol = new Map(
      futuresStats.map((stat) => [String(stat.symbol ?? "").toUpperCase(), stat])
    );

    const candleResults = await fetchBinanceCandlesConcurrent({
      symbols: activeDecisionSymbols,
      interval: "1h",
      limit: 120,
      market: "futures",
      concurrency: decisionKlineConcurrency
    });
    const signalMemoryRecords = loadSignalMemory();
    const strategyStats = summarizeSignalPerformance(signalMemoryRecords);
    const longTermRegimeBySymbol = new Map();
    const externalModelSignals = loadExternalModelSignals();

    try {
      const dailyCandleResults = await fetchBinanceCandlesConcurrent({
        symbols: Array.from(new Set(["BTCUSDT", ...activeDecisionSymbols])),
        interval: "1d",
        limit: 240,
        market: "futures",
        concurrency: decisionKlineConcurrency
      });

      for (const result of dailyCandleResults) {
        if (!result.candles) continue;
        longTermRegimeBySymbol.set(result.symbol, inferSymbolLongTermRegime({
          symbol: result.symbol,
          dailyCandles: result.candles
        }));
      }

      latestLongTermRegime = longTermRegimeBySymbol.get("BTCUSDT") ?? latestLongTermRegime;
    } catch {
      // Keep short-term strategy running if the long-term regime request fails.
    }

    if (longTermRegimeBySymbol.size === 0 && latestLongTermRegime) {
      longTermRegimeBySymbol.set("BTCUSDT", latestLongTermRegime);
    }

    const processedSymbols = new Set();
    async function storeReviewedIdea({ idea, sourceSymbol = idea.symbol, candles = [] }) {
      try {
        const aliasDisplaySymbol = displaySymbolForBinanceSymbol(sourceSymbol);
        const displaySymbol = aliasDisplaySymbol === sourceSymbol
          ? idea.symbol
          : aliasDisplaySymbol;
        const displayLongTermRegime = displayLongTermRegimeForSymbol({
          regime: longTermRegimeBySymbol.get(sourceSymbol),
          sourceSymbol,
          displaySymbol
        });
        const modelSignal = externalModelSignals.get(displaySymbol) ?? externalModelSignals.get(sourceSymbol);
        const routedIdea = displaySymbol === idea.symbol
          ? idea
          : {
              ...idea,
              sourceSymbol,
              symbol: displaySymbol
            };
        const previousSignalReview = reviewLatestSignalMemory({
          records: signalMemoryRecords,
          symbol: displaySymbol,
          currentPrice: routedIdea.entry,
          candles
        });
        const strategyFeedback = buildStrategyFeedback(signalMemoryRecords, {
          symbol: displaySymbol,
          direction: routedIdea.direction
        });
        const reviewedIdea = {
          ...routedIdea,
          strategyStats,
          strategyFeedback,
          ...(displayLongTermRegime ? { longTermRegime: displayLongTermRegime } : {}),
          ...(modelSignal ? { modelSignal } : {}),
          ...(previousSignalReview ? { previousSignalReview } : {})
        };

        tradeIdeas.set(displaySymbol, reviewedIdea);
        processedSymbols.add(displaySymbol);

        const previousDirection = lastDirections.get(displaySymbol);
        if (reviewedIdea.direction !== "NEUTRAL" && reviewedIdea.direction !== previousDirection) {
          lastDirections.set(displaySymbol, reviewedIdea.direction);
          const ideaMarketContext = inferMarketContext({
            tradeIdeas: Array.from(tradeIdeas.values()),
            commodities: tickerStore.getAll({ market: "commodities" }),
            longTermRegime: latestLongTermRegime
          });
          const notificationIdea = {
            ...reviewedIdea,
            marketContext: ideaMarketContext
          };
          const scoredNotificationIdea = scoreTradeIdea(notificationIdea, { marketContext: ideaMarketContext }) ?? notificationIdea;
          appendSignalMemory({
            idea: scoredNotificationIdea,
            marketContext: ideaMarketContext,
            generatedAt: scoredNotificationIdea.generatedAt
          });
          sendTradeIdeaNotifications({ idea: scoredNotificationIdea }).catch(() => {});
          changedDirectionSymbols.add(displaySymbol);
        }
      } catch {
        // Keep the decision loop running even when one symbol request fails.
      }
    }

    for (const result of candleResults) {
      const { symbol, candles, dataSource } = result;
      if (!candles) continue;

      const price = candles.at(-1)?.close;
      if (!price) continue;

      const news = await getNewsInsight({ symbol });
      const idea = buildTradeIdea({
        symbol,
        market: "futures",
        price,
        candles,
        newsScore: news.score,
        news,
        dataSource,
        futuresStat: futuresStatBySymbol.get(symbol),
        generatedAt: Date.now()
      });

      await storeReviewedIdea({ idea, sourceSymbol: symbol, candles });
    }

    for (const symbol of activeDecisionSymbols) {
      const displaySymbol = displaySymbolForBinanceSymbol(symbol);
      if (processedSymbols.has(displaySymbol)) continue;

      let referenceResult = await fetchTradingViewCandles({
        symbol: displaySymbol,
        interval: "1h",
        limit: 120
      });
      if (!referenceResult.ok || !referenceResult.candles?.length) {
        referenceResult = await fetchYahooCandles({
          symbol: displaySymbol,
          interval: "1h",
          limit: 120
        });
      }
      if (!referenceResult.ok || !referenceResult.candles?.length) continue;

      const price = referenceResult.candles.at(-1)?.close;
      if (!price) continue;
      const news = await getNewsInsight({ symbol: displaySymbol });
      const idea = buildTradeIdea({
        symbol: displaySymbol,
        market: referenceResult.dataSource?.provider === "Yahoo Finance" ? "yahoo" : "tradingview",
        price,
        candles: referenceResult.candles,
        newsScore: news.score,
        news,
        dataSource: referenceResult.dataSource,
        generatedAt: Date.now()
      });

      await storeReviewedIdea({ idea, sourceSymbol: displaySymbol, candles: referenceResult.candles });
    }

    const fallbackSymbols = Array.from(new Set([
      ...Object.keys(telegramTopicMap),
      ...activeReferenceSymbols
    ]));
    for (const symbol of fallbackSymbols) {
      const normalizedSymbol = normalizeTelegramTopicSymbol(symbol);
      if (!normalizedSymbol || processedSymbols.has(normalizedSymbol)) continue;

      const yahooResult = await fetchYahooCandles({
        symbol: normalizedSymbol,
        interval: "1h",
        limit: 120
      });
      if (yahooResult.ok && yahooResult.candles?.length) {
        const price = yahooResult.candles.at(-1)?.close;
        if (price) {
          const news = await getNewsInsight({ symbol: normalizedSymbol });
          const idea = buildTradeIdea({
            symbol: normalizedSymbol,
            market: "yahoo",
            price,
            candles: yahooResult.candles,
            newsScore: news.score,
            news,
            dataSource: yahooResult.dataSource,
            generatedAt: Date.now()
          });

          await storeReviewedIdea({ idea, sourceSymbol: normalizedSymbol, candles: yahooResult.candles });
          continue;
        }
      }

      let ticker = tickerForDecisionSymbol(normalizedSymbol, allTickerSnapshot);
      if (!ticker) ticker = await fetchFinnhubStockQuote({ symbol: normalizedSymbol });
      if (!ticker) continue;

      const idea = buildSnapshotTradeIdea({
        ticker,
        symbol: normalizedSymbol,
        generatedAt: Date.now()
      });
      if (!idea) continue;

      await storeReviewedIdea({ idea, sourceSymbol: normalizedSymbol, candles: [] });
    }

    const runtimeModelSignals = await buildPythonModelSignals({
      ideas: Array.from(processedSymbols)
        .map((symbol) => tradeIdeas.get(symbol))
        .filter(Boolean)
    });
    latestPythonModelBrainStatus = runtimeModelSignals.status ?? {
      ok: true,
      count: runtimeModelSignals.size
    };
    for (const [symbol, modelSignal] of runtimeModelSignals) {
      const normalizedSymbol = normalizeTelegramTopicSymbol(symbol);
      const idea = tradeIdeas.get(normalizedSymbol);
      if (!idea) continue;

      tradeIdeas.set(normalizedSymbol, {
        ...idea,
        modelSignal
      });
    }

    updateBestSignal();
    if (pushMode === "scan") {
      await sendOpportunityScanAlerts({ skipSymbols: changedDirectionSymbols });
    } else if (completeTopicPushOnSchedule) {
      await sendCompleteTopicPushes({ skipSymbols: changedDirectionSymbols });
    } else {
      await sendTopicStatusHeartbeats();
    }
    broadcastSnapshot();
  }

  async function runDecisionEvaluation({ pushMode = "complete" } = {}) {
    if (decisionRunInFlight) return;

    decisionRunInFlight = true;
    try {
      await evaluateTradeIdeas({ pushMode });
    } catch {
      // A failed cycle should not stop future strategy evaluations.
    } finally {
      decisionRunInFlight = false;
    }
  }

  function nextDecisionSchedule() {
    latestDecisionSchedule = decisionIntervalForUsMarketSession({
      now: decisionNow(),
      ...decisionScheduleConfig
    });
    return latestDecisionSchedule;
  }

  function nextOpportunityScanSchedule() {
    latestOpportunityScanSchedule = opportunityScanIntervalForUsMarketSession({
      now: decisionNow(),
      ...opportunityScanScheduleConfig
    });
    return latestOpportunityScanSchedule;
  }

  function scheduleNextDecision() {
    if (decisionLoopStopped) return;
    const schedule = nextDecisionSchedule();
    decisionTimer = setTimeout(runScheduledDecision, schedule.delayMs ?? schedule.intervalMs);
  }

  function scheduleNextOpportunityScan() {
    if (opportunityScanLoopStopped) return;
    const schedule = nextOpportunityScanSchedule();
    opportunityScanTimer = setTimeout(runScheduledOpportunityScan, schedule.delayMs ?? schedule.intervalMs);
  }

  async function runScheduledDecision() {
    if (decisionLoopStopped) return;
    await runDecisionEvaluation({ pushMode: "complete" });
    scheduleNextDecision();
  }

  async function runScheduledOpportunityScan() {
    if (opportunityScanLoopStopped) return;
    await runDecisionEvaluation({ pushMode: "scan" });
    scheduleNextOpportunityScan();
  }

  function startDecisionLoop() {
    decisionLoopStopped = false;
    scheduleNextDecision();
  }

  function startOpportunityScanLoop() {
    opportunityScanLoopStopped = false;
    scheduleNextOpportunityScan();
  }

  function signalUniverse() {
    const usdtUniverse = allTickers().filter((ticker) => ticker.market !== "crypto" || ticker.symbol.endsWith("USDT"));
    return Object.keys(telegramTopicMap).length > 0
      ? filterTickersByTopicMap(usdtUniverse, telegramTopicMap)
      : usdtUniverse;
  }

  function evaluateSignals() {
    const signals = signalEngine.evaluate(signalUniverse());
    recordSignals(signals);
    return signals;
  }

  function snapshotPayload() {
    const tickers = tickerStore.getSnapshot({ quoteAsset: "USDT", market: "crypto", limit: 800 });
    const stocks = tickerStore.getAll({ market: "stocks" })
      .sort((left, right) => right.quoteVolume - left.quoteVolume);
    const commodities = tickerStore.getAll({ market: "commodities" })
      .sort((left, right) => right.quoteVolume - left.quoteVolume);
    const activeMarkets = activeMarketSnapshot({
      tickers,
      stocks,
      commodities,
      cryptoLimit: activeCryptoLimit,
      stockLimit: 6,
      commodityLimit: 4
    });

    return {
      source: "multi",
      status: Object.values(providerStatus).includes("connected") ? "connected" : "connecting",
      providers: { ...providerStatus },
      counts: {
        crypto: tickers.length,
        stocks: stocks.length,
        commodities: commodities.length
      },
      count: tickers.length + stocks.length + commodities.length,
      totalMarkets: tickerStore.size(),
      generatedAt: new Date().toISOString(),
      tickers,
      stocks,
      commodities,
      activeMarkets,
      signals: recentSignals.slice(0, 30),
      decisionSchedule: latestDecisionSchedule,
      opportunityScanSchedule: latestOpportunityScanSchedule,
      pythonModelBrain: latestPythonModelBrainStatus,
      tradeIdeas: Array.from(tradeIdeas.values())
        .sort((left, right) => right.winProbability - left.winProbability),
      bestSignal,
      marketReversalSignal: lastMarketReversalSignal
    };
  }

  function broadcastSnapshot() {
    const data = JSON.stringify(snapshotPayload());
    for (const client of clients) {
      client.write(`event: tickers\n`);
      client.write(`data: ${data}\n\n`);
    }
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");

    if (url.pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        source: "multi",
        status: Object.values(providerStatus).includes("connected") ? "connected" : "connecting",
        providers: { ...providerStatus },
        tickers: tickerStore.size(),
        decisionSchedule: latestDecisionSchedule,
        opportunityScanSchedule: latestOpportunityScanSchedule,
        pythonModelBrain: latestPythonModelBrainStatus
      });
      return;
    }

    if (url.pathname === "/api/tickers") {
      sendJson(response, 200, snapshotPayload());
      return;
    }

    if (url.pathname === "/api/signals") {
      sendJson(response, 200, {
        count: recentSignals.length,
        signals: recentSignals
      });
      return;
    }

    if (url.pathname === "/api/trade-ideas") {
      sendJson(response, 200, {
        count: tradeIdeas.size,
        ideas: Array.from(tradeIdeas.values())
      });
      return;
    }

    if (url.pathname === "/api/best-signal") {
      sendJson(response, 200, {
        signal: bestSignal
      });
      return;
    }

    if (url.pathname === "/api/tickers/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive"
      });
      response.write(`event: tickers\n`);
      response.write(`data: ${JSON.stringify(snapshotPayload())}\n\n`);
      clients.add(response);

      request.on("close", () => {
        clients.delete(response);
      });
      return;
    }

    const filePath = safeStaticPath(publicDir, url.pathname);
    if (!filePath || !existsSync(filePath)) {
      sendJson(response, 404, { ok: false, error: "not_found" });
      return;
    }

    response.writeHead(200, {
      "content-type": contentTypeFor(filePath),
      "cache-control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  });

  server.on("listening", () => {
    if (startMarketStream) {
      stopMarketStream = connectBinanceStream({
        url: marketUrl,
        tickerStore,
        onStatus(status) {
          providerStatus.binance = status;
          broadcastSnapshot();
        },
        onTickers() {
          evaluateSignals();
          broadcastSnapshot();
        }
      });
    }

    if (startStooqPoller) {
      stopStooqPoller = createStooqPoller({
        tickerStore,
        intervalMs: stooqIntervalMs,
        onStatus(status) {
          providerStatus.stooq = status;
          broadcastSnapshot();
        },
        onTickers() {
          evaluateSignals();
          broadcastSnapshot();
        }
      });
    }

    if (startDecisionEngine) {
      startDecisionLoop();
      decisionWarmupTimer = setTimeout(() => {
        runDecisionEvaluation({ pushMode: "complete" });
      }, Math.max(0, decisionWarmupMs));
    }

    if (startDecisionEngine && startOpportunityScanner) {
      startOpportunityScanLoop();
    }

    if (startTelegramCommands) {
      stopTelegramCommands = createTelegramCommandPoller({
        topicMap: telegramTopicMap,
        getSnapshot: snapshotPayload
      });
    }
  });

  server.on("close", () => {
    stopMarketStream();
    stopStooqPoller();
    stopTelegramCommands();
    decisionLoopStopped = true;
    opportunityScanLoopStopped = true;
    if (decisionWarmupTimer) clearTimeout(decisionWarmupTimer);
    if (decisionTimer) clearTimeout(decisionTimer);
    if (opportunityScanTimer) clearTimeout(opportunityScanTimer);
    for (const client of clients) {
      client.end();
    }
    clients.clear();
  });

  return server;
}

export function connectBinanceStream({
  url = binanceMiniTickerUrl,
  tickerStore,
  onTickers,
  onStatus,
  WebSocketImpl = globalThis.WebSocket
}) {
  let stopped = false;
  let socket = null;
  let reconnectTimer = null;
  let retryDelayMs = 1000;

  function scheduleReconnect() {
    if (stopped) return;
    onStatus?.("reconnecting");
    reconnectTimer = setTimeout(connect, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 30000);
  }

  function connect() {
    if (stopped) return;
    if (!WebSocketImpl) {
      onStatus?.("websocket_unavailable");
      return;
    }

    onStatus?.("connecting");
    socket = new WebSocketImpl(url);

    socket.addEventListener("open", () => {
      retryDelayMs = 1000;
      onStatus?.("connected");
    });

    socket.addEventListener("message", (event) => {
      const payload = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
      const rawTickers = JSON.parse(payload);
      if (Array.isArray(rawTickers)) {
        tickerStore.applyMiniTickerArray(rawTickers);
        onTickers?.();
      }
    });

    socket.addEventListener("error", () => {
      onStatus?.("error");
    });

    socket.addEventListener("close", () => {
      scheduleReconnect();
    });
  }

  connect();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket && socket.readyState < 2) socket.close();
  };
}

if (process.argv[1] === __filename) {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "0.0.0.0";
  const server = createHttpServer();

  server.listen(port, host, () => {
    console.log(`Market monitor running at http://localhost:${port}`);
  });
}
