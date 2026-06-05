import assert from "node:assert/strict";
import test from "node:test";

import {
  formatBestSignalMessage,
  formatMarketReversalMessage,
  formatSignalMessage,
  formatTopicStatusMessage,
  formatTradeIdeaMessage,
  normalizeTelegramTopicSymbol,
  parseTelegramTopicMap,
  resolveTelegramTopic,
  sendCompleteTopicNotification,
  sendLarkMessage,
  sendSignalNotifications,
  sendMarketReversalNotifications,
  sendTopicStatusNotifications,
  sendTelegramRoutedMessage,
  sendTelegramMessage,
  sendTelegramSymbolMessage
} from "../src/notifiers.js";

test("Telegram sender skips when token or chat id is missing", async () => {
  const result = await sendTelegramMessage({
    token: "",
    chatId: "",
    text: "BTCUSDT breakout"
  });

  assert.deepEqual(result, { ok: false, skipped: true, reason: "missing_telegram_config" });
});

test("Telegram sender posts JSON to sendMessage endpoint", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, result: { message_id: 123 } };
      }
    };
  };

  const result = await sendTelegramMessage({
    token: "token-123",
    chatId: "chat-456",
    text: "BTCUSDT breakout",
    now: () => Date.UTC(2026, 5, 4, 3, 5, 6),
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://api.telegram.org/bottoken-123/sendMessage");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    chat_id: "chat-456",
    text: "BTCUSDT breakout\n\n北京时间: 2026-06-04 11:05:06",
    disable_web_page_preview: true
  });
});

test("Telegram sender appends Beijing time to every message", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      }
    };
  };

  await sendTelegramMessage({
    token: "token-123",
    chatId: "-100123",
    text: "ETHUSDT signal",
    now: () => Date.UTC(2026, 0, 1, 16, 30, 45),
    fetchImpl
  });

  assert.equal(
    JSON.parse(calls[0].options.body).text,
    "ETHUSDT signal\n\n北京时间: 2026-01-02 00:30:45"
  );
});

test("Telegram sender includes message_thread_id for forum topics", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, result: { message_id: 321 } };
      }
    };
  };

  await sendTelegramMessage({
    token: "token-123",
    chatId: "-100123",
    messageThreadId: 77,
    text: "BTCUSDT signal",
    now: () => Date.UTC(2026, 5, 4, 3, 5, 6),
    fetchImpl
  });

  assert.equal(JSON.parse(calls[0].options.body).message_thread_id, 77);
});

test("Telegram sender retries after rate limiting", async () => {
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return {
        ok: false,
        status: 429,
        async json() {
          return { ok: false, parameters: { retry_after: 0 } };
        }
      };
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, result: { message_id: 456 } };
      }
    };
  };

  const result = await sendTelegramMessage({
    token: "token-123",
    chatId: "-100123",
    text: "rate limited message",
    now: () => Date.UTC(2026, 5, 4, 3, 5, 6),
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(sleeps.length, 1);
});

test("parses Telegram topic route mapping from JSON", () => {
  const map = parseTelegramTopicMap('{"BTCUSDT": 11, "ETH USDT": 22, "QQQ": 33}');

  assert.deepEqual(map, {
    BTCUSDT: 11,
    ETHUSDT: 22,
    QQQUSDT: 33
  });
});

test("normalizes gold oil and stock topic aliases", () => {
  assert.equal(normalizeTelegramTopicSymbol("GOLD"), "XAUUSD");
  assert.equal(normalizeTelegramTopicSymbol("GLD"), "XAUUSD");
  assert.equal(normalizeTelegramTopicSymbol("黄金"), "XAUUSD");
  assert.equal(normalizeTelegramTopicSymbol("OIL"), "CL.F");
  assert.equal(normalizeTelegramTopicSymbol("原油"), "CL.F");
  assert.equal(normalizeTelegramTopicSymbol("APPLE"), "AAPLUSDT");
});

