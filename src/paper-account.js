import {
  existsSync,
  readFileSync
} from "node:fs";
import path from "node:path";
import { createDataStore } from "./data-store.js";

const defaultAccountPath = path.join(process.cwd(), "data", "paper-account.json");
const defaultTradesPath = path.join(process.cwd(), "data", "paper-trades.jsonl");
const confidenceRank = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3
};

function boolFromEnv(value, fallback = true) {
  if (value == null || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
}

function numberFromEnv(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function roundMoney(value) {
  return round(value, 2);
}

function nowIso(now) {
  return new Date(now).toISOString();
}

function beijingDateParts(now) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(now));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dateAtUtc = new Date(`${byType.year}-${byType.month}-${byType.day}T00:00:00.000Z`);
  const day = dateAtUtc.getUTCDay() || 7;
  const monday = new Date(dateAtUtc);
  monday.setUTCDate(dateAtUtc.getUTCDate() - day + 1);

  return {
    date: `${byType.year}-${byType.month}-${byType.day}`,
    week: monday.toISOString().slice(0, 10),
    month: `${byType.year}-${byType.month}`,
    year: byType.year
  };
}

function actionForDirection(direction) {
  if (direction === "LONG") return "BUY";
  if (direction === "SHORT") return "SELL";
  return "WAIT";
}

function priceForIdea(idea) {
  return finiteNumber(idea?.currentPrice ?? idea?.price ?? idea?.entry);
}

function plannedLevels(idea) {
  const entry = priceForIdea(idea);
  const takeProfit = finiteNumber(idea?.takeProfit);
  const stopLoss = finiteNumber(idea?.stopLoss);
  if (!entry || !takeProfit || !stopLoss) return null;

  return { entry, takeProfit, stopLoss };
}

function applySlippage(price, side, slippageBps) {
  const multiplier = Number(slippageBps) / 10000;
  if (side === "BUY") return price * (1 + multiplier);
  if (side === "SELL") return price * (1 - multiplier);
  return price;
}

function grossPnl(position, exitPrice) {
  if (position.direction === "LONG") {
    return (exitPrice - position.entryPrice) * position.quantity;
  }
  if (position.direction === "SHORT") {
    return (position.entryPrice - exitPrice) * position.quantity;
  }
  return 0;
}

function estimateExitFee(position, price, feeRate) {
  return Math.abs(price * position.quantity) * feeRate;
}

function confidenceAllows(idea, minConfidence) {
  const minimum = confidenceRank[String(minConfidence ?? "LOW").toUpperCase()] ?? 1;
  const current = confidenceRank[String(idea?.confidence ?? "LOW").toUpperCase()] ?? 1;
  return current >= minimum;
}

function effectiveThresholds(config, strategyPolicy = null) {
  if (config.adaptiveThresholds && strategyPolicy) {
    return {
      minConviction: finiteNumber(strategyPolicy.minConviction, config.minConviction),
      minRiskReward: finiteNumber(strategyPolicy.minRiskReward, config.minRiskReward),
      minConfidence: strategyPolicy.minConfidence ?? config.minConfidence,
      minPlaybookScore: finiteNumber(strategyPolicy.minPlaybookScore, config.minPlaybookScore),
      mode: "adaptive"
    };
  }

  return {
    minConviction: config.minConviction,
    minRiskReward: config.minRiskReward,
    minConfidence: config.minConfidence,
    minPlaybookScore: config.minPlaybookScore,
    mode: "fixed"
  };
}

function isExecutableCandidate(idea, config, strategyPolicy = null) {
  if (!idea || !["LONG", "SHORT"].includes(idea.direction)) return false;
  if (![actionForDirection(idea.direction), "BUY", "SELL"].includes(idea.action)) return false;
  if (!plannedLevels(idea)) return false;

  const thresholds = effectiveThresholds(config, strategyPolicy);
  const convictionScore = finiteNumber(idea.convictionScore, 0);
  const riskReward = finiteNumber(idea.riskReward, 0);
  const playbookScore = finiteNumber(idea.tradePlaybook?.score, 0.5);
  const playbookDecision = idea.tradePlaybook?.decision ?? "WATCH";

  if (convictionScore < thresholds.minConviction) return false;
  if (riskReward < thresholds.minRiskReward) return false;
  if (!confidenceAllows(idea, thresholds.minConfidence)) return false;
  if (playbookScore < thresholds.minPlaybookScore) return false;
  if (config.requireExecute && playbookDecision !== "EXECUTE") return false;

  return true;
}

