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
  assert.equal(commandFromText("/positions"), "positions");
  assert.equal(commandFromText("/仓位"), "positions");
  assert.equal(commandFromText("/daily"), "daily");
  assert.equal(commandFromText("/日报"), "daily");
  assert.equal(commandFromText("/attribution"), "attribution");
  assert.equal(commandFromText("/归因"), "attribution");
  assert.equal(commandFromText("/calibration"), "calibration");
  assert.equal(commandFromText("/胜率"), "calibration");
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
            source: "Binance USD-M Futures last",
            symbol: "IBMUSDT",
            price: 300.47,
            realtime: true
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
  assert.ok(reply.includes("实时报价源: Binance"));
  assert.ok(reply.includes("交易所实时价: 300.47"));
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

test("builds a paper account reply without requiring a symbol topic mapping", () => {
  const reply = buildTopicReply({
    command: "positions",
    messageThreadId: 2597,
    chatId: -100123,
    topicMap: { BTCUSDT: 3 },
    snapshot: {
      paperAccount: {
        enabled: true,
        initialBalance: 10000,
        balance: 9800,
        equity: 10120,
        maxDrawdownPercent: 0.03,
        openPositionCount: 1,
        openPositions: [
          {
            id: "PAPER-1",
            symbol: "ETHUSDT",
            direction: "LONG",
            entryPrice: 3000,
            currentPrice: 3040,
            takeProfit: 3180,
            stopLoss: 2940,
            riskAmount: 200,
            riskReward: 3,
            unrealizedPnl: 120
          }
        ],
        recentOpenHistory: [],
        recentRiskEvents: [],
        config: {
          positionRisk: {
            enabled: true,
            maxRiskPerTrade: 0.02
          }
        },
        stats: {
          total: {
            trades: 3,
            wins: 2,
            winRate: 0.667,
            long: { trades: 2, wins: 1 },
            short: { trades: 1, wins: 1 }
          },
          periods: {
            day: { trades: 1, wins: 1, winRate: 1 },
            week: { trades: 3, wins: 2, winRate: 0.667 },
            month: { trades: 3, wins: 2, winRate: 0.667 },
            year: { trades: 3, wins: 2, winRate: 0.667 }
          }
        }
      }
    }
  });

  assert.ok(reply.includes("💼 仓位 / 模拟账户"));
  assert.ok(reply.includes("触发: 命令查询"));
  assert.ok(reply.includes("ETHUSDT LONG"));
  assert.ok(reply.includes("当前持仓: 1"));
});

test("builds a paper daily summary reply without requiring a symbol topic mapping", () => {
  const reply = buildTopicReply({
    command: "daily",
    messageThreadId: 2597,
    chatId: -100123,
    topicMap: { BTCUSDT: 3 },
    now: () => Date.UTC(2026, 5, 5, 1, 0, 0),
    snapshot: {
      paperAccount: {
        enabled: true,
        initialBalance: 10000,
        balance: 10060,
        equity: 10120,
        maxDrawdownPercent: 1.3,
        openPositionCount: 1,
        openPositions: [
          { symbol: "ETHUSDT", direction: "LONG", entryPrice: 3000, currentPrice: 3060, takeProfit: 3180, stopLoss: 2940, riskAmount: 200, riskReward: 3, unrealizedPnl: 120 }
        ],
        recentOpenHistory: [
          { id: "PAPER-2", status: "CLOSED", symbol: "BNBUSDT", direction: "SHORT", closedAt: "2026-06-05T02:00:00.000Z", closeReason: "TAKE_PROFIT", entryPrice: 588, exitPrice: 570, netPnl: 45, returnPercent: 2.1 }
        ],
        recentClosedTrades: [
          { id: "PAPER-2", status: "CLOSED", symbol: "BNBUSDT", direction: "SHORT", closedAt: "2026-06-05T02:00:00.000Z", closeReason: "TAKE_PROFIT", entryPrice: 588, exitPrice: 570, netPnl: 45, returnPercent: 2.1 }
        ],
        recentRiskEvents: [],
        equityCurve: [
          { at: "2026-06-05T00:00:00.000Z", equity: 10000 },
          { at: "2026-06-05T08:00:00.000Z", equity: 10120 }
        ],
        stats: {
          periods: {
            day: {
              trades: 1,
              wins: 1,
              losses: 0,
              netPnl: 45,
              winRate: 100,
              long: { trades: 0, wins: 0, losses: 0, netPnl: 0, winRate: 0 },
              short: { trades: 1, wins: 1, losses: 0, netPnl: 45, winRate: 100 }
            }
          }
        },
        config: {
          riskPerTrade: 0.02,
          maxOpenPositions: 6,
          positionRisk: { enabled: true, dailyMaxLossPercent: 0.03, weeklyMaxLossPercent: 0.07, maxConsecutiveLosses: 4 }
        }
      }
    }
  });

  assert.ok(reply.includes("📆 每日交易结果总结"));
  assert.ok(reply.includes("触发: 命令查询"));
  assert.ok(reply.includes("今日平仓: 1"));
  assert.ok(reply.includes("ETHUSDT LONG"));
});