test("normalizes Hyperliquid USDC topic labels to strategy symbols", () => {
  assert.equal(normalizeTelegramTopicSymbol("NVDA-USDC"), "NVDAUSDT");
  assert.equal(normalizeTelegramTopicSymbol("HYPE-USDC"), "HYPEUSDT");
  assert.equal(normalizeTelegramTopicSymbol("XYZ100-USDC"), "XYZ100USDT");
  assert.equal(normalizeTelegramTopicSymbol("S&P500-USDC"), "SP500USDT");
  assert.equal(normalizeTelegramTopicSymbol("WTIOIL-USDC"), "CL.F");
  assert.equal(normalizeTelegramTopicSymbol("BRENTOIL-USDC"), "BRENTOIL");
  assert.equal(normalizeTelegramTopicSymbol("SILVER-USDC"), "XAGUSD");
});

test("normalizes newly added Telegram topic labels", () => {
  assert.equal(normalizeTelegramTopicSymbol("MSFT USDT"), "MSFTUSDT");
  assert.equal(normalizeTelegramTopicSymbol("GOOG USDT"), "GOOGUSDT");
  assert.equal(normalizeTelegramTopicSymbol("BZ USDT"), "BZUSDT");
  assert.equal(normalizeTelegramTopicSymbol("XAU USDT"), "XAUUSD");
  assert.equal(normalizeTelegramTopicSymbol("XAG USDT"), "XAGUSD");
  assert.equal(normalizeTelegramTopicSymbol("CL USDT"), "CL.F");
});

test("resolves topic id with normalized symbols and aliases", () => {
  const topicMap = { BTCUSDT: 11, ETHUSDT: 22, QQQUSDT: 33 };

  assert.equal(resolveTelegramTopic("BTCUSDT", topicMap), 11);
  assert.equal(resolveTelegramTopic("ETH USDT", topicMap), 22);
  assert.equal(resolveTelegramTopic("QQQ", topicMap), 33);
});

test("symbol Telegram sender routes messages to matching topic", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      }
    };
  };

  const result = await sendTelegramSymbolMessage({
    token: "token-123",
    chatId: "-100123",
    topicMap: { BTCUSDT: 11 },
    symbol: "BTCUSDT",
    text: "BTC signal",
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.parse(calls[0].options.body).message_thread_id, 11);
});

test("routed Telegram sender falls back to normal chat when topic is missing", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      }
    };
  };

  await sendTelegramRoutedMessage({
    token: "token-123",
    chatId: "-100123",
    topicMap: {},
    symbol: "UNKNOWNUSDT",
    text: "fallback",
    fetchImpl
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_id, "-100123");
  assert.equal(body.message_thread_id, undefined);
});

test("Lark sender posts text message payload to webhook", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { code: 0 };
      }
    };
  };

  const result = await sendLarkMessage({
    webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/test",
    text: "ETHUSDT volume spike",
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, "https://open.larksuite.com/open-apis/bot/v2/hook/test");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    msg_type: "text",
    content: {
      text: "ETHUSDT volume spike"
    }
  });
});

test("formats market signal messages for chat delivery", () => {
  const text = formatSignalMessage({
    symbol: "BTCUSDT",
    label: "强势下跌",
    market: "crypto",
    price: 67324,
    changePercent: -5.25,
    reason: "BTCUSDT change is -5.25%"
  });

  assert.equal(text, [
    "市场趋势信号",
    "标的: BTCUSDT",
    "市场: crypto",
    "信号: 强势下跌",
    "价格: 67324",
    "涨跌: -5.25%",
    "原因: BTCUSDT change is -5.25%"
  ].join("\n"));
});