function dedupeIdeas(ideas = []) {
  const bySymbol = new Map();
  for (const idea of ideas.filter(Boolean)) {
    const symbol = String(idea.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    const previous = bySymbol.get(symbol);
    if (!previous || finiteNumber(idea.convictionScore, 0) > finiteNumber(previous.convictionScore, 0)) {
      bySymbol.set(symbol, { ...idea, symbol });
    }
  }
  return Array.from(bySymbol.values());
}

function candidateIdeas({ bestSignal, ideas = [], config, strategyPolicy = null }) {
  return dedupeIdeas([
    bestSignal,
    ...(bestSignal?.alternatives ?? []),
    ...ideas
  ])
    .filter((idea) => isExecutableCandidate(idea, config, strategyPolicy))
    .sort((left, right) => finiteNumber(right.convictionScore, 0) - finiteNumber(left.convictionScore, 0));
}

function emptyDirectionStats() {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    netPnl: 0,
    winRate: 0
  };
}

function addTradeToStats(stats, trade) {
  stats.trades += 1;
  stats.netPnl = roundMoney(stats.netPnl + trade.netPnl);
  if (trade.netPnl > 0) stats.wins += 1;
  else if (trade.netPnl < 0) stats.losses += 1;
  else stats.breakeven += 1;
}

function finalizeStats(stats) {
  const resolved = stats.wins + stats.losses;
  stats.winRate = resolved === 0 ? 0 : round((stats.wins / resolved) * 100, 2);
  return stats;
}

function statsForTrades(trades) {
  const stats = {
    trades: 0,
    wins: 0,
    losses: 0,
    breakeven: 0,
    netPnl: 0,
    winRate: 0,
    long: emptyDirectionStats(),
    short: emptyDirectionStats()
  };

  for (const trade of trades) {
    addTradeToStats(stats, trade);
    if (trade.direction === "LONG") addTradeToStats(stats.long, trade);
    if (trade.direction === "SHORT") addTradeToStats(stats.short, trade);
  }

  finalizeStats(stats);
  finalizeStats(stats.long);
  finalizeStats(stats.short);
  return stats;
}

function periodStats(trades, now) {
  const currentParts = beijingDateParts(now);
  const filters = {
    day: (trade) => beijingDateParts(trade.closedAt).date === currentParts.date,
    week: (trade) => beijingDateParts(trade.closedAt).week === currentParts.week,
    month: (trade) => beijingDateParts(trade.closedAt).month === currentParts.month,
    year: (trade) => beijingDateParts(trade.closedAt).year === currentParts.year
  };

  return Object.fromEntries(
    Object.entries(filters).map(([key, filter]) => [key, statsForTrades(trades.filter(filter))])
  );
}

function buildStats(state, now) {
  return {
    total: statsForTrades(state.closedTrades),
    periods: periodStats(state.closedTrades, now)
  };
}

function createInitialState(config) {
  return {
    version: 1,
    mode: "paper",
    initialBalance: config.initialBalance,
    balance: config.initialBalance,
    equity: config.initialBalance,
    peakEquity: config.initialBalance,
    maxDrawdownPercent: 0,
    nextPositionId: 1,
    openPositions: [],
    closedTrades: [],
    equityCurve: [],
    updatedAt: null
  };
}

function normalizeState(raw, config) {
  const fallback = createInitialState(config);
  if (!raw || typeof raw !== "object") return fallback;

  return {
    ...fallback,
    ...raw,
    initialBalance: finiteNumber(raw.initialBalance, config.initialBalance),
    balance: finiteNumber(raw.balance, config.initialBalance),
    equity: finiteNumber(raw.equity, finiteNumber(raw.balance, config.initialBalance)),
    peakEquity: finiteNumber(raw.peakEquity, config.initialBalance),
    maxDrawdownPercent: finiteNumber(raw.maxDrawdownPercent, 0),
    nextPositionId: Math.max(1, Math.trunc(finiteNumber(raw.nextPositionId, 1))),
    openPositions: Array.isArray(raw.openPositions) ? raw.openPositions : [],
    closedTrades: Array.isArray(raw.closedTrades) ? raw.closedTrades : [],
    equityCurve: Array.isArray(raw.equityCurve) ? raw.equityCurve.slice(-500) : []
  };
}

