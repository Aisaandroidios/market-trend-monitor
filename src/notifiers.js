import { scoreTradeIdea } from "./conviction.js";
import { equityMetadataForSymbol, sourceStatusLabel } from "./equity-metadata.js";

let telegramSendQueue = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enabledFromEnv(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function notificationSendEnabled() {
  return enabledFromEnv(process.env.NOTIFICATION_SEND_ENABLED, true);
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

function formatBeijingDate(now = Date.now) {
  return formatBeijingTimestamp(now).slice(0, 10);
}

function beijingDateKey(value) {
  if (!value) return "";
  return formatBeijingDate(new Date(value).getTime());
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
  if (!notificationSendEnabled()) {
    return { ok: false, skipped: true, reason: "notification_send_disabled" };
  }

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
  if (!notificationSendEnabled()) {
    return { ok: false, skipped: true, reason: "notification_send_disabled" };
  }

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
    convictionScore: null,
    confidence: "LOW",
    supporting: [],
    risks: []
  };
}

function formatScore(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  return Number.isFinite(number) ? String(value) : "--";
}

function defaultSupporting(scored) {
  return [
    scored.probabilityCalibration?.status === "ok"
      ? `校准胜率 ${formatPercent(scored.winProbability ?? 0)}`
      : `胜率估算 ${formatPercent(scored.winProbability ?? 0)}`,
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
  if (direction === "LONG") return "🟢📈";
  if (direction === "SHORT") return "🔴📉";
  return "🟡⏸️";
}

function confidenceBadge(confidence) {
  if (confidence === "HIGH") return "🟢 HIGH";
  if (confidence === "MEDIUM") return "🟡 MEDIUM";
  if (confidence === "LOW") return "⚪ LOW";
  return confidence ?? "--";
}

function scoreBadge(score) {
  const number = Number(score);
  if (!Number.isFinite(number)) return "⚪";
  if (number >= 75) return "🟢";
  if (number >= 65) return "🟡";
  return "⚪";
}

function actionBadge(action) {
  if (action === "BUY") return "🟢 BUY";
  if (action === "SELL") return "🔴 SELL";
  return "🟡 WAIT";
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
      `综合分: ${formatScore(scored.convictionScore)} | ${scored.confidence ?? "LOW"}`,
      "",
      ...formatStrategyPolicyBlock(scored.strategyPolicy),
      ...(scored.strategyPolicy ? [""] : []),
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

function formatDerivativesBlock(scored) {
  const derivatives = scored.derivatives;
  if (!derivatives) return [];
  if (!derivatives.ok) {
    return [
      "🧬 衍生品/盘口",
      `状态: ${derivatives.reason ?? derivatives.error ?? "不可用"}`
    ];
  }

  return [
    "🧬 衍生品/盘口",
    `偏向: ${derivatives.biasDirection ?? "NEUTRAL"} | OI: ${compactNumber(derivatives.openInterest)}`,
    `盘口失衡: ${compactPercent((derivatives.orderBookImbalance ?? 0) * 100)} | 多空比: ${derivatives.longShortRatio ?? "--"}`,
    `基差: ${compactPercent(derivatives.basisPercent)} | Mark: ${derivatives.markPrice ?? "--"}`,
    `说明: ${derivatives.detail}`
  ];
}

function formatEventRiskBlock(scored) {
  const risk = scored.eventRisk;
  if (!risk?.enabled || risk.status === "clear") return [];

  return [
    "🚦 事件风险",
    `动作: ${risk.action ?? "NONE"} | 级别: ${risk.severity ?? "LOW"}`,
    `说明: ${risk.detail ?? "事件风险触发"}`,
    ...(risk.events ?? []).slice(0, 3).map((event) => `• ${event.name} | ${event.source}`)
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

function formatModelGovernanceBlock(scored) {
  const governance = scored.modelGovernance;
  if (!governance) return [];

  return [
    "🛡️ 模型治理",
    `状态: ${governance.status} | 动作: ${governance.action}`,
    `20条: ${governance.windows?.last20?.successRate ?? 0}%/${governance.windows?.last20?.samples ?? 0} | 50条: ${governance.windows?.last50?.successRate ?? 0}%/${governance.windows?.last50?.samples ?? 0}`,
    `校准误差: ${formatStatsRate(governance.calibration?.expectedCalibrationError)} | Brier: ${governance.calibration?.brierScore ?? 0}`,
    ...(governance.warnings?.length ? [`风险: ${governance.warnings[0]}`] : [])
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

function formatStrategyPolicyBlock(policy) {
  if (!policy) return [];
  const thresholds = policy.confidenceThresholds ?? {};
  const reasons = (policy.reasons ?? []).slice(0, 2);

  return [
    "🧮 动态标准",
    `最低执行分: ${formatScore(policy.minConviction)} | 最低RR: ${policy.minRiskReward ?? "--"}`,
    `执行检查: ${policy.minPlaybookScore ?? "--"} | 置信阈值: M ${thresholds.medium ?? "--"} / H ${thresholds.high ?? "--"}`,
    ...reasons.map((reason) => `依据: ${reason}`)
  ];
}

function formatStatsRate(value) {
  return `${Number(value ?? 0).toFixed(2).replace(/\.?0+$/, "")}%`;
}

function formatOptionalStatsRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return formatStatsRate(number);
}

function formatProbabilityCalibrationBlock(scored) {
  const calibration = scored.probabilityCalibration;
  if (!calibration) return [];

  if (calibration.status !== "ok") {
    return [
      "🎚️ 胜率校准",
      `状态: ${calibration.status}`,
      `说明: ${calibration.note ?? "校准样本不足，按模型估算为主"}`
    ];
  }

  return [
    "🎚️ 胜率校准",
    `校准后: ${formatStatsRate(calibration.calibratedPercent)} | 原始: ${formatStatsRate(calibration.rawPercent)}`,
    `分桶: ${calibration.bucketKey} | 样本: ${calibration.samples} | 真实胜率: ${formatStatsRate(calibration.realizedRate)}`,
    `调整: ${formatSignedNumber(calibration.adjustmentPercent)}% | 可靠度: ${Math.round(Number(calibration.reliability ?? 0) * 100)}%`
  ];
}

function formatWalkForwardBlock(scored) {
  const wf = scored.walkForward;
  if (!wf?.enabled) return [];

  if (wf.status !== "ok") {
    return [
      "🧪 滚动验证",
      `状态: ${wf.status ?? "unknown"}`,
      `说明: ${wf.warnings?.[0] ?? "样本不足，按中性处理"}`
    ];
  }

  const metrics = wf.testMetrics ?? {};
  return [
    "🧪 滚动验证",
    `验证胜率: ${formatStatsRate(metrics.winRate)} | 期望R: ${metrics.expectancyR ?? 0}`,
    `利润因子: ${metrics.profitFactor ?? 0} | 最大回撤R: ${metrics.maxDrawdownR ?? 0}`,
    `窗口: ${wf.positiveWindows ?? 0}/${wf.windows ?? 0} | 支持方向: ${wf.supportDirection ?? "NEUTRAL"}`,
    ...(wf.warnings?.length ? [`风险: ${wf.warnings[0]}`] : [])
  ];
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `$${number.toFixed(2).replace(/\.?0+$/, "")}`;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function notionalForPosition(position) {
  const explicit = finiteNumber(position?.notional);
  if (explicit !== null) return explicit;
  const entry = finiteNumber(position?.entryPrice);
  const quantity = finiteNumber(position?.quantity);
  if (entry !== null && quantity !== null) return Math.abs(entry * quantity);
  return null;
}

function formatUsedCapitalLine(position, paperAccount) {
  const notional = notionalForPosition(position);
  const equity = finiteNumber(paperAccount?.equity, finiteNumber(paperAccount?.balance, finiteNumber(paperAccount?.initialBalance, 0)));
  const equityPercent = notional !== null && equity > 0 ? (notional / equity) * 100 : null;
  return `占用本金 ${formatCurrency(notional)} | 占权益 ${equityPercent === null ? "--" : formatStatsRate(equityPercent)}`;
}

function formatCapitalRiskLine(position) {
  return `占用本金 ${formatCurrency(notionalForPosition(position))} | 风险 ${formatCurrency(position?.riskAmount)} | RR ${position?.riskReward ?? "--"}`;
}

function formatOpenPnlLine(position) {
  return `${pnlBadge(position?.unrealizedPnl)} 浮盈亏 ${formatCurrency(position?.unrealizedPnl)} | 盈亏率 ${formatOptionalStatsRate(position?.unrealizedPnlPercent)}`;
}

function formatClosedPnlLine(entry) {
  return `${pnlBadge(entry?.netPnl)} PnL ${formatCurrency(entry?.netPnl)} | 回报 ${formatOptionalStatsRate(entry?.returnPercent)}`;
}

function pnlBadge(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "⚪";
  return number > 0 ? "🟢" : "🔴";
}

function formatPaperDirectionStats(label, stats = {}) {
  return `${label}: ${stats.wins ?? 0}/${stats.trades ?? 0} | 胜率 ${formatStatsRate(stats.winRate)}`;
}

function dailyPaperRows(rows = [], dateKey, timeField) {
  return rows.filter((row) => beijingDateKey(row?.[timeField]) === dateKey);
}

function emptyDailyTradeStats() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    netPnl: 0,
    winRate: 0
  };
}

function dailyTradeStats(trades = []) {
  const stats = {
    ...emptyDailyTradeStats(),
    long: emptyDailyTradeStats(),
    short: emptyDailyTradeStats()
  };

  function add(target, trade) {
    target.trades += 1;
    target.netPnl = Number((target.netPnl + Number(trade.netPnl ?? 0)).toFixed(2));
    if (Number(trade.netPnl ?? 0) > 0) target.wins += 1;
    else if (Number(trade.netPnl ?? 0) < 0) target.losses += 1;
    else target.breakeven += 1;
  }

  for (const trade of trades) {
    add(stats, trade);
    if (trade.direction === "LONG") add(stats.long, trade);
    if (trade.direction === "SHORT") add(stats.short, trade);
  }

  function finalize(target) {
    const resolved = target.wins + target.losses;
    target.winRate = resolved === 0 ? 0 : Number(((target.wins / resolved) * 100).toFixed(2));
    return target;
  }

  finalize(stats);
  finalize(stats.long);
  finalize(stats.short);
  return stats;
}

export function formatPaperAccountMessage(paperAccount, { reason = "账户更新" } = {}) {
  if (!paperAccount?.enabled) return "";

  const total = paperAccount.stats?.total ?? {};
  const day = paperAccount.stats?.periods?.day ?? {};
  const week = paperAccount.stats?.periods?.week ?? {};
  const month = paperAccount.stats?.periods?.month ?? {};
  const year = paperAccount.stats?.periods?.year ?? {};
  const pnl = Number(paperAccount.equity ?? 0) - Number(paperAccount.initialBalance ?? 0);
  const openPositions = paperAccount.openPositions ?? [];
  const lastRiskEvent = paperAccount.recentRiskEvents?.[0];
  const history = paperAccount.recentOpenHistory ?? [];
  const positionLines = openPositions.length === 0
    ? ["当前持仓: 无"]
    : [
        `当前持仓: ${openPositions.length}`,
        ...openPositions.slice(0, 6).flatMap((position) => [
          `${directionEmoji(position.direction)} ${position.symbol} ${position.direction}`,
          `入场 ${position.entryPrice} | 现价 ${position.currentPrice ?? "--"} | TP ${position.takeProfit} | SL ${position.stopLoss}`,
          formatUsedCapitalLine(position, paperAccount),
          `${formatOpenPnlLine(position)} | 风险 ${formatCurrency(position.riskAmount)} | RR ${position.riskReward}`
        ])
      ];
  const historyLines = history.length
    ? history.slice(0, 5).flatMap((entry) => {
        const closed = entry.status === "CLOSED";
        return [
          `${closed ? pnlBadge(entry.netPnl) : "🟢"} ${entry.symbol} ${entry.direction} | ${entry.status}`,
          `入场 ${entry.entryPrice} | TP ${entry.takeProfit} | SL ${entry.stopLoss}`,
          formatCapitalRiskLine(entry),
          closed ? formatClosedPnlLine(entry) : null
        ].filter(Boolean);
      })
    : ["开仓历史: 暂无"];
  const positionRisk = paperAccount.config?.positionRisk ?? {};
  const highQualityCap = positionRisk.highQualityRiskEnabled
    ? ` | 高性价比上限 ${formatStatsRate((positionRisk.highQualityMaxRiskPerTrade ?? positionRisk.maxRiskPerTrade ?? 0) * 100)}`
    : "";
  const riskLines = [
    `仓位引擎: ${positionRisk.enabled ? "开启" : "关闭"} | 普通上限 ${formatStatsRate((positionRisk.maxRiskPerTrade ?? 0) * 100)}${highQualityCap}`,
    lastRiskEvent ? `最近拦截: ${lastRiskEvent.skippedSymbol ?? lastRiskEvent.symbol} | ${lastRiskEvent.summary}` : null
  ].filter(Boolean);

  return joinMessageLines([
    "💼 仓位 / 模拟账户",
    `触发: ${reason}`,
    "",
    "📌 账户概览",
    `权益: ${formatCurrency(paperAccount.equity)} | 余额: ${formatCurrency(paperAccount.balance)}`,
    `${pnlBadge(pnl)} 累计盈亏: ${formatCurrency(pnl)} | 最大回撤: ${formatStatsRate(paperAccount.maxDrawdownPercent)}`,
    `累计: ${total.wins ?? 0}/${total.trades ?? 0} | 胜率 ${formatStatsRate(total.winRate)}`,
    `多单: ${total.long?.wins ?? 0}/${total.long?.trades ?? 0} | 空单: ${total.short?.wins ?? 0}/${total.short?.trades ?? 0}`,
    "",
    "📊 周期表现",
    formatPaperDirectionStats("今日", day),
    formatPaperDirectionStats("本周", week),
    formatPaperDirectionStats("本月", month),
    formatPaperDirectionStats("本年", year),
    "",
    "🛡️ 风控状态",
    ...riskLines,
    "",
    "📍 当前持仓",
    ...positionLines,
    "",
    "🧾 开仓历史",
    ...historyLines
  ]);
}

function formatPaperDailyTradeLine(trade) {
  return [
    `${pnlBadge(trade.netPnl)} ${trade.symbol} ${trade.direction} | ${trade.closeReason ?? trade.status ?? "CLOSED"}`,
    `${formatClosedPnlLine(trade)} | 入 ${trade.entryPrice ?? "--"} -> 出 ${trade.exitPrice ?? "--"}`
  ];
}

function formatPaperDailyOpenLine(entry) {
  return [
    `${directionEmoji(entry.direction)} ${entry.symbol} ${entry.direction}`,
    `入场 ${entry.entryPrice ?? "--"} | TP ${entry.takeProfit ?? "--"} | SL ${entry.stopLoss ?? "--"}`,
    formatCapitalRiskLine(entry)
  ];
}

function formatPaperDailyPositionLine(position, paperAccount) {
  return [
    `${directionEmoji(position.direction)} ${position.symbol} ${position.direction}`,
    `现价 ${position.currentPrice ?? "--"} | 入场 ${position.entryPrice ?? "--"} | TP ${position.takeProfit ?? "--"} | SL ${position.stopLoss ?? "--"}`,
    formatUsedCapitalLine(position, paperAccount),
    `${formatOpenPnlLine(position)} | 风险 ${formatCurrency(position.riskAmount)} | RR ${position.riskReward ?? "--"}`
  ];
}

function pnlLabel(value) {
  const number = Number(value ?? 0);
  if (number > 0) return `🟢 盈利 ${formatCurrency(number)}`;
  if (number < 0) return `🔴 亏损 ${formatCurrency(number)}`;
  return `⚪ 持平 ${formatCurrency(number)}`;
}

function formatPaperDailyFocus({ paperAccount, closedToday, openedToday, riskEventsToday }) {
  const focus = [];
  const day = paperAccount.stats?.periods?.day ?? {};
  const dailyPnl = Number(day.netPnl ?? 0);
  const openPositions = paperAccount.openPositions ?? [];

  if (dailyPnl < 0) focus.push("今日已实现亏损，下一轮优先降低低置信/低RR信号频率。");
  if (day.losses > day.wins) focus.push("今日亏单多于赢单，观察是否触发连续亏损降仓。");
  if (openPositions.length >= Number(paperAccount.config?.maxOpenPositions ?? 6)) focus.push("持仓已接近上限，新开仓只保留最高置信机会。");
  if (riskEventsToday.length) focus.push(`风控今日拦截 ${riskEventsToday.length} 次，继续过滤 ${riskEventsToday[0].skippedSymbol ?? riskEventsToday[0].symbol ?? "低质量"} 信号。`);
  if (closedToday.length === 0 && openedToday.length === 0) focus.push("今日成交样本少，先观察高分机会，不强行交易。");
  if (focus.length === 0) focus.push("保持当前仓位纪律：先等价格接近入场和执行条件同时满足。");

  return focus.slice(0, 4).map((item) => `• ${item}`);
}

export function formatPaperDailySummaryMessage(paperAccount, {
  reason = "每日自动总结",
  now = Date.now
} = {}) {
  if (!paperAccount?.enabled) return "";

  const dateKey = formatBeijingDate(now);
  const dailySource = paperAccount.dailySummary?.date === dateKey ? paperAccount.dailySummary : null;
  const totalPnl = Number(paperAccount.equity ?? 0) - Number(paperAccount.initialBalance ?? 0);
  const equityRowsToday = dailySource?.equityCurve ?? dailyPaperRows(paperAccount.equityCurve ?? [], dateKey, "at");
  const firstEquity = equityRowsToday[0]?.equity ?? paperAccount.initialBalance;
  const lastEquity = equityRowsToday.at(-1)?.equity ?? paperAccount.equity;
  const equityChange = Number(lastEquity ?? 0) - Number(firstEquity ?? 0);
  const closedToday = dailySource?.closedTrades ?? dailyPaperRows(paperAccount.recentClosedTrades ?? [], dateKey, "closedAt");
  const day = dailyTradeStats(closedToday);
  const openedToday = dailySource?.openedEntries ?? dailyPaperRows(paperAccount.recentOpenHistory ?? [], dateKey, "openedAt");
  const riskEventsToday = dailySource?.riskEvents ?? dailyPaperRows(paperAccount.recentRiskEvents ?? [], dateKey, "evaluatedAt");
  const openPositions = paperAccount.openPositions ?? [];
  const lastRiskEvent = riskEventsToday[0] ?? paperAccount.recentRiskEvents?.[0];

  const closedLines = closedToday.length
    ? closedToday.slice(0, 6).flatMap(formatPaperDailyTradeLine)
    : ["今日平仓明细: 暂无"];
  const openedLines = openedToday.length
    ? openedToday.slice(0, 6).flatMap(formatPaperDailyOpenLine)
    : ["今日新开仓: 暂无"];
  const positionLines = openPositions.length
    ? [
        `当前持仓: ${openPositions.length}`,
        ...openPositions.slice(0, 6).flatMap((position) => formatPaperDailyPositionLine(position, paperAccount))
      ]
    : ["当前持仓: 无"];
  const riskLines = [
    `单笔风险 ${formatStatsRate((paperAccount.config?.riskPerTrade ?? 0) * 100)} | 最大持仓 ${openPositions.length}/${paperAccount.config?.maxOpenPositions ?? "--"}`,
    `日亏损上限 ${formatStatsRate((paperAccount.config?.positionRisk?.dailyMaxLossPercent ?? 0) * 100)} | 周亏损上限 ${formatStatsRate((paperAccount.config?.positionRisk?.weeklyMaxLossPercent ?? 0) * 100)}`,
    lastRiskEvent ? `最近拦截: ${lastRiskEvent.skippedSymbol ?? lastRiskEvent.symbol} ${lastRiskEvent.skippedDirection ?? lastRiskEvent.direction ?? ""} | ${lastRiskEvent.summary}` : null
  ].filter(Boolean);

  return joinMessageLines([
    "📆 每日交易结果总结",
    `日期: ${dateKey}`,
    `触发: ${reason}`,
    "",
    "📌 今日结果",
    `今日平仓: ${day.trades ?? closedToday.length} | 胜 ${day.wins ?? 0} | 负 ${day.losses ?? 0} | 胜率 ${formatStatsRate(day.winRate)}`,
    `今日已实现: ${pnlLabel(day.netPnl)} | 今日权益变化: ${pnlLabel(equityChange)}`,
    `账户权益: ${formatCurrency(paperAccount.equity)} | 余额: ${formatCurrency(paperAccount.balance)} | 累计盈亏 ${pnlLabel(totalPnl)}`,
    `最大回撤: ${formatStatsRate(paperAccount.maxDrawdownPercent)} | 当前持仓数: ${openPositions.length}`,
    "",
    "📊 多空表现",
    `LONG: ${day.long?.wins ?? 0}/${day.long?.trades ?? 0} | 胜率 ${formatStatsRate(day.long?.winRate)} | ${pnlLabel(day.long?.netPnl)}`,
    `SHORT: ${day.short?.wins ?? 0}/${day.short?.trades ?? 0} | 胜率 ${formatStatsRate(day.short?.winRate)} | ${pnlLabel(day.short?.netPnl)}`,
    "",
    "🧾 今日平仓",
    ...closedLines,
    "",
    "🟢 今日新开",
    ...openedLines,
    "",
    "📍 当前持仓",
    ...positionLines,
    "",
    "🛡️ 风控/纪律",
    ...riskLines,
    "",
    "🧭 明日/下一交易日关注",
    ...formatPaperDailyFocus({ paperAccount, closedToday, openedToday, riskEventsToday })
  ]);
}

function formatAttributionBucket(bucket) {
  const reviewedResolved = Number(bucket.successes ?? 0) + Number(bucket.failures ?? 0);
  const reviewText = `复盘 ${bucket.successes ?? 0}/${reviewedResolved}`;
  const paperText = `模拟 ${bucket.paperWins ?? 0}/${bucket.paperTrades ?? 0}`;
  const pnlText = `PnL ${formatCurrency(bucket.netPnl)}`;
  const scoreText = `分 ${Number(bucket.score ?? 0).toFixed(2)}`;
  const sampleText = `样本 ${Number(bucket.sampleScore ?? 0).toFixed(2)}`;

  return `${bucket.label ?? bucket.key}: ${reviewText} | ${paperText} | ${pnlText} | ${scoreText} | ${sampleText}`;
}

function formatAttributionList(items, emptyText) {
  if (!items?.length) return [emptyText];
  return items.slice(0, 5).map(formatAttributionBucket);
}

export function formatStrategyAttributionMessage(attribution, { reason = "归因更新" } = {}) {
  if (!attribution?.total) return "";

  const total = attribution.total ?? {};
  const policyHints = attribution.policyHints ?? {};
  const recommendations = attribution.recommendations?.length
    ? attribution.recommendations.slice(0, 4)
    : ["归因样本还少，先继续收集信号复盘和模拟成交。"];

  return joinMessageLines([
    "🧠 策略归因",
    `触发: ${reason}`,
    "",
    "📌 总览",
    `复盘: ${total.reviewed ?? 0} | 成 ${total.successes ?? 0} | 败 ${total.failures ?? 0} | 胜率 ${formatStatsRate(total.successRate)}`,
    `模拟: ${total.paperTrades ?? 0} | 胜 ${total.paperWins ?? 0} | 负 ${total.paperLosses ?? 0} | 胜率 ${formatStatsRate(total.paperWinRate)} | PnL ${formatCurrency(total.netPnl)}`,
    `归因分: ${Number(total.score ?? 0).toFixed(2)} | 样本权重: ${Number(total.sampleScore ?? 0).toFixed(2)}`,
    "",
    "✅ 强项",
    ...formatAttributionList(attribution.strengths, "强项: 样本不足"),
    "",
    "⚠️ 弱项",
    ...formatAttributionList(attribution.weaknesses, "弱项: 样本不足"),
    "",
    "🧭 调参建议",
    ...recommendations.map((item) => `• ${item}`),
    "",
    "🔧 自动权重",
    `加权: ${policyHints.boost?.length ? policyHints.boost.join(", ") : "暂无"}`,
    `降权: ${policyHints.reduce?.length ? policyHints.reduce.join(", ") : "暂无"}`,
    `暂避: ${policyHints.avoidSymbols?.length ? policyHints.avoidSymbols.join(", ") : "暂无"}`
  ]);
}

function formatCalibrationSignedPercent(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number === 0) return "0%";
  return `${number > 0 ? "+" : ""}${formatStatsRate(number)}`;
}

function formatCalibrationBucket(bucket) {
  return [
    `${bucket.key}: 样本 ${bucket.samples ?? 0}`,
    `预测 ${formatStatsRate(bucket.predictedAvg)}`,
    `真实 ${formatStatsRate(bucket.realizedRate)}`,
    `误差 ${formatStatsRate(bucket.calibrationError)}`,
    `可靠 ${Math.round(Number(bucket.reliability ?? 0) * 100)}%`
  ].join(" | ");
}

function formatCalibrationDirection(label, stats = {}) {
  return `${label}: 样本 ${stats.samples ?? 0} | 成 ${stats.successes ?? 0} | 败 ${stats.failures ?? 0} | 真实胜率 ${formatStatsRate(stats.realizedRate)}`;
}

function formatCalibrationSymbol(stats = {}) {
  return `${stats.symbol}: 样本 ${stats.samples ?? 0} | 预测 ${formatStatsRate(stats.predictedAvg)} | 真实 ${formatStatsRate(stats.realizedRate)}`;
}

export function formatProbabilityCalibrationMessage(calibration, { reason = "校准更新" } = {}) {
  if (!calibration?.overall) return "";

  const overall = calibration.overall ?? {};
  const buckets = calibration.buckets?.length
    ? calibration.buckets.slice().sort((left, right) => (right.samples ?? 0) - (left.samples ?? 0)).slice(0, 6)
    : [];
  const symbols = calibration.symbols?.length
    ? calibration.symbols.slice(0, 6)
    : [];

  return joinMessageLines([
    "🎚️ 胜率校准",
    `触发: ${reason}`,
    "",
    "📌 总览",
    `状态: ${calibration.status ?? "unknown"} | 样本: ${overall.samples ?? 0}`,
    `预测均值: ${formatStatsRate(overall.predictedAvg)} | 真实胜率: ${formatStatsRate(overall.realizedRate)} | 偏差: ${formatCalibrationSignedPercent(overall.overconfidence)}`,
    `ECE: ${formatStatsRate(overall.expectedCalibrationError)} | Brier: ${overall.brierScore ?? 0}`,
    `分桶: ${calibration.bucketSize ?? "--"}% | 最小样本: ${calibration.minTotalSamples ?? "--"}`,
    "",
    "📊 概率分桶",
    ...(buckets.length ? buckets.map(formatCalibrationBucket) : ["分桶: 样本不足"]),
    "",
    "🧭 多空校准",
    formatCalibrationDirection("LONG", calibration.directions?.long),
    formatCalibrationDirection("SHORT", calibration.directions?.short),
    "",
    "📍 标的校准",
    ...(symbols.length ? symbols.map(formatCalibrationSymbol) : ["标的: 样本不足"])
  ]);
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

function joinMessageLines(lines) {
  const compacted = [];
  for (const line of lines) {
    if (line === null || line === undefined) continue;
    if (line === "" && (compacted.length === 0 || compacted.at(-1) === "")) continue;
    compacted.push(line);
  }

  while (compacted.at(-1) === "") compacted.pop();
  return compacted.join("\n");
}

export function formatTradeIdeaMessage(idea, { marketContext = {}, paperAccount = null } = {}) {
  const scored = scoreForMessage(idea, { marketContext });
  const summary = scored.summary
    ?? `${scored.symbol} ${scored.direction} 是当前最高置信方向，综合分 ${formatScore(scored.convictionScore)}，动作 ${scored.action}。`;
  const supporting = scored.supporting?.length ? scored.supporting : defaultSupporting(scored);
  const risks = risksForMessage(scored);
  const hasPolicy = scored.strategyPolicy || marketContext.strategyPolicy;

  return joinMessageLines([
    `🎯 标的: ${scored.symbol}`,
    `${directionEmoji(scored.direction)} 方向: ${scored.direction} | ${actionBadge(scored.action)}`,
    `⭐ 综合分: ${formatScore(scored.convictionScore)} ${scoreBadge(scored.convictionScore)} | ${confidenceBadge(scored.confidence)}`,
    "",
    "💰 交易计划",
    `入场: ${scored.entry}`,
    `止盈: ${scored.takeProfit}`,
    `止损: ${scored.stopLoss}`,
    scored.tradePlan?.summary ? `计划依据: ${scored.tradePlan.summary}` : null,
    "",
    "📊 概率/位置",
    `胜率估算: ${formatPercent(scored.winProbability ?? 0)}${scored.probabilityCalibration?.status === "ok" ? " (校准后)" : ""}`,
    `风险收益比: ${scored.riskReward}`,
    `支撑: ${scored.support}`,
    `压力: ${scored.resistance}`,
    "",
    ...formatProbabilityCalibrationBlock(scored),
    ...(scored.probabilityCalibration ? [""] : []),
    "🧭 执行条件",
    executionCondition(scored),
    "",
    ...formatTradePlaybookBlock(scored),
    ...(scored.tradePlaybook ? [""] : []),
    ...formatDataQuoteBlock(scored),
    "",
    ...formatMoneyFlowBlock(scored),
    ...(scored.moneyFlow ? [""] : []),
    ...formatDerivativesBlock(scored),
    ...(scored.derivatives ? [""] : []),
    ...formatLongTermRegimeBlock(scored),
    ...(scored.longTermRegime ? [""] : []),
    ...formatNewsBlock(scored),
    "",
    ...formatEventRiskBlock(scored),
    ...(scored.eventRisk && scored.eventRisk.status !== "clear" ? [""] : []),
    ...formatWalkForwardBlock(scored),
    ...(scored.walkForward ? [""] : []),
    ...formatModelBrainBlock(scored),
    ...(scored.modelBrain ? [""] : []),
    ...formatModelGovernanceBlock(scored),
    ...(scored.modelGovernance ? [""] : []),
    ...formatPreviousSignalReviewBlock(scored),
    ...(scored.previousSignalReview ? [""] : []),
    ...formatStrategyFeedbackBlock(scored),
    ...(scored.strategyFeedback ? [""] : []),
    ...formatStrategyStatsBlock(scored),
    ...(scored.strategyStats ? [""] : []),
    ...formatStrategyPolicyBlock(scored.strategyPolicy ?? marketContext.strategyPolicy),
    ...(hasPolicy ? [""] : []),
    "",
    "📝 摘要",
    summary,
    "",
    "✅ 主要依据",
    ...bulletList(supporting.slice(0, 5)),
    "",
    "⚠️ 主要风险",
    ...bulletList(risks.slice(0, 5))
  ]);
}

export function formatBestSignalMessage(signal, { paperAccount = null } = {}) {
  if (signal.direction === "WAIT") {
    return [
      "最高置信方向",
      `动作: ${actionBadge("WAIT")}`,
      `原因: ${signal.summary}`,
      "",
      ...formatStrategyPolicyBlock(signal.strategyPolicy)
    ].filter((line, index, lines) => line !== "" || lines[index + 1]).join("\n");
  }

  return formatTradeIdeaMessage(signal, {
    title: "最高置信方向",
    marketContext: signal.marketContext
  });
}

export function formatMarketReversalMessage(signal, { paperAccount = null } = {}) {
  const best = signal.bestSignal;
  const bestLine = best?.symbol
    ? `最高置信: ${best.symbol} ${best.direction ?? "--"} | 综合分 ${formatScore(best.convictionScore)}`
    : "最高置信: 暂无单标的确认";

  return [
    "🔄 大盘信号反转",
    `方向: ${signal.previousBias ?? "NEUTRAL"} -> ${signal.currentBias ?? signal.direction ?? "NEUTRAL"} | ${signal.action ?? "WAIT"}`,
    `风险模式: ${signal.previousRiskMode ?? "unknown"} -> ${signal.currentRiskMode ?? "unknown"}`,
    `长期结构: ${regimeLabel(signal.previousRegime)} -> ${regimeLabel(signal.currentRegime)}`,
    `综合分: ${formatScore(signal.convictionScore)} | ${signal.confidence ?? "LOW"}`,
    bestLine,
    "",
    "📝 摘要",
    signal.summary ?? "大盘环境发生方向切换。",
    "",
    "✅ 主要依据",
    ...bulletList((signal.supporting ?? []).slice(0, 4)),
    "",
    "⚠️ 主要风险",
    ...bulletList((signal.risks ?? []).slice(0, 3)),
    "",
    ...formatStrategyPolicyBlock(signal.strategyPolicy)
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
  paperAccount,
  fetchImpl = globalThis.fetch
}) {
  const text = formatTradeIdeaMessage(idea, { marketContext: idea.marketContext, paperAccount });
  const [telegram, lark] = await Promise.all([
    sendTelegramSymbolMessage({ symbol: idea.symbol, text, fetchImpl }),
    sendLarkMessage({ text, fetchImpl })
  ]);

  return { telegram, lark };
}

export async function sendPaperAccountNotification({
  paperAccount,
  reason = "账户更新",
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  messageThreadId = process.env.PAPER_ACCOUNT_TOPIC_ID,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!messageThreadId) {
    return { ok: false, skipped: true, reason: "missing_paper_account_topic" };
  }

  const text = formatPaperAccountMessage(paperAccount, { reason });
  if (!text) {
    return { ok: false, skipped: true, reason: "missing_paper_account_snapshot" };
  }

  return sendTelegramMessage({
    token,
    chatId,
    messageThreadId,
    text,
    fetchImpl
  });
}

export async function sendPaperDailySummaryNotification({
  paperAccount,
  reason = "每日自动总结",
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  messageThreadId = process.env.PAPER_DAILY_SUMMARY_TOPIC_ID ?? process.env.PAPER_ACCOUNT_TOPIC_ID,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (!messageThreadId) {
    return { ok: false, skipped: true, reason: "missing_paper_daily_summary_topic" };
  }

  const text = formatPaperDailySummaryMessage(paperAccount, { reason, now });
  if (!text) {
    return { ok: false, skipped: true, reason: "missing_paper_account_snapshot" };
  }

  return sendTelegramMessage({
    token,
    chatId,
    messageThreadId,
    text,
    fetchImpl,
    now
  });
}

export async function sendStrategyAttributionNotification({
  attribution,
  reason = "归因更新",
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  messageThreadId = process.env.STRATEGY_ATTRIBUTION_TOPIC_ID,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!messageThreadId) {
    return { ok: false, skipped: true, reason: "missing_strategy_attribution_topic" };
  }

  const text = formatStrategyAttributionMessage(attribution, { reason });
  if (!text) {
    return { ok: false, skipped: true, reason: "missing_strategy_attribution_snapshot" };
  }

  return sendTelegramMessage({
    token,
    chatId,
    messageThreadId,
    text,
    fetchImpl
  });
}

export async function sendProbabilityCalibrationNotification({
  calibration,
  reason = "校准更新",
  token = process.env.TELEGRAM_BOT_TOKEN,
  chatId = process.env.TELEGRAM_CHAT_ID,
  messageThreadId = process.env.PROBABILITY_CALIBRATION_TOPIC_ID,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!messageThreadId) {
    return { ok: false, skipped: true, reason: "missing_probability_calibration_topic" };
  }

  const text = formatProbabilityCalibrationMessage(calibration, { reason });
  if (!text) {
    return { ok: false, skipped: true, reason: "missing_probability_calibration_snapshot" };
  }

  return sendTelegramMessage({
    token,
    chatId,
    messageThreadId,
    text,
    fetchImpl
  });
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
  paperAccount,
  telegram: telegramConfig = {},
  fetchImpl = globalThis.fetch
}) {
  const text = kind === "trade_idea" && idea
    ? formatTradeIdeaMessage(idea, { marketContext: idea.marketContext, paperAccount })
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
  paperAccount,
  fetchImpl = globalThis.fetch
}) {
  const text = formatBestSignalMessage(signal, { paperAccount });
  const [telegram, lark] = await Promise.all([
    sendTelegramSymbolMessage({ symbol: signal.symbol, text, fetchImpl }),
    sendLarkMessage({ text, fetchImpl })
  ]);

  return { telegram, lark };
}

export async function sendMarketReversalNotifications({
  signal,
  paperAccount,
  telegram: telegramConfig = {},
  fetchImpl = globalThis.fetch
}) {
  const text = formatMarketReversalMessage(signal, { paperAccount });
  const [telegram, lark] = await Promise.all([
    sendTelegramRoutedMessage({ symbol: signal.symbol, text, fetchImpl, ...telegramConfig }),
    sendLarkMessage({ text, fetchImpl })
  ]);

  return { telegram, lark };
}