test("formats trade idea messages with full professional context", () => {
  const text = formatTradeIdeaMessage(
    {
      symbol: "ETHUSDT",
      market: "futures",
      direction: "SHORT",
      action: "SELL",
      entry: 1767.88,
      takeProfit: 1665.72,
      stopLoss: 1818.96,
      riskReward: 2,
      winProbability: 0.65,
      support: 1712.52,
      resistance: 2022.27,
      indicators: {
        ema20: 1780,
        ema60: 1900,
        rsi: 30.18,
        macdHistogram: -4.2942,
        atr: 34.05,
        volumeRatio: 1.22,
        newsScore: 0
      },
      news: {
        score: 0,
        source: "Alpha Vantage",
        status: "neutral",
        detail: "新闻源已配置，本轮没有明显方向性情绪。"
      },
      dataSource: {
        provider: "Binance USD-M Futures",
        exchange: "Binance",
        reference: "fapi/v1/klines",
        quoteSymbol: "ETHUSDT",
        interval: "1h"
      },
      currentQuote: {
        exchange: "Binance",
        source: "Binance USD-M Futures",
        symbol: "ETHUSDT",
        price: 1767.88
      },
      moneyFlow: {
        status: "outflow",
        biasDirection: "SHORT",
        netFlowPercent: -7.42,
        volumeRatio: 1.22,
        quoteVolume24h: 987654321,
        priceChange24h: -3.2,
        alignment: "aligned",
        detail: "近12根K线资金偏流出，方向支持 SHORT。"
      },
      tradePlaybook: {
        score: 0.82,
        grade: "A",
        decision: "EXECUTE",
        summary: "执行质量 A，允许按计划执行。",
        checks: [
          { name: "趋势共振", status: "PASS", note: "价格/EMA20/EMA60 空头排列" },
          { name: "位置性价比", status: "PASS", note: "目标侧空间约 2.5 ATR" },
          { name: "流动性/量能", status: "PASS", note: "当前成交量倍率 1.22" }
        ],
        risks: []
      },
      previousSignalReview: {
        label: "对",
        outcome: "RIGHT",
        previousDirection: "SHORT",
        previousEntry: 1800,
        previousTakeProfit: 1700,
        previousStopLoss: 1850,
        currentPrice: 1767.88,
        pnlPercent: 1.78,
        detail: "未触发止盈/止损，按当前价相对入场浮动 1.78% 判断。"
      },
      strategyStats: {
        totalSignals: 21,
        reviewedSignals: 10,
        successes: 7,
        failures: 3,
        pending: 2,
        successRate: 70,
        long: { reviewed: 4, successes: 3, failures: 1, pending: 0, successRate: 75 },
        short: { reviewed: 6, successes: 4, failures: 2, pending: 2, successRate: 66.67 },
        periods: {
          day: {
            totalSignals: 3,
            reviewedSignals: 2,
            successes: 1,
            failures: 0,
            pending: 1,
            successRate: 100,
            long: { reviewed: 1, successes: 0, failures: 0, pending: 1, successRate: 0 },
            short: { reviewed: 1, successes: 1, failures: 0, pending: 0, successRate: 100 }
          },
          week: {
            totalSignals: 4,
            reviewedSignals: 3,
            successes: 1,
            failures: 1,
            pending: 1,
            successRate: 50,
            long: { reviewed: 2, successes: 0, failures: 1, pending: 1, successRate: 0 },
            short: { reviewed: 1, successes: 1, failures: 0, pending: 0, successRate: 100 }
          },
          month: {
            totalSignals: 4,
            reviewedSignals: 3,
            successes: 1,
            failures: 1,
            pending: 1,
            successRate: 50,
            long: { reviewed: 2, successes: 0, failures: 1, pending: 1, successRate: 0 },
            short: { reviewed: 1, successes: 1, failures: 0, pending: 0, successRate: 100 }
          },
          year: {
            totalSignals: 5,
            reviewedSignals: 4,
            successes: 2,
            failures: 1,
            pending: 1,
            successRate: 66.67,
            long: { reviewed: 2, successes: 0, failures: 1, pending: 1, successRate: 0 },
            short: { reviewed: 2, successes: 2, failures: 0, pending: 0, successRate: 100 }
          }
        }
      },
      longTermRegime: {
        symbol: "ETHUSDT",
        regime: "bear",
        biasDirection: "SHORT",
        price: 1767.88,
        sma50: 1900,
        sma200: 2100,
        note: "ETHUSDT 日线处于熊市结构，反弹优先找空头性价比。"
      },
      reason: "EMA20 below EMA60; RSI 30.18; MACD histogram -4.2942; news score 0.00"
    },
    {
      marketContext: {
        longTermRegime: {
          symbol: "BTCUSDT",
          regime: "bear",
          biasDirection: "SHORT",
          price: 65000,
          sma50: 72000,
          sma200: 83000,
          note: "BTCUSDT 日线处于熊市结构，反弹优先找空头性价比。"
        }
      }
    }
  );

  assert.equal(text.includes("📌 最高置信方向"), false);
  assert.equal(text.includes("━━━━━━━━━━━━"), false);
  assert.ok(text.startsWith("🎯 标的: ETHUSDT"));
  assert.ok(text.includes("🎯 标的: ETHUSDT"));
  assert.ok(text.includes("⭐ 综合分:"));
  const lines = text.split("\n");
  const scoreLineIndex = lines.findIndex((line) => line.startsWith("⭐ 综合分:"));
  const nextNonEmptyAfterScore = lines.slice(scoreLineIndex + 1).find((line) => line.trim() !== "");
  assert.equal(nextNonEmptyAfterScore, "💰 交易计划");
  const stopLossLineIndex = lines.findIndex((line) => line.startsWith("止损:"));
  const nextNonEmptyAfterPlan = lines.slice(stopLossLineIndex + 1).find((line) => line.trim() !== "");
  assert.equal(nextNonEmptyAfterPlan, "📊 概率/位置");
  assert.ok(text.includes("📡 数据/报价"));
  assert.ok(text.includes("参考数据: Binance USD-M Futures 1h K线"));
  assert.ok(text.includes("报价交易所: Binance"));
  assert.ok(text.includes("交易所报价: 1767.88 (ETHUSDT)"));
  assert.ok(text.includes("💸 资金流向"));
  assert.ok(text.includes("方向: 偏流出 | 支持: SHORT"));
  assert.ok(text.includes("近12根净流: -7.42% | 成交倍率: 1.22"));
  assert.ok(text.includes("24h成交额: 987.65M | 24h涨跌: -3.2%"));
  assert.ok(text.includes("🧑‍💼 交易员检查"));
  assert.ok(text.includes("执行质量: A"));
  assert.ok(text.includes("动作建议: EXECUTE"));
  assert.ok(text.includes("执行分: 0.82"));
  assert.ok(text.includes("✅ 已通过"));
  assert.ok(text.includes("1. 趋势共振"));
  assert.ok(text.includes("价格/EMA20/EMA60 空头排列"));
  assert.equal(text.includes("执行质量: A | EXECUTE | 分数 0.82"), false);
  assert.ok(text.includes("🤖 模型大脑"));
  assert.ok(text.includes("模型: Open Quant Ensemble"));
  assert.ok(text.includes("参考: Qlib / LightGBM / vectorbt / FinRL"));
  assert.ok(text.includes("🔁 上次推送复盘"));
  assert.ok(text.includes("结果: 对 | 上次: SHORT @ 1800"));
  assert.ok(text.includes("当前: 1767.88 | 浮动: 1.78%"));
  assert.ok(text.includes("📈 累计表现"));
  assert.equal(text.includes("总推送: 21 | 已复盘: 10"), false);
  assert.ok(text.includes("今日: 推送 3 | 复盘 2 | 成 1 | 败 0 | 观 1 | 胜率 100%"));
  assert.ok(text.includes("今日多空: 多 0/1 | 空 1/1"));
  assert.ok(text.includes("本周: 推送 4 | 复盘 3 | 成 1 | 败 1 | 观 1 | 胜率 50%"));
  assert.ok(text.includes("本月: 推送 4 | 复盘 3 | 成 1 | 败 1 | 观 1 | 胜率 50%"));
  assert.ok(text.includes("本年: 推送 5 | 复盘 4 | 成 2 | 败 1 | 观 1 | 胜率 66.67%"));
  assert.ok(text.includes("本年多空: 多 0/2 | 空 2/2"));
  assert.ok(text.includes("📰 新闻面"));
  assert.ok(text.includes("说明: 中性"));
  assert.equal(text.includes("说明: 新闻源已配置，本轮没有明显方向性情绪。"), false);
  assert.equal(text.includes("新闻源已配置"), false);
  assert.ok(text.includes("📈 标的长期趋势"));
  assert.ok(text.includes("ETHUSDT结构: 熊市 | 偏向: SHORT"));
  assert.ok(text.includes("ETHUSDT日线: 1767.88 | MA50: 1900 | MA200: 2100"));
  assert.ok(text.includes("说明: ETHUSDT 日线处于熊市结构"));
  assert.ok(text.includes("🌍 大盘环境"));
  assert.ok(text.includes("BTCUSDT结构: 熊市 | 偏向: SHORT"));
  assert.equal(text.includes("🌍 长期趋势"), false);
  assert.ok(text.includes("🧭 执行条件"));
  assert.ok(text.includes("✅ 主要依据"));
  assert.ok(text.includes("⚠️ 主要风险"));
  assert.equal(text.includes("🛡️ 风控建议"), false);
  assert.equal(text.includes("单笔风险按账户可承受亏损控制"), false);
  assert.ok(text.split("\n\n").length >= 5);
});