function loadState(config) {
  if (!existsSync(config.accountPath)) return createInitialState(config);

  try {
    return normalizeState(JSON.parse(readFileSync(config.accountPath, "utf8")), config);
  } catch {
    return createInitialState(config);
  }
}

function updateEquity(state, config, now) {
  const unrealized = state.openPositions.reduce((sum, position) => {
    const currentPrice = finiteNumber(position.currentPrice, position.entryPrice);
    return sum + grossPnl(position, currentPrice) - estimateExitFee(position, currentPrice, config.feeRate);
  }, 0);
  state.equity = roundMoney(state.balance + unrealized);
  state.peakEquity = Math.max(finiteNumber(state.peakEquity, state.equity), state.equity);
  const drawdown = state.peakEquity <= 0 ? 0 : ((state.peakEquity - state.equity) / state.peakEquity) * 100;
  state.maxDrawdownPercent = round(Math.max(finiteNumber(state.maxDrawdownPercent, 0), drawdown), 2);
  state.updatedAt = nowIso(now);
  state.equityCurve.push({
    at: state.updatedAt,
    equity: state.equity,
    balance: roundMoney(state.balance),
    openPositions: state.openPositions.length
  });
  state.equityCurve = state.equityCurve.slice(-500);
}

function closePosition({ state, config, store, position, exitPrice, reason, now }) {
  const closedAt = nowIso(now);
  const exitFee = estimateExitFee(position, exitPrice, config.feeRate);
  const tradeGrossPnl = grossPnl(position, exitPrice);
  const netPnl = tradeGrossPnl - position.entryFee - exitFee;
  const trade = {
    ...position,
    status: "CLOSED",
    closedAt,
    exitPrice: round(exitPrice, 8),
    closeReason: reason,
    grossPnl: roundMoney(tradeGrossPnl),
    exitFee: roundMoney(exitFee),
    totalFees: roundMoney(position.entryFee + exitFee),
    netPnl: roundMoney(netPnl),
    returnPercent: round((netPnl / Math.max(1, Math.abs(position.entryPrice * position.quantity))) * 100, 4)
  };

  state.balance = roundMoney(state.balance + tradeGrossPnl - exitFee);
  state.closedTrades.push(trade);
  store.appendPaperTrade(trade);
  return trade;
}

function closeTriggeredPosition({ position, idea, candidate, config }) {
  const price = priceForIdea(idea) ?? finiteNumber(position.currentPrice, position.entryPrice);
  if (!price) return null;

  if (position.direction === "LONG") {
    if (price >= position.takeProfit) {
      return {
        reason: "TAKE_PROFIT",
        exitPrice: applySlippage(position.takeProfit, "SELL", config.slippageBps)
      };
    }
    if (price <= position.stopLoss) {
      return {
        reason: "STOP_LOSS",
        exitPrice: applySlippage(position.stopLoss, "SELL", config.slippageBps)
      };
    }
  }

  if (position.direction === "SHORT") {
    if (price <= position.takeProfit) {
      return {
        reason: "TAKE_PROFIT",
        exitPrice: applySlippage(position.takeProfit, "BUY", config.slippageBps)
      };
    }
    if (price >= position.stopLoss) {
      return {
        reason: "STOP_LOSS",
        exitPrice: applySlippage(position.stopLoss, "BUY", config.slippageBps)
      };
    }
  }

  if (candidate && candidate.direction !== position.direction) {
    return {
      reason: "OPPOSITE_SIGNAL",
      exitPrice: applySlippage(price, actionForDirection(candidate.direction), config.slippageBps)
    };
  }

  return null;
}

