const defaultRules = {
  strongMovePercent: 5,
  nearExtremeDistancePercent: 0.5
};

const signalLabels = {
  strong_gainer: "强势上涨",
  strong_loser: "强势下跌",
  near_high: "接近高点",
  near_low: "接近低点"
};

function distancePercent(price, reference) {
  if (!price || !reference) return Infinity;
  return Math.abs((price - reference) / reference) * 100;
}

function buildSignal(ticker, type, severity, reason, now) {
  return {
    id: `${ticker.market}:${ticker.symbol}:${type}:${now}`,
    type,
    label: signalLabels[type],
    severity,
    symbol: ticker.symbol,
    market: ticker.market,
    provider: ticker.provider,
    price: ticker.price,
    changePercent: ticker.changePercent,
    reason,
    eventTime: ticker.eventTime,
    createdAt: new Date(now).toISOString()
  };
}

export function createSignalEngine({
  rules = defaultRules,
  cooldownMs = 30 * 60 * 1000,
  now = Date.now
} = {}) {
  const lastEmitted = new Map();

  function canEmit(signal) {
    const key = `${signal.market}:${signal.symbol}:${signal.type}`;
    const lastTime = lastEmitted.get(key);
    const currentTime = now();

    if (lastTime !== undefined && currentTime - lastTime < cooldownMs) {
      return false;
    }

    lastEmitted.set(key, currentTime);
    return true;
  }

  return {
    evaluate(tickers) {
      const currentTime = now();
      const candidates = [];

      for (const ticker of tickers) {
        if (ticker.changePercent >= rules.strongMovePercent) {
          candidates.push(buildSignal(
            ticker,
            "strong_gainer",
            "positive",
            `${ticker.symbol} change is ${ticker.changePercent.toFixed(2)}%`,
            currentTime
          ));
        }

        if (ticker.changePercent <= -rules.strongMovePercent) {
          candidates.push(buildSignal(
            ticker,
            "strong_loser",
            "negative",
            `${ticker.symbol} change is ${ticker.changePercent.toFixed(2)}%`,
            currentTime
          ));
        }

        if (ticker.changePercent > 0 && distancePercent(ticker.price, ticker.high) <= rules.nearExtremeDistancePercent) {
          candidates.push(buildSignal(
            ticker,
            "near_high",
            "positive",
            `${ticker.symbol} is within ${rules.nearExtremeDistancePercent}% of its high`,
            currentTime
          ));
        }

        if (ticker.changePercent < 0 && distancePercent(ticker.price, ticker.low) <= rules.nearExtremeDistancePercent) {
          candidates.push(buildSignal(
            ticker,
            "near_low",
            "negative",
            `${ticker.symbol} is within ${rules.nearExtremeDistancePercent}% of its low`,
            currentTime
          ));
        }
      }

      return candidates.filter(canEmit);
    }
  };
}
