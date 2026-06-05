import { scoreTradeIdea } from "./conviction.js";
import { equityMetadataForSymbol, sourceStatusLabel } from "./equity-metadata.js";

let telegramSendQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueTelegramSend(task) {
  const run = telegramSendQueue.then(task, task);
  telegramSendQueue = run.catch(() => {});
  return run;
}

function retryAfterMs(body) {
  const seconds = Number(body?.parameters?.retry_after ?? 0);
  return Number.isFinite(seconds) && seconds > 0 ? (seconds * 1000) + 250 : 0;
}

function formatBeijingTimestamp(now = Date.now) {
  const date = new Date(typeof now === "function" ? now() : now);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";

  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}:${value("second")}`;
}

function textWithBeijingTime(text, now) {
  return `${text}\n\n北京时间: ${formatBeijingTimestamp(now)}`;
}

async function sendTelegramMessageOnce({ token, chatId, messageThreadId, text, fetchImpl }) {
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };

  if (messageThreadId !== undefined && messageThreadId !== null) {
    body.message_thread_id = Number(messageThreadId);
  }

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await response.json()
  };
}

export async function sendTelegramMessage({
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  messageThreadId,
  text,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  maxRetries = 2,
  now = Date.now
}) {
  if (!token || !chatId) {
    return { ok: false, skipped: true, reason: "missing_telegram_config" };
  }

  const timestampedText = textWithBeijingTime(text, now);

  return enqueueTelegramSend(async () => {
    let lastResult = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      lastResult = await sendTelegramMessageOnce({
        token,
        chatId,
        messageThreadId,
        text: timestampedText,
        fetchImpl
      });

      if (lastResult.status !== 429 || attempt === maxRetries) return lastResult;
      await sleepImpl(retryAfterMs(lastResult.body));
    }

    return lastResult;
  });
}

export function normalizeTelegramTopicSymbol(symbol) {
  if (String(symbol).includes("黄金")) return "XAUUSD";
  if (String(symbol).includes("原油") || String(symbol).includes("石油")) return "CL.F";
  if (String(symbol).includes("白银")) return "XAGUSD";

  const compact = String(symbol ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!compact) return "";

  function symbolFromQuotedBase(base) {
    const baseAliases = {
      APPLE: "AAPL",
      SANDP500: "SP500",
      SNP500: "SP500",
      SPX500: "SP500",
      NASDAQ100: "XYZ100",
      NAS100: "XYZ100",
      NQ: "XYZ100",
      WTIOIL: "CL",
      WTI: "CL",
      CRUDE: "CL",
      OIL: "CL",
      BZ: "BZ",
      BRENT: "BRENTOIL"
    };
    const canonicalBase = baseAliases[base] ?? base;

    if (["GOLD", "XAU", "GLD"].includes(canonicalBase)) return "XAUUSD";
    if (["SILVER", "XAG"].includes(canonicalBase)) return "XAGUSD";
    if (["CL", "CLF"].includes(canonicalBase)) return "CL.F";
    if (canonicalBase === "BRENTOIL") return "BRENTOIL";
    if (["SP500", "XYZ100"].includes(canonicalBase)) return `${canonicalBase}USDT`;

    return `${canonicalBase}USDT`;
  }

  if (compact.endsWith("USDC")) return symbolFromQuotedBase(compact.slice(0, -4));
  if (compact.endsWith("USDT")) return symbolFromQuotedBase(compact.slice(0, -4));

  const nonUsdtAliases = {
    GOLD: "XAUUSD",
    XAU: "XAUUSD",
    XAUUSD: "XAUUSD",
    GLD: "XAUUSD",
    SILVER: "XAGUSD",
    XAG: "XAGUSD",
    XAGUSD: "XAGUSD",
    OIL: "CL.F",
    CRUDE: "CL.F",
    WTI: "CL.F",
    WTIOIL: "CL.F",
    CL: "CL.F",
    CLF: "CL.F",
    BZ: "BZUSDT",
    BRENT: "BRENTOIL",
    BRENTOIL: "BRENTOIL",
    USO: "USO",
    SPY: "SPYUSDT",
    SP500: "SP500USDT",
    SANDP500: "SP500USDT",
    SNP500: "SP500USDT",
    XYZ100: "XYZ100USDT",
    NASDAQ100: "XYZ100USDT",
    NAS100: "XYZ100USDT"
  };

  if (nonUsdtAliases[compact]) return nonUsdtAliases[compact];

  const stockAliases = new Set([
    "QQQ",
    "NVDA",
    "AAPL",
    "APPLE",
    "MSFT",
    "SNDK",
    "NOW",
    "TSLA",
    "ORCL",
    "AMD",
    "GOOG",
    "GOOGL",
    "META",
    "CRCL",
    "SPCX",
    "DELL",
    "IBM",
    "TSM",
    "SMCI",
    "QCOM",
    "MSTR",
    "WMT",
    "MCD",
    "SOXL",
    "EWY",
    "ARM",
    "COIN",
    "MU",
    "MRVL",
    "INTC",
    "NOK",
    "AVGO",
    "HYPE",
    "ZEC",
    "SOL"
  ]);
  if (stockAliases.has(compact)) {
    return `${compact === "APPLE" ? "AAPL" : compact}USDT`;
  }

  return compact;
}

export function parseTelegramTopicMap(raw = process.env.TELEGRAM_TOPIC_MAP ?? "{}") {
  if (!raw) return {};
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  const normalized = {};

  for (const [symbol, threadId] of Object.entries(parsed)) {
    const normalizedSymbol = normalizeTelegramTopicSymbol(symbol);
    if (normalizedSymbol) normalized[normalizedSymbol] = Number(threadId);
  }

  return normalized;
}

export function resolveTelegramTopic(symbol, topicMap = parseTelegramTopicMap()) {
  const normalized = normalizeTelegramTopicSymbol(symbol);
  return topicMap[normalized];
}

export async function sendLarkMessage({
  webhookUrl = process.env.LARK_WEBHOOK_URL,
  text,
  fetchImpl = globalThis.fetch
}) {
  if (!webhookUrl) {
    return { ok: false, skipped: true, reason: "missing_lark_config" };
  }

  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      msg_type: "text",
      content: { text }
    })
  });

  return {
    ok: response.ok,
    status: response.status,
    body: await response.json()
  };
}

export function formatSignalMessage(signal) {
  return [
    "市场趋势信号",
    `标的: ${signal.symbol}`,
    `市场: ${signal.market}`,
    `信号: ${signal.label}`,
    `价格: ${signal.price}`,
    `涨跌: ${signal.changePercent.toFixed(2)}%`,
    `原因: ${signal.reason}`
  ].join("\n");
}

function formatPercent(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function scoreForMessage(idea, { marketContext = {} } = {}) {
  if (idea.convictionScore !== undefined) return idea;
  return scoreTradeIdea(idea, { marketContext }) ?? {
    ...idea,
    convictionScore: 0,
    confidence: "LOW",
    supporting: [],
    risks: []
  };
}

function defaultSupporting(scored) {
  return [
    `胜率估算 ${formatPercent(scored.winProbability ?? 0)}`,
    technicalReason(scored.reason),
    `支撑 ${scored.support} / 压力 ${scored.resistance}`,
    `风险收益比 ${scored.riskReward}`,
    scored.indicators?.volumeRatio !== undefined ? `成交量倍率 ${scored.indicators.volumeRatio}` : null,
    scored.indicators?.atr !== undefined ? `ATR ${scored.indicators.atr}` : null
  ].filter(Boolean);
}

function technicalReason(reason) {
  return String(reason ?? "")
    .replace(/;?\s*news score [-0-9.]+/i, "")
    .trim();
}

function risksForMessage(scored) {
  const risks = [...(scored.risks ?? [])]
    .filter((risk) => risk !== "市场环境 unknown")
    .map((risk) => {
      if (risk === "市场环境 mixed") return "市场环境暂未形成单边共振";
      if (String(risk).includes("新闻源已配置") || String(risk).includes("新闻情绪未配置")) return "新闻面中性";
      return risk;
    });
  if (risks.length === 0) {
    risks.push("价格接近止损或突破关键支撑/压力时信号失效");
  }
  return risks;
}

function executionCondition(scored) {
  if (scored.action === "WAIT") {
    return "方向有倾向但当前风险收益比或执行质量未达标，等待回踩/反抽到更好入场位后再触发。";
  }

  if (scored.direction === "SHORT") {
    return `价格接近入场且未放量站回 ${scored.stopLoss} 上方；若站回止损位，SHORT 信号失效。`;
  }

  if (scored.direction === "LONG") {
    return `价格接近入场且未放量跌破 ${scored.stopLoss} 下方；若跌破止损位，LONG 信号失效。`;
  }

  return "方向不明确时不追单，等待趋势和量能重新共振。";
}

function directionEmoji(direction) {
  if (direction === "LONG") return "📈";
  if (direction === "SHORT") return "📉";
  return "⏸️";
}

function newsStatusLabel(status) {
  const labels = {
    scored: "有情绪信号",
    neutral: "中性",
    timeout: "请求超时",
    unavailable: "限流/无权限/无有效数据",
    unconfigured: "未配置"
  };
  return labels[status] ?? status ?? "未知";
}

function conciseNewsDetail(news) {
  if (news.status === "unconfigured") return "未配置";
  if (news.status === "timeout") return "超时按中性";
  if (news.status === "unavailable") return "不可用按中性";

  const score = Number(news.score ?? 0);
  if (score > 0.05) return "偏多";
  if (score < -0.05) return "偏空";
  return "中性";
}

function formatNewsBlock(scored) {
  const news = scored.news ?? {
    score: scored.indicators?.newsScore ?? 0,
    source: "news",
    status: (scored.indicators?.newsScore ?? 0) === 0 ? "neutral" : "scored",
    detail: "本条策略没有保存新闻源详情，按当前新闻得分展示。"
  };

  return [
    "📰 新闻面",
    `来源: ${news.source}`,
    `状态: ${newsStatusLabel(news.status)}`,
    `得分: ${Number(news.score ?? 0).toFixed(2)}`,
    `说明: ${conciseNewsDetail(news)}`
  ];
}

function regimeLabel(regime) {
  const labels = {
    bear: "熊市",
    bull: "牛市",
    transition: "过渡",
    unknown: "未知"
  };
  return labels[regime] ?? regime ?? "未知";
}

function formatRegimeLines({ title, regime, fallbackSymbol }) {
  if (!regime) return [];
  const symbol = regime.symbol ?? fallbackSymbol;
  const hasDailyLine = regime.price !== undefined && regime.price !== null;

  return [
    title,
    `${symbol}结构: ${regimeLabel(regime.regime)} | 偏向: ${regime.biasDirection}`,
    hasDailyLine ? `${symbol}日线: ${regime.price} | MA50: ${regime.sma50} | MA200: ${regime.sma200}` : null,
    `说明: ${regime.note}`
  ].filter(Boolean);
}

function formatLongTermRegimeBlock(scored) {
  const contractRegime = scored.longTermRegime;
  const lines = [];

  if (contractRegime) {
    lines.push(...formatRegimeLines({
      title: "📈 标的长期趋势",
      regime: contractRegime,
      fallbackSymbol: scored.symbol
    }));
  }

  return lines;
}

function formatDataQuoteBlock(scored) {
  const dataSource = scored.dataSource ?? {};
  const quote = scored.currentQuote ?? {};
  const provider = dataSource.provider ?? quote.source ?? "未记录";
  const interval = dataSource.interval ? `${dataSource.interval} K线` : "K线";
  const exchange = quote.exchange ?? dataSource.exchange ?? "未记录";
  const quoteSymbol = quote.symbol ?? dataSource.quoteSymbol ?? scored.sourceSymbol ?? scored.symbol;
  const quotePrice = quote.price ?? scored.entry ?? "--";

  return [
    "📡 数据/报价",
    `参考数据: ${provider}${provider === "未记录" ? "" : ` ${interval}`}`,
    `报价交易所: ${exchange}`,
    `交易所报价: ${quotePrice} (${quoteSymbol})`
  ];
}

function topicTickerQuote(ticker) {
  if (!ticker) return [];

  const lines = [
    `当前报价: ${ticker.price ?? "--"}`,
    `快照来源: ${ticker.provider ?? ticker.source ?? "未记录"}`
  ];

  if (ticker.changePercent !== undefined) {
    lines.push(`快照涨跌: ${Number(ticker.changePercent).toFixed(2).replace(/\.?0+$/, "")}%`);
  }

  return lines;
}

function topicSourceLines(metadata) {
  if (!metadata) return [];

  return [
    `美股现货: ${metadata.stockSymbol}`,
    `Binance合约: ${metadata.binanceFuturesSymbol} | ${sourceStatusLabel(metadata.binanceFuturesStatus)}`,
    `Binance现货: ${metadata.binanceSpotSymbol} | ${sourceStatusLabel(metadata.binanceSpotStatus)}`,
    `Hyperliquid候选: ${metadata.hyperliquidSymbol} | ${sourceStatusLabel(metadata.hyperliquidStatus)}`
  ];
}

export function formatTopicStatusMessage({ symbol, idea, ticker } = {}) {
  const metadata = equityMetadataForSymbol(symbol);
  const normalizedSymbol = normalizeTelegramTopicSymbol(symbol);

  if (idea) {
    const scored = scoreForMessage(idea);
    return [
      "📡 Topic 数据更新",
      `🎯 标的: ${scored.symbol ?? normalizedSymbol}`,
      metadata ? `公司: ${metadata.companyName}` : null,
      `${directionEmoji(scored.direction)} 状态: ${scored.direction ?? "NEUTRAL"} | ${scored.action ?? "WAIT"}`,
      `综合分: ${scored.convictionScore ?? "--"} | ${scored.confidence ?? "LOW"}`,
      "",
      ...formatDataQuoteBlock(scored),
      "",
      "📊 观察位置",
      `支撑: ${scored.support ?? "--"}`,
      `压力: ${scored.resistance ?? "--"}`,
      `ATR: ${scored.indicators?.atr ?? "--"}`,
      "",
      ...formatNewsBlock(scored),
      "",
      "📝 说明",
      "说明: 当前没有形成 LONG/SHORT 入场条件，继续观察；出现方向变化会单独推送交易计划。"
    ].filter((line) => line !== null).join("\n");
  }

  return [
    "📡 Topic 数据更新",
    `🎯 标的: ${normalizedSymbol}`,
    metadata ? `公司: ${metadata.companyName}` : null,
    "状态: 无完整K线策略",
    "",
    ...topicTickerQuote(ticker),
    ...(ticker ? [""] : []),
    ...topicSourceLines(metadata),
    ...(metadata ? [""] : []),
    "📝 说明",
    "说明: 当前只能快照观察；无完整 1h 合约K线，不发止盈止损策略单。"
  ].filter((line) => line !== null).join("\n");
}

function compactNumber(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (absolute >= 1_000_000) return `${(number / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (absolute >= 1_000) return `${(number / 1_000).toFixed(2).replace(/\.?0+$/, "")}K`;
  return String(Number(number.toFixed(2)));
}

function compactPercent(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function moneyFlowStatusLabel(status) {
  const labels = {
    inflow: "偏流入",
    outflow: "偏流出",
    neutral: "中性"
  };
  return labels[status] ?? "未知";
}

function formatMoneyFlowBlock(scored) {
  const flow = scored.moneyFlow;
  if (!flow) return [];

  return [
    "💸 资金流向",
    `方向: ${moneyFlowStatusLabel(flow.status)} | 支持: ${flow.biasDirection ?? "NEUTRAL"}`,
    `近12根净流: ${Number(flow.netFlowPercent ?? 0).toFixed(2).replace(/\.?0+$/, "")}% | 成交倍率: ${flow.volumeRatio ?? scored.indicators?.volumeRatio ?? "--"}`,
    `24h成交额: ${compactNumber(flow.quoteVolume24h)} | 24h涨跌: ${compactPercent(flow.priceChange24h)}`,
    `说明: ${flow.detail}`
  ];
}

function formatTradePlaybookBlock(scored) {
  const playbook = scored.tradePlaybook;
  if (!playbook) return [];

  const passed = (playbook.checks ?? [])
    .filter((check) => check.status === "PASS")
    .slice(0, 3)
    .flatMap((check, index) => [
      `${index + 1}. ${check.name}`,
      `   ${check.note}`
    ]);
  const watchItems = [
    ...(playbook.checks ?? [])
      .filter((check) => check.status !== "PASS")
      .slice(0, 2)
      .map((check) => `${check.status === "FAIL" ? "❌" : "⚠️"} ${check.name}: ${check.note}`),
    ...(playbook.risks ?? [])
      .slice(0, 2)
      .map((risk) => `⚠️ ${risk}`)
  ];

  return [
    "🧑‍💼 交易员检查",
    `执行质量: ${playbook.grade ?? "--"}`,
    `动作建议: ${playbook.decision ?? "--"}`,
    `执行分: ${playbook.score ?? "--"}`,
    "",
    "✅ 已通过",
    ...(passed.length ? passed : ["暂无强通过项，先观察。"]),
    ...(watchItems.length ? ["", "⚠️ 关注项", ...watchItems] : [])
  ].filter(Boolean);
}

function formatModelBrainBlock(scored) {
  const brain = scored.modelBrain;
  if (!brain) return [];
  const provider = brain.activeProvider ?? brain.provider;

  return [
    "🤖 模型大脑",
    `模型: ${provider}`,
    "参考: Qlib / LightGBM / vectorbt / FinRL",
    `模型分: ${Math.round(Number(brain.score ?? 0) * 100)}% | ${brain.confidence ?? "LOW"} | 偏向: ${brain.biasDirection ?? "NEUTRAL"}`,
    `说明: ${brain.note ?? "模型层按中性处理。"}`
  ];
}

function formatPreviousSignalReviewBlock(scored) {
  const review = scored.previousSignalReview;
  if (!review) return [];

  return [
    "🔁 上次推送复盘",
    `结果: ${review.label} | 上次: ${review.previousDirection} @ ${review.previousEntry}`,
    `止盈: ${review.previousTakeProfit} | 止损: ${review.previousStopLoss}`,
    `当前: ${review.currentPrice} | 浮动: ${review.pnlPercent}%`,
    `依据: ${review.detail}`
  ];
}

function formatSignedNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const text = number.toFixed(2).replace(/\.?0+$/, "");
  return number > 0 ? `+${text}` : text;
}

function formatStrategyFeedbackBlock(scored) {
  const feedback = scored.strategyFeedback;
  if (!feedback) return [];

  return [
    "🧠 策略反馈",
    `样本: ${feedback.sampleSize ?? 0} | 成功率: ${formatStatsRate(feedback.successRate)}`,
    `连续对: ${feedback.consecutiveSuccesses ?? 0} | 连续错: ${feedback.consecutiveFailures ?? 0}`,
    `调整: ${formatSignedNumber(feedback.adjustment)}`,
    `说明: ${feedback.note ?? "历史反馈样本不足，按中性处理"}`
  ];
}

function formatStatsRate(value) {
  return `${Number(value ?? 0).toFixed(2).replace(/\.?0+$/, "")}%`;
}

const strategyPeriodLabels = [
  ["day", "今日"],
  ["week", "本周"],
  ["month", "本月"],
  ["year", "本年"]
];

function formatPeriodStatsLine(label, stats) {
  return `${label}: 推送 ${stats.totalSignals ?? 0} | 复盘 ${stats.reviewedSignals ?? 0} | 成 ${stats.successes ?? 0} | 败 ${stats.failures ?? 0} | 观 ${stats.pending ?? 0} | 胜率 ${formatStatsRate(stats.successRate)}`;
}

function formatPeriodDirectionLine(label, stats) {
  return `${label}多空: 多 ${stats.long?.successes ?? 0}/${stats.long?.reviewed ?? 0} | 空 ${stats.short?.successes ?? 0}/${stats.short?.reviewed ?? 0}`;
}

function formatStrategyStatsBlock(scored) {
  const stats = scored.strategyStats;
  if (!stats) return [];

  if (stats.periods) {
    return [
      "📈 累计表现",
      ...strategyPeriodLabels.flatMap(([key, label]) => {
        const periodStats = stats.periods[key];
        if (!periodStats) return [];
        return [
          formatPeriodStatsLine(label, periodStats),
          formatPeriodDirectionLine(label, periodStats)
        ];
      })
    ];
  }

  return [
    "📈 累计表现",
    `总推送: ${stats.totalSignals ?? 0} | 已复盘: ${stats.reviewedSignals ?? 0}`,
    `成功: ${stats.successes ?? 0} | 失败: ${stats.failures ?? 0} | 观察中: ${stats.pending ?? 0}`,
    `成功率: ${formatStatsRate(stats.successRate)}`,
    `多单: ${stats.long?.successes ?? 0}/${stats.long?.reviewed ?? 0} | 成功率: ${formatStatsRate(stats.long?.successRate)}`,
    `空单: ${stats.short?.successes ?? 0}/${stats.short?.reviewed ?? 0} | 成功率: ${formatStatsRate(stats.short?.successRate)}`
  ];
}

function bulletList(items) {
  return items.map((item) => `• ${technicalReason(item)}`).filter((item) => item.trim() !== "•");
}

export function formatTradeIdeaMessage(idea, { marketContext = {} } = {}) {
  const scored = scoreForMessage(idea, { marketContext });
  const summary = scored.summary
    ?? `${scored.symbol} ${scored.direction} 是当前最高置信方向，综合分 ${scored.convictionScore}，动作 ${scored.action}。`;
  const supporting = scored.supporting?.length ? scored.supporting : defaultSupporting(scored);
  const risks = risksForMessage(scored);

  return [
    `🎯 标的: ${scored.symbol}`,
    `${directionEmoji(scored.direction)} 方向: ${scored.direction} | ${scored.action}`,
    `⭐ 综合分: ${scored.convictionScore} | ${scored.confidence}`,
    "",
    "💰 交易计划",
    `入场: ${scored.entry}`,
    `止盈: ${scored.takeProfit}`,
    `止损: ${scored.stopLoss}`,
    scored.tradePlan?.summary ? `计划依据: ${scored.tradePlan.summary}` : null,
    "",
    "📊 概率/位置",
    `胜率估算: ${formatPercent(scored.winProbability ?? 0)}`,
    `风险收益比: ${scored.riskReward}`,
    `支撑: ${scored.support}`,
    `压力: ${scored.resistance}`,
    "",
    ...formatDataQuoteBlock(scored),
    "",
    ...formatMoneyFlowBlock(scored),
    ...(scored.moneyFlow ? [""] : []),
    ...formatTradePlaybookBlock(scored),
    ...(scored.tradePlaybook ? [""] : []),
    ...formatModelBrainBlock(scored),
    ...(scored.modelBrain ? [""] : []),
    ...formatPreviousSignalReviewBlock(scored),
    ...(scored.previousSignalReview ? [""] : []),
    ...formatStrategyFeedbackBlock(scored),
    ...(scored.strategyFeedback ? [""] : []),
    ...formatStrategyStatsBlock(scored),
    ...(scored.strategyStats ? [""] : []),
    ...formatNewsBlock(scored),
    "",
    ...formatLongTermRegimeBlock(scored),
    ...(scored.longTermRegime ? [""] : []),
    "🧭 执行条件",
    executionCondition(scored),
    "",
    "📝 摘要",
    summary,
    "",
    "✅ 主要依据",
    ...bulletList(supporting.slice(0, 5)),
    "",
    "⚠️ 主要风险",
    ...bulletList(risks.slice(0, 5))
  ].filter((line) => line !== null).join("\n");
}

export function formatBestSignalMessage(signal) {
  if (signal.direction === "WAIT") {
    return [
      "最高置信方向",
      "动作: WAIT",
      `原因: ${signal.summary}`
    ].join("\n");
  }

  return formatTradeIdeaMessage(signal, { title: "最高置信方向", marketContext: signal.marketContext });
}

export function formatMarketReversalMessage(signal) {
  const best = signal.bestSignal;
  const bestLine = best?.symbol
    ? `最高置信: ${best.symbol} ${best.direction ?? "--"} | 综合分 ${best.convictionScore ?? "--"}`
    : "最高置信: 暂无单标的确认";

  return [
    "🔄 大盘信号反转",
    `方向: ${signal.previousBias ?? "NEUTRAL"} -> ${signal.currentBias ?? signal.direction ?? "NEUTRAL"} | ${signal.action ?? "WAIT"}`,
    `风险模式: ${signal.previousRiskMode ?? "unknown"} -> ${signal.currentRiskMode ?? "unknown"}`,
    `长期结构: ${regimeLabel(signal.previousRegime)} -> ${regimeLabel(signal.currentRegime)}`,
    `综合分: ${signal.convictionScore ?? 0} | ${signal.confidence ?? "LOW"}`,
    bestLine,
    "",
    "📝 摘要",
    signal.summary ?? "大盘环境发生方向切换。",
    "",
    "✅ 主要依据",
    ...bulletList((signal.supporting ?? []).slice(0, 4)),
    "",
    "⚠️ 主要风险",
    ...bulletList((signal.risks ?? []).slice(0, 3))
  ].join("\n");
}

export async function sendSignalNotifications({
  signal,
  tradeIdea,
  telegram: telegramConfig = {},
  fetchImpl = globalThis.fetch
}) {
  const text = tradeIdea
    ? formatTradeIdeaMessage(tradeIdea, { marketContext: tradeIdea.marketContext })
    : formatSignalMessage(signal);
  const [telegram, lark] = await Promise.all([
    sendTelegramSymbolMessage({ symbol: signal.symbol, text, fetchImpl, ...telegramConfig }),
    sendLarkMessage({ text, fetchImpl })
  ]);

  return { telegram, lark };
}

export async function sendTelegramSymbolMessage({
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  topicMap = parseTelegramTopicMap(),
  symbol,
  text,
  fetchImpl = globalThis.fetch,
  sleepImpl,
  maxRetries,
  now
}) {
  const messageThreadId = resolveTelegramTopic(symbol, topicMap);

  if (!messageThreadId) {
    return { ok: false, skipped: true, reason: "missing_telegram_topic", symbol };
  }

  return sendTelegramMessage({
    token,
    chatId,
    messageThreadId,
    text,
    fetchImpl,
    sleepImpl,
    maxRetries,
    now
  });
}

export async function sendTelegramRoutedMessage({
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  topicMap = parseTelegramTopicMap(),
  symbol,
  text,
  fetchImpl = globalThis.fetch,
  sleepImpl,
  maxRetries,
  now
}) {
  return sendTelegramMessage({
    token,
    chatId,
    messageThreadId: resolveTelegramTopic(symbol, topicMap),
    text,
    fetchImpl,
    sleepImpl,
    maxRetries,
    now
  });
}

export async function sendTradeIdeaNotifications({
  idea,
  fetchImpl = globalThis.fetch
}) {
  const text = formatTradeIdeaMessage(idea, { marketContext: idea.marketContext });
  const [telegram, lark] = await Promise.all([
    sendTelegramSymbolMessage({ symbol: idea.symbol, text, fetchImpl }),
    sendLarkMessage({ text, fetchImpl })
  ]);

  return { telegram, lark };
}

export async function sendTopicStatusNotifications({
  symbol,
  idea,
  ticker,
  telegram: telegramConfig = {},
  fetchImpl = globalThis.fetch
}) {
  const text = formatTopicStatusMessage({ symbol, idea, ticker });
  const telegram = await sendTelegramSymbolMessage({
    symbol,
    text,
    fetchImpl,
    ...telegramConfig
  });

  return { telegram };
}

export async function sendCompleteTopicNotification({
  symbol,
  kind,
  idea,
  ticker,
  telegram: telegramConfig = {},
  fetchImpl = globalThis.fetch
}) {
  const text = kind === "trade_idea" && idea
    ? formatTradeIdeaMessage(idea, { marketContext: idea.marketContext })
    : formatTopicStatusMessage({ symbol, idea, ticker });
  const telegram = await sendTelegramSymbolMessage({
    symbol,
    text,
    fetchImpl,
    ...telegramConfig
  });

  return { telegram };
}

export async function sendBestSignalNotifications({
  signal,
  fetchImpl = globalThis.fetch
}) {
  const text = formatBestSignalMessage(signal);
  const [telegram, lark] = await Promise.all([
    sendTelegramSymbolMessage({ symbol: signal.symbol, text, fetchImpl }),
    sendLarkMessage({ text, fetchImpl })
  ]);

  return { telegram, lark };
}

export async function sendMarketReversalNotifications({
  signal,
  telegram: telegramConfig = {},
  fetchImpl = globalThis.fetch
}) {
  const text = formatMarketReversalMessage(signal);
  const [telegram, lark] = await Promise.all([
    sendTelegramRoutedMessage({ symbol: signal.symbol, text, fetchImpl, ...telegramConfig }),
    sendLarkMessage({ text, fetchImpl })
  ]);

  return { telegram, lark };
}