function markPosition(position, idea, config, now) {
  const currentPrice = priceForIdea(idea);
  if (!currentPrice) return position;
  const unrealizedGross = grossPnl(position, currentPrice);
  const estimatedExitFee = estimateExitFee(position, currentPrice, config.feeRate);
  const net = unrealizedGross - position.entryFee - estimatedExitFee;

  return {
    ...position,
    currentPrice: round(currentPrice, 8),
    unrealizedPnl: roundMoney(net),
    unrealizedPnlPercent: round((net / Math.max(1, Math.abs(position.entryPrice * position.quantity))) * 100, 4),
    lastMarkedAt: nowIso(now)
  };
}

function openPosition({ state, config, idea, now }) {
  const levels = plannedLevels(idea);
  if (!levels) return null;

  const stopDistance = Math.abs(levels.entry - levels.stopLoss);
  const equity = Math.max(1, finiteNumber(state.equity, state.balance));
  const riskBudget = equity * config.riskPerTrade;
  if (stopDistance <= 0 || riskBudget <= 0) return null;

  const side = actionForDirection(idea.direction);
  const entryPrice = applySlippage(levels.entry, side, config.slippageBps);
  const rawQuantity = riskBudget / stopDistance;
  const maxNotional = equity * config.maxNotionalPercent;
  const notionalCappedQuantity = maxNotional > 0 ? Math.min(rawQuantity, maxNotional / entryPrice) : rawQuantity;
  const quantity = round(Math.max(0, notionalCappedQuantity), 8);
  if (quantity <= 0) return null;

  const notional = entryPrice * quantity;
  const entryFee = notional * config.feeRate;
  const openedAt = nowIso(now);
  const position = {
    id: `PAPER-${state.nextPositionId}`,
    status: "OPEN",
    symbol: String(idea.symbol).toUpperCase(),
    direction: idea.direction,
    action: side,
    openedAt,
    plannedEntry: round(levels.entry, 8),
    entryPrice: round(entryPrice, 8),
    currentPrice: round(levels.entry, 8),
    quantity,
    notional: roundMoney(notional),
    entryFee: roundMoney(entryFee),
    takeProfit: round(levels.takeProfit, 8),
    stopLoss: round(levels.stopLoss, 8),
    riskReward: finiteNumber(idea.riskReward, 0),
    convictionScore: finiteNumber(idea.convictionScore, 0),
    confidence: idea.confidence ?? "LOW",
    winProbability: finiteNumber(idea.winProbability, 0),
    dataSource: idea.dataSource ?? null,
    tradePlaybook: idea.tradePlaybook
      ? {
          grade: idea.tradePlaybook.grade,
          decision: idea.tradePlaybook.decision,
          score: idea.tradePlaybook.score
        }
      : null,
    reason: idea.summary ?? idea.reason ?? ""
  };

  state.nextPositionId += 1;
  state.balance = roundMoney(state.balance - entryFee);
  state.openPositions.push(position);
  return position;
}

export function paperAccountConfigFromEnv(env = process.env) {
  return {
    enabled: boolFromEnv(env.PAPER_TRADING_ENABLED, true),
    accountPath: env.PAPER_ACCOUNT_PATH || defaultAccountPath,
    tradesPath: env.PAPER_TRADES_PATH || defaultTradesPath,
    initialBalance: numberFromEnv(env.PAPER_INITIAL_BALANCE, 10000),
    riskPerTrade: clamp(numberFromEnv(env.PAPER_RISK_PER_TRADE, 0.02), 0.0001, 0.1),
    maxNotionalPercent: clamp(numberFromEnv(env.PAPER_MAX_NOTIONAL_PCT, 1), 0.01, 5),
    maxOpenPositions: Math.max(1, Math.trunc(numberFromEnv(env.PAPER_MAX_OPEN_POSITIONS, 6))),
    minConviction: numberFromEnv(env.PAPER_MIN_CONVICTION, 68),
    minRiskReward: numberFromEnv(env.PAPER_MIN_RR, 1.3),
    minConfidence: env.PAPER_MIN_CONFIDENCE || "MEDIUM",
    minPlaybookScore: clamp(numberFromEnv(env.PAPER_MIN_PLAYBOOK_SCORE, 0.5), 0, 1),
    adaptiveThresholds: boolFromEnv(env.PAPER_ADAPTIVE_THRESHOLDS, true),
    dataStoreMode: env.DATA_STORE ?? env.STORAGE_BACKEND ?? "auto",
    sqlitePath: env.SQLITE_DB_PATH ?? path.join(process.cwd(), "data", "market-monitor.sqlite"),
    requireExecute: boolFromEnv(env.PAPER_REQUIRE_EXECUTE, false),
    feeRate: clamp(numberFromEnv(env.PAPER_FEE_RATE, 0), 0, 0.02),
    slippageBps: clamp(numberFromEnv(env.PAPER_SLIPPAGE_BPS, 0), 0, 200)
  };
}

