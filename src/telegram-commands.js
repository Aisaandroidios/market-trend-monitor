import {
  scoreTradeIdea
} from "./conviction.js";
import { binanceSymbolForTopicSymbol } from "./binance-aliases.js";
import { equityMetadataForSymbol, sourceStatusLabel } from "./equity-metadata.js";
import { hyperliquidCoinForDecisionSymbol } from "./decision-engine.js";
import {
  formatPaperAccountMessage,
  formatPaperDailySummaryMessage,
  formatProbabilityCalibrationMessage,
  formatStrategyAttributionMessage,
  formatTradeIdeaMessage,
  parseTelegramTopicMap,
  sendTelegramMessage
} from "./notifiers.js";

export function reverseTelegramTopicMap(topicMap = parseTelegramTopicMap()) {
  const reversed = {};

  for (const [symbol, threadId] of Object.entries(topicMap)) {
    reversed[Number(threadId)] = symbol;
  }

  return reversed;
}

export function commandFromText(text = "") {
  const command = String(text).trim().split(/\s+/)[0]?.toLowerCase();
  if (!command?.startsWith("/")) return null;

  const normalized = command
    .replace(/^\/+/, "")
    .replace(/@.+$/, "");

  if (["signal", "latest", "策略", "最新"].includes(normalized)) return normalized === "latest" || normalized === "最新" ? "latest" : "signal";
  if (["best", "top", "最高", "最强"].includes(normalized)) return "best";
  if (["source", "code", "contract", "合约", "代码", "数据源"].includes(normalized)) return "source";
  if (["positions", "position", "account", "paper", "仓位", "持仓", "账户"].includes(normalized)) return "positions";
  if (["daily", "summary", "day", "report", "日报", "每日", "每日总结", "交易总结", "每日交易"].includes(normalized)) return "daily";
  if (["attribution", "attr", "performance", "perf", "strategyattribution", "归因", "策略归因"].includes(normalized)) return "attribution";
  if (["calibration", "probability", "winrate", "win", "概率", "校准", "胜率", "胜率校准"].includes(normalized)) return "calibration";
  if (["id", "topic"].includes(normalized)) return "id";
  if (["help", "start"].includes(normalized)) return "help";
  return null;
}