test("builds a strategy attribution reply without requiring a symbol topic mapping", () => {
  const reply = buildTopicReply({
    command: "attribution",
    messageThreadId: 2679,
    chatId: -100123,
    topicMap: { BTCUSDT: 3 },
    snapshot: {
      performanceAttribution: {
        generatedAt: "2026-06-05T09:00:00.000Z",
        total: {
          signals: 12,
          reviewed: 6,
          successes: 4,
          failures: 2,
          pending: 1,
          successRate: 66.67,
          paperTrades: 3,
          paperWins: 2,
          paperLosses: 1,
          paperBreakeven: 0,
          paperWinRate: 66.67,
          netPnl: 128.45,
          avgPnl: 42.82,
          score: 0.68,
          sampleScore: 0.55
        },
        strengths: [
          { label: "ETHUSDT:SHORT", reviewed: 3, successes: 3, failures: 0, paperTrades: 1, paperWins: 1, paperLosses: 0, paperWinRate: 100, netPnl: 75, score: 0.83, sampleScore: 0.5 }
        ],
        weaknesses: [],
        recommendations: ["优先保留强项: ETHUSDT:SHORT。"],
        policyHints: {
          boost: ["ETHUSDT:SHORT"],
          reduce: [],
          avoidSymbols: []
        }
      }
    }
  });

  assert.ok(reply.includes("🧠 策略归因"));
  assert.ok(reply.includes("触发: 命令查询"));
  assert.ok(reply.includes("ETHUSDT:SHORT"));
});

test("builds a probability calibration reply without requiring a symbol topic mapping", () => {
  const reply = buildTopicReply({
    command: "calibration",
    messageThreadId: 2683,
    chatId: -100123,
    topicMap: { BTCUSDT: 3 },
    snapshot: {
      probabilityCalibration: {
        generatedAt: "2026-06-05T09:00:00.000Z",
        status: "ok",
        overall: {
          samples: 18,
          successes: 11,
          failures: 7,
          predictedAvg: 65.4,
          realizedRate: 61.11,
          overconfidence: 4.29,
          expectedCalibrationError: 7.8,
          brierScore: 0.2123
        },
        buckets: [
          { key: "65-70", samples: 8, successes: 6, failures: 2, predictedAvg: 66.2, realizedRate: 75, calibrationError: 8.8, reliability: 0.47 }
        ],
        directions: {
          long: { samples: 7, successes: 3, failures: 4, realizedRate: 42.86 },
          short: { samples: 11, successes: 8, failures: 3, realizedRate: 72.73 }
        },
        symbols: [
          { symbol: "ETHUSDT", samples: 6, successes: 5, failures: 1, predictedAvg: 64, realizedRate: 83.33 }
        ]
      }
    }
  });

  assert.ok(reply.includes("🎚️ 胜率校准"));
  assert.ok(reply.includes("触发: 命令查询"));
  assert.ok(reply.includes("65-70"));
  assert.ok(reply.includes("ETHUSDT"));
});