test("signal notification uses full trade idea when available", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      }
    };
  };

  await sendSignalNotifications({
    signal: {
      symbol: "BTCUSDT",
      label: "强势下跌",
      market: "crypto",
      price: 62314,
      changePercent: -5.25,
      reason: "BTCUSDT change is -5.25%"
    },
    telegram: {
      token: "token-123",
      chatId: "-100123",
      topicMap: { BTCUSDT: 3 },
      now: () => Date.UTC(2026, 5, 4, 3, 5, 6)
    },
    tradeIdea: {
      symbol: "BTCUSDT",
      direction: "SHORT",
      action: "SELL",
      entry: 62314,
      takeProfit: 59767,
      stopLoss: 63588,
      winProbability: 0.63,
      riskReward: 2,
      support: 61000,
      resistance: 65000,
      indicators: {
        ema20: 61000,
        ema60: 63000,
        rsi: 38,
        macdHistogram: -2.1,
        atr: 500,
        volumeRatio: 1.1,
        newsScore: 0
      },
      news: {
        score: 0,
        source: "Alpha Vantage",
        status: "neutral",
        detail: "新闻源已配置，本轮没有明显方向性情绪。"
      },
      reason: "EMA20 below EMA60"
    },
    fetchImpl
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.text.includes("📌 最高置信方向"), false);
  assert.equal(body.text.includes("━━━━━━━━━━━━"), false);
  assert.ok(body.text.endsWith("北京时间: 2026-06-04 11:05:06"));
  assert.ok(body.text.includes("🎯 标的: BTCUSDT"));
  assert.ok(body.text.includes("⭐ 综合分:"));
  assert.ok(body.text.includes("📰 新闻面"));
  assert.ok(body.text.includes("入场: 62314"));
  assert.ok(body.text.includes("止盈: 59767"));
  assert.ok(body.text.includes("止损: 63588"));
  assert.equal(body.text.includes("🛡️ 风控建议"), false);
});