export function createPaperAccount(config = paperAccountConfigFromEnv()) {
  const store = config.dataStore ?? createDataStore({
    mode: config.dataStoreMode ?? "file",
    sqlitePath: config.sqlitePath,
    signalHistoryPath: process.env.SIGNAL_HISTORY_PATH ?? path.join(process.cwd(), "data", "signal-history.jsonl"),
    paperAccountPath: config.accountPath,
    paperTradesPath: config.tradesPath
  });
  const state = normalizeState(store.loadPaperAccountState() ?? loadState(config), config);
  let lastEffectiveThresholds = effectiveThresholds(config);

  function snapshot(now = Date.now()) {
    const stats = buildStats(state, now);
    return {
      enabled: config.enabled,
      mode: "simulated_live",
      initialBalance: state.initialBalance,
      balance: roundMoney(state.balance),
      equity: roundMoney(state.equity),
      peakEquity: roundMoney(state.peakEquity),
      maxDrawdownPercent: state.maxDrawdownPercent,
      openPositionCount: state.openPositions.length,
      closedTradeCount: state.closedTrades.length,
      openPositions: state.openPositions,
      recentClosedTrades: state.closedTrades.slice(-30).reverse(),
      equityCurve: state.equityCurve.slice(-200),
      stats,
      config: {
        riskPerTrade: config.riskPerTrade,
        maxNotionalPercent: config.maxNotionalPercent,
        maxOpenPositions: config.maxOpenPositions,
        minConviction: config.minConviction,
        minRiskReward: config.minRiskReward,
        minConfidence: config.minConfidence,
        minPlaybookScore: config.minPlaybookScore,
        adaptiveThresholds: config.adaptiveThresholds,
        requireExecute: config.requireExecute,
        feeRate: config.feeRate,
        slippageBps: config.slippageBps
      },
      effectiveThresholds: lastEffectiveThresholds,
      storage: store.info(),
      updatedAt: state.updatedAt
    };
  }

  function processSignals({
    bestSignal = null,
    ideas = [],
    strategyPolicy = null,
    now = Date.now()
  } = {}) {
    lastEffectiveThresholds = effectiveThresholds(config, strategyPolicy);
    if (!config.enabled) {
      updateEquity(state, config, now);
      store.savePaperAccountState(state);
      return snapshot(now);
    }

    const candidates = candidateIdeas({ bestSignal, ideas, config, strategyPolicy });
    const candidateBySymbol = new Map(candidates.map((idea) => [idea.symbol, idea]));
    const ideaBySymbol = new Map(dedupeIdeas([bestSignal, ...(bestSignal?.alternatives ?? []), ...ideas]).map((idea) => [idea.symbol, idea]));
    const remainingPositions = [];

    for (const position of state.openPositions) {
      const idea = ideaBySymbol.get(position.symbol);
      const markedPosition = markPosition(position, idea, config, now);
      const closePlan = closeTriggeredPosition({
        position: markedPosition,
        idea,
        candidate: candidateBySymbol.get(position.symbol),
        config
      });

      if (closePlan) {
        closePosition({
          state,
          config,
          store,
          position: markedPosition,
          exitPrice: closePlan.exitPrice,
          reason: closePlan.reason,
          now
        });
      } else {
        remainingPositions.push(markedPosition);
      }
    }

    state.openPositions = remainingPositions;

    for (const idea of candidates) {
      if (state.openPositions.length >= config.maxOpenPositions) break;
      if (state.openPositions.some((position) => position.symbol === idea.symbol)) continue;
      openPosition({ state, config, idea, now });
    }

    updateEquity(state, config, now);
    store.savePaperAccountState(state);
    return snapshot(now);
  }

  return {
    processSignals,
    snapshot
  };
}
