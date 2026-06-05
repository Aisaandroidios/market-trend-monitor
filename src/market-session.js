const newYorkTimeZone = "America/New_York";

const defaultDecisionIntervals = {
  regular: 900000,
  near_open: 1800000,
  premarket: 3600000,
  after_hours: 3600000,
  off_hours: 14400000,
  weekend: 14400000
};

const sessionLabels = {
  regular: "美股盘中",
  near_open: "美股临近开盘盘前",
  premarket: "美股普通盘前",
  after_hours: "美股盘后",
  off_hours: "美股非交易时段",
  weekend: "美股周末",
  fixed: "固定频率"
};

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function envInterval(name, fallback) {
  return positiveNumber(process.env[name], fallback);
}

function envEnabled(name, fallback = true) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(raw).trim().toLowerCase());
}

function newYorkClockParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: newYorkTimeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const second = Number(values.second);

  return {
    weekday: values.weekday,
    hour,
    minute,
    second,
    minuteOfDay: (hour * 60) + minute
  };
}

export function classifyUsMarketSession(now = new Date()) {
  const clock = newYorkClockParts(now);
  const weekday = clock.weekday;
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  let session = "off_hours";

  if (isWeekend) {
    session = "weekend";
  } else if (clock.minuteOfDay >= 570 && clock.minuteOfDay < 960) {
    session = "regular";
  } else if (clock.minuteOfDay >= 420 && clock.minuteOfDay < 570) {
    session = "near_open";
  } else if (clock.minuteOfDay >= 240 && clock.minuteOfDay < 420) {
    session = "premarket";
  } else if (clock.minuteOfDay >= 960 && clock.minuteOfDay < 1200) {
    session = "after_hours";
  }

  return {
    session,
    label: sessionLabels[session],
    timeZone: newYorkTimeZone,
    weekday,
    hour: clock.hour,
    minute: clock.minute
  };
}

export function decisionScheduleConfigFromEnv({ fixedIntervalMs = 300000 } = {}) {
  return {
    scheduleEnabled: envEnabled("US_MARKET_AWARE_DECISION_SCHEDULE", true),
    fixedIntervalMs: positiveNumber(fixedIntervalMs, 300000),
    intervals: {
      regular: envInterval("US_MARKET_REGULAR_DECISION_INTERVAL_MS", defaultDecisionIntervals.regular),
      near_open: envInterval("US_MARKET_NEAR_OPEN_DECISION_INTERVAL_MS", defaultDecisionIntervals.near_open),
      premarket: envInterval("US_MARKET_PREMARKET_DECISION_INTERVAL_MS", defaultDecisionIntervals.premarket),
      after_hours: envInterval("US_MARKET_AFTER_HOURS_DECISION_INTERVAL_MS", defaultDecisionIntervals.after_hours),
      off_hours: envInterval("US_MARKET_OFF_HOURS_DECISION_INTERVAL_MS", defaultDecisionIntervals.off_hours),
      weekend: envInterval("US_MARKET_WEEKEND_DECISION_INTERVAL_MS", defaultDecisionIntervals.weekend)
    }
  };
}

export function decisionIntervalForUsMarketSession({
  now = new Date(),
  scheduleEnabled = true,
  fixedIntervalMs = 300000,
  intervals = {}
} = {}) {
  const fixedInterval = positiveNumber(fixedIntervalMs, 300000);
  if (!scheduleEnabled) {
    const nextRunAt = new Date(now.getTime() + fixedInterval);
    return {
      session: "fixed",
      label: sessionLabels.fixed,
      intervalMs: fixedInterval,
      delayMs: fixedInterval,
      nextRunAt: nextRunAt.toISOString()
    };
  }

  const classification = classifyUsMarketSession(now);
  const mergedIntervals = {
    ...defaultDecisionIntervals,
    ...intervals
  };

  const intervalMs = positiveNumber(mergedIntervals[classification.session], fixedInterval);
  const delayMs = alignedDelayMs({ now, intervalMs });
  const nextRunAt = new Date(now.getTime() + delayMs);

  return {
    ...classification,
    intervalMs,
    delayMs,
    nextRunAt: nextRunAt.toISOString()
  };
}

function alignedDelayMs({ now, intervalMs }) {
  const intervalMinutes = Math.max(1, Math.round(intervalMs / 60000));
  const clock = newYorkClockParts(now);
  const elapsedMsToday = (((clock.minuteOfDay * 60) + clock.second) * 1000) + now.getMilliseconds();
  const intervalWindowMs = intervalMinutes * 60000;
  const remainder = elapsedMsToday % intervalWindowMs;

  return remainder === 0 ? intervalWindowMs : intervalWindowMs - remainder;
}