test("signal notification dispatcher skips unconfigured channels", async () => {
  const result = await sendSignalNotifications({
    signal: {
      symbol: "BTCUSDT",
      label: "强势下跌",
      market: "crypto",
      price: 67324,
      changePercent: -5.25,
      reason: "BTCUSDT change is -5.25%"
    }
  });

  assert.deepEqual(result.telegram, { ok: false, skipped: true, reason: "missing_telegram_topic", symbol: "BTCUSDT" });
  assert.deepEqual(result.lark, { ok: false, skipped: true, reason: "missing_lark_config" });
});

test("formats best-signal messages with top conviction details", () => {
  const text = formatBestSignalMessage({
    symbol: "BTCUSDT",
    direction: "LONG",
    action: "BUY",
    convictionScore: 82,
    confidence: "HIGH",
    entry: 100,
    takeProfit: 112,
    stopLoss: 94,
    winProbability: 0.66,
    support: 92,
    resistance: 118,
    summary: "BTCUSDT LONG is the best signal",
    supporting: ["EMA trend supports long"],
    risks: ["news neutral"]
  });

  assert.equal(text.includes("📌 最高置信方向"), false);
  assert.equal(text.includes("━━━━━━━━━━━━"), false);
  assert.ok(text.startsWith("🎯 标的: BTCUSDT"));
  assert.ok(text.includes("⭐ 综合分: 82"));
  assert.ok(text.includes("✅ 主要依据"));
  assert.ok(text.includes("• EMA trend supports long"));
});

