import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTopicReply,
  commandFromText,
  reverseTelegramTopicMap
} from "../src/telegram-commands.js";

test("reverses Telegram topic map from thread id to symbol", () => {
  assert.deepEqual(reverseTelegramTopicMap({ BTCUSDT: 3, ETHUSDT: 4 }), {
    3: "BTCUSDT",
    4: "ETHUSDT"
  });
});

test("parses topic commands", () => {
  assert.equal(commandFromText("/signal@example_bot"), "signal");
  assert.equal(commandFromText("/latest"), "latest");
  assert.equal(commandFromText("/best"), "best");
  assert.equal(commandFromText("/top"), "best");
  assert.equal(commandFromText("/source"), "source");
  assert.equal(commandFromText("/code"), "source");
  assert.equal(commandFromText("/合约"), "source");
  assert.equal(commandFromText("/策略"), "signal");
  assert.equal(commandFromText("hello"), null);
});

test("builds a crypto trade idea reply for the matching topic", () => {
  const reply = buildTopicReply({
    messageThreadId: 3,
    topicMap: { BTCUSDT: 3 },
    snapshot: {
      tradeIdeas: [
        {
          symbol: "BTCUSDT",
          direction: "SHORT",
          action: "SELL",
          entry: 100,
          takeProfit: 90,
          stopLoss: 105,
          winProbability: 0.62,
          riskReward: 2,
          support: 88,
          resistance: 120,
          indicators: {
            ema20: 96,
            ema60: 110,
            rsi: 35,
            macdHistogram: -1.4,
            atr: 3,
            volumeRatio: 1.2,
            newsScore: 0
          },
          reason: "EMA20 below EMA60"
        }
      ],
      tickers: []
    }
  });

  assert.ok(reply.includes("BTCUSDT"));
  assert.ok(reply.includes("方向: SHORT"));
  assert.ok(reply.includes("综合分:"));
  assert.ok(reply.includes("✅ 主要依据"));
  assert.ok(reply.includes("⚠️ 主要风险"));
  assert.ok(reply.includes("止盈: 90"));
});

test("builds a stock snapshot reply when no trade idea exists", () => {
  const reply = buildTopicReply({
    messageThreadId: 5,
    topicMap: { QQQUSDT: 5 },
    snapshot: {
      tradeIdeas: [],
      stocks: [
        { symbol: "QQQ", price: 746.16, changePercent: 0.5, high: 747, low: 740, quoteVolume: 1000000 }
      ]
    }
  });

  assert.ok(reply.includes("QQQ"));
  assert.ok(reply.includes("观察偏多"));
  assert.ok(reply.includes("746.16"));
});

test("builds a source reply for the matching topic", () => {
  const reply = buildTopicReply({
    command: "source",
    messageThreadId: 523,
    topicMap: { IBMUSDT: 523 },
    snapshot: {
      tradeIdeas: [
        {
          symbol: "IBMUSDT",
          dataSource: {
            provider: "Binance USD-M Futures",
            exchange: "Binance",
            quoteSymbol: "IBMUSDT",
            interval: "1h"
          },
          currentQuote: {
            exchange: "Binance",
            symbol: "IBMUSDT",
            price: 300.47
          }
        }
      ]
    }
  });

  assert.ok(reply.includes("Topic 数据源"));
  assert.ok(reply.includes("标的: IBMUSDT"));
  assert.ok(reply.includes("公司: International Business Machines Corporation"));
  assert.ok(reply.includes("美股现货: IBM.US"));
  assert.ok(reply.includes("Binance合约: IBMUSDT | 已连上"));
  assert.ok(reply.includes("Binance现货: IBMUSDT | 未上现货"));
  assert.ok(reply.includes("当前使用: Binance USD-M Futures"));
  assert.ok(reply.includes("当前合约: IBMUSDT"));
  assert.ok(reply.includes("Hyperliquid候选: xyz:IBM | 已连上"));
});

test("builds a source reply for a topic without a complete futures strategy", () => {
  const reply = buildTopicReply({
    command: "source",
    messageThreadId: 529,
    topicMap: { MCDUSDT: 529 },
    snapshot: {
      tradeIdeas: [],
      stocks: [
        { symbol: "MCD", provider: "stooq", price: 300, changePercent: 0.1, high: 301, low: 299, quoteVolume: 1000 }
      ]
    }
  });

  assert.ok(reply.includes("标的: MCDUSDT"));
  assert.ok(reply.includes("公司: McDonald's Corporation"));
  assert.ok(reply.includes("美股现货: MCD.US"));
  assert.ok(reply.includes("Binance合约: MCDUSDT | 未连上"));
  assert.ok(reply.includes("Binance现货: MCDUSDT | 未上现货"));
  assert.ok(reply.includes("当前使用: 无完整K线策略"));
  assert.ok(reply.includes("Hyperliquid候选: xyz:MCD | 未连上"));
  assert.ok(reply.includes("快照来源: stooq"));
});

test("builds the best configured topic signal on request", () => {
  const common = {
    market: "futures",
    direction: "SHORT",
    action: "SELL",
    entry: 100,
    takeProfit: 90,
    stopLoss: 105,
    winProbability: 0.62,
    riskReward: 2,
    support: 88,
    resistance: 120,
    indicators: {
      ema20: 96,
      ema60: 110,
      rsi: 35,
      macdHistogram: -1.4,
      atr: 3,
      volumeRatio: 1.2,
      newsScore: 0
    },
    reason: "EMA20 below EMA60"
  };

  const reply = buildTopicReply({
    command: "best",
    messageThreadId: 3,
    topicMap: { BTCUSDT: 3, ETHUSDT: 4 },
    snapshot: {
      tradeIdeas: [
        { ...common, symbol: "BTCUSDT", convictionScore: 70, confidence: "MEDIUM" },
        { ...common, symbol: "ETHUSDT", convictionScore: 81, confidence: "HIGH" },
        { ...common, symbol: "XRPUSDT", convictionScore: 99, confidence: "HIGH" }
      ],
      bestSignal: {
        marketContext: { riskMode: "risk_off", btcDirection: "SHORT" }
      }
    }
  });

  assert.ok(reply.includes("最高置信方向"));
  assert.ok(reply.includes("标的: ETHUSDT"));
  assert.equal(reply.includes("XRPUSDT"), false);
});

test("builds an id reply for topic diagnostics", () => {
  const reply = buildTopicReply({
    command: "id",
    messageThreadId: 7,
    chatId: -100123,
    topicMap: { AAPLUSDT: 7 },
    snapshot: {}
  });

  assert.ok(reply.includes("chat_id: -100123"));
  assert.ok(reply.includes("message_thread_id: 7"));
  assert.ok(reply.includes("symbol: AAPLUSDT"));
});
