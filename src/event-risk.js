function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function enabled(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeSymbol(symbol) {
  return String(symbol ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
}

function symbolMatches(symbols = [], symbol) {
  const normalized = normalizeSymbol(symbol);
  const list = symbols.map(normalizeSymbol);
  return list.includes("ALL") || list.includes(normalized) || list.some((item) => normalized.startsWith(item));
}

function activeConfiguredEvents({ symbol, now, env = process.env }) {
  const windows = parseJson(env.EVENT_RISK_WINDOWS_JSON, []);
  const time = Number(new Date(now));
  if (!Array.isArray(windows) || !Number.isFinite(time)) return [];

  return windows
    .filter((event) => {
      const start = Number(new Date(event.start));
      const end = Number(new Date(event.end));
      return Number.isFinite(start)
        && Number.isFinite(end)
        && time >= start
        && time <= end
        && symbolMatches(event.symbols ?? ["ALL"], symbol);
    })
    .map((event) => ({
      source: "config",
      name: event.name ?? "Configured event risk",
      severity: String(event.severity ?? "HIGH").toUpperCase(),
      action: String(event.action ?? "REDUCE").toUpperCase(),
      detail: event.detail ?? "Configured event risk window is active."
    }));
}

const keywordRules = [
  {
    name: "FOMC/Fed",
    severity: "HIGH",
    action: "REDUCE",
    pattern: /\b(FOMC|Federal Reserve|Fed rate|Powell)\b/i,
    detail: "美联储/FOMC相关事件，波动和假突破风险升高。"
  },
  {
    name: "CPI/NFP macro",
    severity: "HIGH",
    action: "REDUCE",
    pattern: /\b(CPI|inflation|nonfarm|NFP|jobs report|PCE)\b/i,
    detail: "通胀/就业宏观事件，短线方向容易被数据打断。"
  },
  {
    name: "SEC/regulation",
    severity: "HIGH",
    action: "REDUCE",
    pattern: /\b(SEC|lawsuit|regulation|regulatory|ETF approval|ETF delay|ban)\b/i,
    detail: "监管/ETF/SEC事件风险，优先降低仓位或等待确认。"
  },
  {
    name: "Earnings",
    severity: "MEDIUM",
    action: "REDUCE",
    pattern: /\b(earnings|guidance|revenue|EPS|quarterly results)\b/i,
    detail: "财报/业绩指引附近，跳空和反向波动风险升高。"
  },
  {
    name: "Token unlock/on-chain shock",
    severity: "MEDIUM",
    action: "REDUCE",
    pattern: /\b(unlock|token unlock|whale transfer|large transfer|exploit|hack|bridge)\b/i,
    detail: "代币解锁/链上大额转账/安全事件，流动性风险升高。"
  },
  {
    name: "Black swan headline",
    severity: "HIGH",
    action: "BLOCK",
    pattern: /\b(bankruptcy|halted|delisting|default|war|attack|emergency)\b/i,
    detail: "突发黑天鹅关键词，暂停新开仓等待确认。"
  }
];

function newsText(news) {
  return [
    news?.detail,
    news?.summary,
    ...(Array.isArray(news?.items) ? news.items.map((item) => item.title ?? item.summary ?? "") : [])
  ].filter(Boolean).join(" ");
}

function keywordEvents(news) {
  const text = newsText(news);
  if (!text) return [];

  return keywordRules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => ({
      source: "news",
      name: rule.name,
      severity: rule.severity,
      action: rule.action,
      detail: rule.detail
    }));
}

function severityRank(severity) {
  if (severity === "HIGH") return 3;
  if (severity === "MEDIUM") return 2;
  if (severity === "LOW") return 1;
  return 0;
}

export function buildEventRiskAssessment({
  symbol,
  news,
  now = Date.now(),
  env = process.env
} = {}) {
  if (!enabled(env.EVENT_RISK_ENABLED, true)) {
    return {
      enabled: false,
      status: "disabled",
      action: "NONE",
      severity: "LOW",
      events: [],
      score: 0,
      detail: "Event risk disabled"
    };
  }

  const events = [
    ...activeConfiguredEvents({ symbol, now, env }),
    ...keywordEvents(news)
  ];
  if (events.length === 0) {
    return {
      enabled: true,
      status: "clear",
      action: "NONE",
      severity: "LOW",
      events: [],
      score: 0,
      detail: "暂无事件风险触发。"
    };
  }

  const strongest = events.slice().sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
  const hasBlock = events.some((event) => event.action === "BLOCK");
  const highCount = events.filter((event) => event.severity === "HIGH").length;
  const score = clamp((events.length * 0.18) + (highCount * 0.35) + (hasBlock ? 0.4 : 0), 0, 1);

  return {
    enabled: true,
    status: hasBlock ? "block" : "reduce",
    action: hasBlock ? "BLOCK" : "REDUCE",
    severity: strongest.severity,
    events,
    score,
    detail: `${strongest.name}: ${strongest.detail}`
  };
}

export function applyEventRiskToIdea(idea, eventRisk) {
  if (!idea || !eventRisk?.enabled || eventRisk.status === "clear") {
    return eventRisk ? { ...idea, eventRisk } : idea;
  }

  const riskPenalty = eventRisk.action === "BLOCK" ? 0.18 : 0.07;
  const nextProbability = Math.max(0.35, Number(idea.winProbability ?? 0.5) - riskPenalty);

  return {
    ...idea,
    action: eventRisk.action === "BLOCK" ? "WAIT" : idea.action,
    winProbability: nextProbability,
    eventRisk,
    tradePlan: {
      ...(idea.tradePlan ?? {}),
      eventRiskAdjusted: true,
      summary: `${idea.tradePlan?.summary ?? "动态交易计划"} 事件风险 ${eventRisk.severity}，${eventRisk.action === "BLOCK" ? "暂停新开仓" : "降低胜率和执行优先级"}。`
    }
  };
}