test("formats adaptive strategy feedback in trade idea messages", () => {
  const text = formatTradeIdeaMessage({
    symbol: "BTCUSDT",
    market: "futures",
    direction: "SHORT",
    action: "SELL",
    entry: 65000,
    takeProfit: 62000,
    stopLoss: 66500,
    winProbability: 0.64,
    riskReward: 2,
    support: 61000,
    resistance: 67000,
    indicators: {
      ema20: 64000,
      ema60: 66000,
      rsi: 43,
      macdHistogram: -10,
      atr: 900,
      volumeRatio: 1.2,
      newsScore: -0.1
    },
    strategyFeedback: {
      sampleSize: 5,
      successes: 4,
      failures: 1,
      successRate: 80,
      consecutiveFailures: 0,
      consecutiveSuccesses: 2,
      score: 0.82,
      adjustment: 3.2,
      note: "BTCUSDT SHORT 历史复盘 4/5，成功率 80%，连续对 2 次，策略反馈加 3.2 分。"
    },
    reason: "EMA20 below EMA60; RSI 43; MACD histogram -10"
  });

  assert.ok(text.includes("🧠 策略反馈"));
  assert.ok(text.includes("样本: 5 | 成功率: 80%"));
  assert.ok(text.includes("连续对: 2 | 连续错: 0"));
  assert.ok(text.includes("调整: +3.2"));
});

test("formats market reversal messages", () => {
  const text = formatMarketReversalMessage({
    symbol: "MARKET",
    direction: "SHORT",
    action: "RISK_OFF",
    previousBias: "LONG",
    currentBias: "SHORT",
    previousRiskMode: "risk_on",
    currentRiskMode: "risk_off",
    previousRegime: "bull",
    currentRegime: "bear",
    convictionScore: 78,
    confidence: "MEDIUM",
    summary: "大盘信号反转：LONG -> SHORT。",
    bestSignal: {
      symbol: "BTCUSDT",
      direction: "SHORT",
      convictionScore: 78
    },
    supporting: ["BTC偏向 LONG -> SHORT"],
    risks: ["大盘反转初期容易反复"]
  });

  assert.ok(text.startsWith("🔄 大盘信号反转"));
  assert.ok(text.includes("方向: LONG -> SHORT | RISK_OFF"));
  assert.ok(text.includes("风险模式: risk_on -> risk_off"));
  assert.ok(text.includes("最高置信: BTCUSDT SHORT | 综合分 78"));
});

