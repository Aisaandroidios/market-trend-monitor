export function exponentialMovingAverage(values, period) {
  if (values.length === 0) return [];

  const smoothing = 2 / (period + 1);
  const ema = [values[0]];

  for (let index = 1; index < values.length; index += 1) {
    ema.push((values[index] * smoothing) + (ema[index - 1] * (1 - smoothing)));
  }

  return ema;
}

export function relativeStrengthIndex(values, period = 14) {
  if (values.length <= period) return 50;

  let gains = 0;
  let losses = 0;

  for (let index = values.length - period; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return 100;

  const relativeStrength = averageGain / averageLoss;
  return 100 - (100 / (1 + relativeStrength));
}

export function averageTrueRange(candles, period = 14) {
  if (candles.length === 0) return 0;

  const recent = candles.slice(-period);
  const trueRanges = recent.map((candle, index) => {
    const previousClose = index === 0
      ? candle.close
      : recent[index - 1].close;

    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose)
    );
  });

  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
}

export function movingAverage(values, period) {
  const recent = values.slice(-period);
  if (recent.length === 0) return 0;
  return recent.reduce((sum, value) => sum + value, 0) / recent.length;
}

export function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastSeries = exponentialMovingAverage(values, fast);
  const slowSeries = exponentialMovingAverage(values, slow);
  const macdSeries = fastSeries.map((value, index) => value - slowSeries[index]);
  const signalSeries = exponentialMovingAverage(macdSeries, signalPeriod);

  return {
    macd: macdSeries.at(-1) ?? 0,
    signal: signalSeries.at(-1) ?? 0,
    histogram: (macdSeries.at(-1) ?? 0) - (signalSeries.at(-1) ?? 0)
  };
}

export function bollingerBands(values, period = 20, multiplier = 2) {
  const recent = values.slice(-period);
  const middle = movingAverage(values, period);
  const variance = recent.reduce((sum, value) => sum + ((value - middle) ** 2), 0) / recent.length;
  const deviation = Math.sqrt(variance);

  return {
    upper: middle + (deviation * multiplier),
    middle,
    lower: middle - (deviation * multiplier)
  };
}

export function supportResistance(candles, lookback = 60) {
  const recent = candles.slice(-lookback);

  return {
    support: Math.min(...recent.map((candle) => candle.low)),
    resistance: Math.max(...recent.map((candle) => candle.high))
  };
}