function displaySymbolFromTopic(symbol) {
  return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

function formatTickerReply(symbol, ticker) {
  const bias = ticker.changePercent > 0.3
    ? "观察偏多"
    : ticker.changePercent < -0.3
      ? "观察偏空"
      : "震荡观察";

  return [
    "Topic 最新快照",
    `标的: ${symbol}`,
    `状态: ${bias}`,
    `价格: ${ticker.price}`,
    `涨跌: ${ticker.changePercent.toFixed(2)}%`,
    `高点: ${ticker.high}`,
    `低点: ${ticker.low}`,
    `成交额: ${Math.round(ticker.quoteVolume ?? 0).toLocaleString("en-US")}`,
    "",
    "说明: 该标的当前使用快照数据；接入完整 K 线后会升级为止盈止损策略单。"
  ].join("\n");
}

function findTickerForTopic(symbol, snapshot) {
  const base = displaySymbolFromTopic(symbol);
  const candidates = [
    ...(snapshot.tickers ?? []),
    ...(snapshot.stocks ?? []),
    ...(snapshot.commodities ?? [])
  ];

  return candidates.find((ticker) => ticker.symbol === symbol || ticker.symbol === base);
}

function formatSourceReply(symbol, snapshot) {
  const idea = (snapshot.tradeIdeas ?? []).find((item) => item.symbol === symbol);
  const ticker = findTickerForTopic(symbol, snapshot);
  const metadata = equityMetadataForSymbol(symbol);
  const binanceSymbol = binanceSymbolForTopicSymbol(symbol);
  const hyperliquidSymbol = metadata?.hyperliquidSymbol ?? (binanceSymbol ? hyperliquidCoinForDecisionSymbol(binanceSymbol) : null);
  const dataSource = idea?.dataSource;
  const quote = idea?.currentQuote;

  const lines = [
    "Topic 数据源",
    `标的: ${symbol}`,
    metadata?.companyName ? `公司: ${metadata.companyName}` : null,
    metadata?.stockSymbol ? `美股现货: ${metadata.stockSymbol}` : null,
    metadata
      ? `Binance合约: ${metadata.binanceFuturesSymbol} | ${sourceStatusLabel(metadata.binanceFuturesStatus)}`
      : `Binance合约: ${binanceSymbol ?? "未配置"} | ${binanceSymbol ? "候选" : "未配置"}`,
    metadata
      ? `Binance现货: ${metadata.binanceSpotSymbol} | ${sourceStatusLabel(metadata.binanceSpotStatus)}`
      : `Binance现货: ${binanceSymbol ?? "未配置"} | 未确认`,
    metadata
      ? `Hyperliquid候选: ${metadata.hyperliquidSymbol} | ${sourceStatusLabel(metadata.hyperliquidStatus)}`
      : `Hyperliquid候选: ${hyperliquidSymbol ?? "未配置"}`
  ].filter(Boolean);

  if (dataSource) {
    lines.push(
      `当前使用: ${dataSource.provider ?? dataSource.exchange ?? "未知"}`,
      `当前合约: ${dataSource.quoteSymbol ?? quote?.symbol ?? binanceSymbol ?? symbol}`,
      `K线周期: ${dataSource.interval ?? "未知"}`,
      `交易所报价: ${quote?.price ?? idea.entry ?? "--"}`
    );
  } else {
    lines.push(
      "当前使用: 无完整K线策略",
      "说明: 本轮没有可用的 1h 合约K线策略；可能是交易所不支持、API暂时失败，或该标的只适合快照观察。"
    );
  }

  if (ticker) {
    lines.push(
      `快照来源: ${ticker.provider ?? ticker.source ?? "quote"}`,
      `快照价格: ${ticker.price}`,
      `快照涨跌: ${(ticker.changePercent ?? 0).toFixed(2)}%`
    );
  }

  return lines.join("\n");
}

function bestConfiguredTopicIdea({ topicMap, snapshot }) {
  const configuredSymbols = new Set(Object.keys(topicMap));
  const marketContext = snapshot.bestSignal?.marketContext ?? {};

  const ranked = (snapshot.tradeIdeas ?? [])
    .filter((idea) => configuredSymbols.size === 0 || configuredSymbols.has(idea.symbol))
    .map((idea) => idea.convictionScore !== undefined ? idea : scoreTradeIdea(idea, { marketContext }) ?? idea)
    .sort((left, right) => (right.convictionScore ?? 0) - (left.convictionScore ?? 0));

  return ranked.find((idea) => idea.action !== "WAIT") ?? ranked[0];
}

export function buildTopicReply({
  command = "signal",
  messageThreadId,
  chatId,
  topicMap = parseTelegramTopicMap(),
  snapshot,
  now = Date.now
}) {
  const symbol = reverseTelegramTopicMap(topicMap)[Number(messageThreadId)];

  if (command === "id") {
    return [
      "Topic ID",
      `chat_id: ${chatId}`,
      `message_thread_id: ${messageThreadId}`,
      `symbol: ${symbol ?? "未映射"}`
    ].join("\n");
  }

  if (command === "help") {
    return [
      "可用命令",
      "/signal - 获取当前 Topic 对应标的策略",
      "/latest - 获取当前 Topic 对应标的最新信息",
      "/best - 获取已配置 Topic 标的里的最高置信方向",
      "/source - 查看当前 Topic 的 Binance / Hyperliquid 合约代码",
      "/positions - 查看模拟账户和当前仓位",
      "/daily - 查看每日交易结果总结",
      "/attribution - 查看策略归因数据",
      "/calibration - 查看胜率校准数据",
      "/id - 查看当前 Topic ID"
    ].join("\n");
  }

  if (command === "positions") {
    return formatPaperAccountMessage(snapshot.paperAccount, { reason: "命令查询" }) || "模拟账户暂无数据。";
  }

  if (command === "daily") {
    return formatPaperDailySummaryMessage(snapshot.paperAccount, { reason: "命令查询", now }) || "每日交易总结暂无数据。";
  }

  if (command === "attribution") {
    return formatStrategyAttributionMessage(snapshot.performanceAttribution, { reason: "命令查询" }) || "策略归因暂无数据。";
  }

  if (command === "calibration") {
    return formatProbabilityCalibrationMessage(snapshot.probabilityCalibration, { reason: "命令查询" }) || "胜率校准暂无数据。";
  }

  if (command === "best") {
    const bestIdea = bestConfiguredTopicIdea({ topicMap, snapshot });
    if (!bestIdea) return "当前已配置 Topic 暂无可用策略。";
    return formatTradeIdeaMessage(bestIdea, {
      title: "最高置信方向",
      marketContext: snapshot.bestSignal?.marketContext,
      paperAccount: snapshot.paperAccount
    });
  }

  if (!symbol) {
    return [
      "这个 Topic 还没有配置 symbol 映射。",
      "请把当前 message_thread_id 加到 TELEGRAM_TOPIC_MAP。"
    ].join("\n");
  }

  if (command === "source") {
    return formatSourceReply(symbol, snapshot);
  }

  const idea = (snapshot.tradeIdeas ?? []).find((item) => item.symbol === symbol);
  if (idea) {
    return formatTradeIdeaMessage(idea, {
      title: "Topic 最新策略",
      marketContext: snapshot.bestSignal?.marketContext,
      paperAccount: snapshot.paperAccount
    });
  }

  const ticker = findTickerForTopic(symbol, snapshot);
  if (ticker) return formatTickerReply(displaySymbolFromTopic(symbol), ticker);

  return `${symbol} 暂无最新策略或行情数据。`;
}

export function createTelegramCommandPoller({
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  topicMap = parseTelegramTopicMap(),
  getSnapshot,
  intervalMs = Number(process.env.TELEGRAM_POLL_INTERVAL_MS ?? 3000),
  fetchImpl = globalThis.fetch
}) {
  if (!token || !chatId || Object.keys(topicMap).length === 0 || !getSnapshot) {
    return () => {};
  }

  let stopped = false;
  let timer = null;
  let offset = 0;

  async function poll() {
    if (stopped) return;

    try {
      const updatesResponse = await fetchImpl(`https://api.telegram.org/bot${token}/getUpdates?timeout=0&offset=${offset}`);
      const payload = await updatesResponse.json();
      if (payload.ok) {
        for (const update of payload.result ?? []) {
          offset = Math.max(offset, update.update_id + 1);
          const message = update.message ?? update.edited_message;
          if (!message?.chat || String(message.chat.id) !== String(chatId)) continue;

          const command = commandFromText(message.text);
          if (!command) continue;

          const reply = buildTopicReply({
            command,
            chatId,
            messageThreadId: message.message_thread_id,
            topicMap,
            snapshot: getSnapshot()
          });

          await sendTelegramMessage({
            token,
            chatId,
            messageThreadId: message.message_thread_id,
            text: reply,
            fetchImpl
          });
        }
      }
    } catch {
      // Keep polling; Telegram/network errors are transient.
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