test("formats topic status messages for stocks without a complete strategy", () => {
  const text = formatTopicStatusMessage({
    symbol: "MCDUSDT",
    ticker: {
      symbol: "MCD",
      market: "stocks",
      provider: "stooq",
      price: 300,
      changePercent: 0.1
    }
  });

  assert.ok(text.startsWith("📡 Topic 数据更新"));
  assert.ok(text.includes("🎯 标的: MCDUSDT"));
  assert.ok(text.includes("公司: McDonald's Corporation"));
  assert.ok(text.includes("状态: 无完整K线策略"));
  assert.ok(text.includes("当前报价: 300"));
  assert.ok(text.includes("快照来源: stooq"));
  assert.ok(text.includes("美股现货: MCD.US"));
  assert.ok(text.includes("Binance合约: MCDUSDT | 未连上"));
  assert.ok(text.includes("说明: 当前只能快照观察"));
  assert.equal(text.includes("入场:"), false);
  assert.equal(text.includes("止盈:"), false);
  assert.equal(text.includes("止损:"), false);
});

test("topic status notifications route neutral or no-strategy updates to the matching topic", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      }
    };
  };

  const result = await sendTopicStatusNotifications({
    symbol: "MCDUSDT",
    telegram: {
      token: "token-123",
      chatId: "-100123",
      topicMap: { MCDUSDT: 529 },
      now: () => Date.UTC(2026, 5, 4, 20, 6, 7)
    },
    ticker: {
      symbol: "MCD",
      market: "stocks",
      provider: "stooq",
      price: 300,
      changePercent: 0.1
    },
    fetchImpl
  });

  assert.equal(result.telegram.ok, true);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.message_thread_id, 529);
  assert.ok(body.text.includes("Topic 数据更新"));
  assert.ok(body.text.includes("🎯 标的: MCDUSDT"));
  assert.ok(body.text.endsWith("北京时间: 2026-06-05 04:06:07"));
});

test("complete topic notification sends full trade idea messages for actionable ideas", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      }
    };
  };

  const result = await sendCompleteTopicNotification({
    symbol: "BTCUSDT",
    kind: "trade_idea",
    idea: {
      symbol: "BTCUSDT",
      direction: "SHORT",
      action: "SELL",
      entry: 65000,
      takeProfit: 62000,
      stopLoss: 66500,
      winProbability: 0.64,
      riskReward: 2,
      support: 61000,
      resistance: 67000,
      indicators: {
        ema20: 64000,
        ema60: 66000,
        rsi: 43,
        macdHistogram: -10,
        atr: 900,
        volumeRatio: 1.2,
        newsScore: -0.1
      },
      reason: "EMA20 below EMA60; RSI 43; MACD histogram -10"
    },
    telegram: {
      token: "token-123",
      chatId: "-100123",
      topicMap: { BTCUSDT: 11 },
      now: () => Date.UTC(2026, 5, 5, 4, 0, 0)
    },
    fetchImpl
  });

  assert.equal(result.telegram.ok, true);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.message_thread_id, 11);
  assert.ok(body.text.includes("💰 交易计划"));
  assert.ok(body.text.includes("📊 概率/位置"));
});

test("market reversal notifications fall back to the main chat when MARKET topic is missing", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      }
    };
  };

  await sendMarketReversalNotifications({
    signal: {
      symbol: "MARKET",
      direction: "SHORT",
      action: "RISK_OFF",
      previousBias: "LONG",
      currentBias: "SHORT",
      previousRiskMode: "risk_on",
      currentRiskMode: "risk_off",
      previousRegime: "bull",
      currentRegime: "bear",
      summary: "大盘信号反转：LONG -> SHORT。"
    },
    telegram: {
      token: "token-123",
      chatId: "-100123",
      topicMap: { BTCUSDT: 3 },
      now: () => Date.UTC(2026, 5, 4, 3, 5, 6)
    },
    fetchImpl
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.message_thread_id, undefined);
  assert.ok(body.text.includes("🔄 大盘信号反转"));
});
