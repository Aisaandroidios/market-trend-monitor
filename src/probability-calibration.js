function clamp(value, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 3) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function probabilityPercent(value) {
  const number = finite(value);
  if (number === null) return null;
  return number <= 1 ? number * 100 : number;
}

function normalizedProbability(value, fallback = 0.5) {
  const percent = probabilityPercent(value);
  if (percent === null) return fallback;
  return clamp(percent / 100, 0.01, 0.99);
}

function actionableRecord(record) {
  return record
    && ["LONG", "SHORT"].includes(record.direction)
    && probabilityPercent(record.winProbability) !== null;
}

function resolvedReview(record) {
  const review = record?.previousSignalReview;
  return review?.outcome === "RIGHT" || review?.outcome === "WRONG" ? review : null;
}

function recordKey(record) {
  return [
    String(record.symbol ?? "").toUpperCase(),
    record.generatedAt ?? "",
    record.direction ?? ""
  ].join("|");
}

function buildRecordIndex(records) {
  return new Map(
    records
      .filter(actionableRecord)
      .map((record) => [recordKey(record), record])
  );
}

function findReviewedSource({ record, review, index, records }) {
  const exact = index.get([
    String(record.symbol ?? "").toUpperCase(),
    review.previousGeneratedAt ?? "",
    review.previousDirection ?? ""
  ].join("|"));
  if (exact) return exact;

  const currentTime = Number(new Date(record.generatedAt ?? 0));
  return records
    .filter((candidate) => candidate.symbol === record.symbol)
    .filter((candidate) => candidate.direction === review.previousDirection)
    .filter(actionableRecord)
    .filter((candidate) => Number(new Date(candidate.generatedAt ?? 0)) < currentTime)
    .at(-1) ?? null;
}

function calibrationSamples(records = []) {
  const index = buildRecordIndex(records);
  const samples = [];

  for (const record of records) {
    const review = resolvedReview(record);
    if (!review) continue;

    const source = findReviewedSource({ record, review, index, records });
    if (!source) continue;

    const predictedPercent = probabilityPercent(source.winProbability);
    if (predictedPercent === null) continue;

    samples.push({
      symbol: source.symbol,
      direction: review.previousDirection ?? source.direction,
      generatedAt: source.generatedAt,
      reviewedAt: record.generatedAt,
      predictedPercent: round(predictedPercent, 2),
      predictedProbability: clamp(predictedPercent / 100, 0.01, 0.99),
      success: review.outcome === "RIGHT" ? 1 : 0,
      outcome: review.outcome,
      confidence: source.confidence ?? "LOW"
    });
  }

  return samples;
}

function bucketStart(percent, bucketSize) {
  return Math.floor(percent / bucketSize) * bucketSize;
}

function bucketLabel(start, bucketSize) {
  return `${start}-${start + bucketSize}`;
}

function emptyBucket(start, bucketSize) {
  return {
    key: bucketLabel(start, bucketSize),
    start,
    end: start + bucketSize,
    samples: 0,
    successes: 0,
    failures: 0,
    predictedAvg: 0,
    realizedRate: 0,
    calibrationError: 0,
    reliability: 0
  };
}

function finalizeBucket(bucket) {
  if (bucket.samples === 0) return bucket;
  bucket.failures = bucket.samples - bucket.successes;
  bucket.predictedAvg = round(bucket.predictedAvg / bucket.samples, 2);
  bucket.realizedRate = round((bucket.successes / bucket.samples) * 100, 2);
  bucket.calibrationError = round(Math.abs(bucket.predictedAvg - bucket.realizedRate), 2);
  bucket.reliability = round(clamp(1 - (bucket.calibrationError / 30), 0, 1) * clamp(bucket.samples / 12, 0.15, 1), 3);
  return bucket;
}

function buildBuckets(samples, bucketSize) {
  const map = new Map();

  for (const sample of samples) {
    const start = bucketStart(sample.predictedPercent, bucketSize);
    if (!map.has(start)) map.set(start, emptyBucket(start, bucketSize));
    const bucket = map.get(start);
    bucket.samples += 1;
    bucket.successes += sample.success;
    bucket.predictedAvg += sample.predictedPercent;
  }

  return Array.from(map.values())
    .sort((left, right) => left.start - right.start)
    .map(finalizeBucket);
}

function brierScore(samples) {
  if (samples.length === 0) return 0;
  const mean = samples.reduce((sum, sample) => sum + ((sample.predictedProbability - sample.success) ** 2), 0) / samples.length;
  return round(mean, 4);
}

function expectedCalibrationError(buckets, totalSamples) {
  if (totalSamples === 0) return 0;
  const weighted = buckets.reduce((sum, bucket) => {
    return sum + ((bucket.samples / totalSamples) * bucket.calibrationError);
  }, 0);
  return round(weighted, 2);
}

function overallStats(samples, buckets) {
  const total = samples.length;
  const successes = samples.reduce((sum, sample) => sum + sample.success, 0);
  const predictedAvg = total === 0
    ? 0
    : samples.reduce((sum, sample) => sum + sample.predictedPercent, 0) / total;
  const realizedRate = total === 0 ? 0 : (successes / total) * 100;

  return {
    samples: total,
    successes,
    failures: total - successes,
    predictedAvg: round(predictedAvg, 2),
    realizedRate: round(realizedRate, 2),
    overconfidence: round(predictedAvg - realizedRate, 2),
    expectedCalibrationError: expectedCalibrationError(buckets, total),
    brierScore: brierScore(samples)
  };
}

function directionStats(samples) {
  return Object.fromEntries(["LONG", "SHORT"].map((direction) => {
    const rows = samples.filter((sample) => sample.direction === direction);
    const successes = rows.reduce((sum, sample) => sum + sample.success, 0);
    return [direction.toLowerCase(), {
      samples: rows.length,
      successes,
      failures: rows.length - successes,
      realizedRate: rows.length === 0 ? 0 : round((successes / rows.length) * 100, 2)
    }];
  }));
}

function symbolStats(samples, limit = 12) {
  const map = new Map();
  for (const sample of samples) {
    if (!map.has(sample.symbol)) {
      map.set(sample.symbol, {
        symbol: sample.symbol,
        samples: 0,
        successes: 0,
        predictedAvg: 0
      });
    }
    const stats = map.get(sample.symbol);
    stats.samples += 1;
    stats.successes += sample.success;
    stats.predictedAvg += sample.predictedPercent;
  }

  return Array.from(map.values())
    .map((stats) => ({
      ...stats,
      failures: stats.samples - stats.successes,
      predictedAvg: round(stats.predictedAvg / Math.max(1, stats.samples), 2),
      realizedRate: stats.samples === 0 ? 0 : round((stats.successes / stats.samples) * 100, 2)
    }))
    .sort((left, right) => right.samples - left.samples)
    .slice(0, limit);
}

function bucketForProbability(buckets, probability, bucketSize) {
  const percent = probabilityPercent(probability);
  if (percent === null) return null;
  const start = bucketStart(percent, bucketSize);
  return buckets.find((bucket) => bucket.start === start) ?? null;
}

function calibrationNote(calibration) {
  if (!calibration || calibration.status === "insufficient_samples") {
    return "胜率校准样本不足，当前仍以模型估算为主。";
  }

  const direction = calibration.adjustmentPercent > 0
    ? "上调"
    : calibration.adjustmentPercent < 0
      ? "下调"
      : "保持";
  return `预测分桶 ${calibration.bucketKey} 样本 ${calibration.samples}，真实胜率 ${calibration.realizedRate}%，校准后${direction} ${Math.abs(calibration.adjustmentPercent)}%。`;
}

export function buildProbabilityCalibration(records = [], {
  bucketSize = Number(process.env.PROBABILITY_CALIBRATION_BUCKET_SIZE ?? 5),
  minBucketSamples = Number(process.env.PROBABILITY_CALIBRATION_MIN_BUCKET_SAMPLES ?? 4),
  minTotalSamples = Number(process.env.PROBABILITY_CALIBRATION_MIN_TOTAL_SAMPLES ?? 6),
  now = Date.now()
} = {}) {
  const samples = calibrationSamples(records);
  const buckets = buildBuckets(samples, bucketSize);
  const overall = overallStats(samples, buckets);

  return {
    generatedAt: new Date(now).toISOString(),
    status: samples.length >= minTotalSamples ? "ok" : "insufficient_samples",
    bucketSize,
    minBucketSamples,
    minTotalSamples,
    overall,
    buckets,
    directions: directionStats(samples),
    symbols: symbolStats(samples),
    samples: samples.slice(-100)
  };
}

export function calibrateProbability(calibration, probability) {
  const raw = normalizedProbability(probability);
  const rawPercent = round(raw * 100, 2);
  if (!calibration || calibration.status !== "ok") {
    return {
      status: "insufficient_samples",
      rawProbability: raw,
      calibratedProbability: raw,
      rawPercent,
      calibratedPercent: rawPercent,
      adjustmentPercent: 0,
      reliability: 0,
      note: calibrationNote(null)
    };
  }

  const bucket = bucketForProbability(calibration.buckets ?? [], raw, calibration.bucketSize ?? 5);
  if (!bucket || bucket.samples < calibration.minBucketSamples) {
    return {
      status: "bucket_insufficient",
      bucketKey: bucket?.key ?? null,
      samples: bucket?.samples ?? 0,
      rawProbability: raw,
      calibratedProbability: raw,
      rawPercent,
      calibratedPercent: rawPercent,
      adjustmentPercent: 0,
      reliability: bucket?.reliability ?? 0,
      note: "当前胜率分桶样本不足，暂不调整。"
    };
  }

  const observed = clamp(bucket.realizedRate / 100, 0.01, 0.99);
  const sampleWeight = clamp(bucket.samples / 16, 0.15, 0.72);
  const reliabilityWeight = clamp(bucket.reliability, 0.05, 0.85);
  const weight = clamp((sampleWeight * 0.65) + (reliabilityWeight * 0.35), 0.12, 0.75);
  const calibrated = clamp((raw * (1 - weight)) + (observed * weight), 0.35, 0.82);
  const calibratedPercent = round(calibrated * 100, 2);
  const result = {
    status: "ok",
    bucketKey: bucket.key,
    samples: bucket.samples,
    predictedAvg: bucket.predictedAvg,
    realizedRate: bucket.realizedRate,
    calibrationError: bucket.calibrationError,
    rawProbability: raw,
    calibratedProbability: round(calibrated, 4),
    rawPercent,
    calibratedPercent,
    adjustmentPercent: round(calibratedPercent - rawPercent, 2),
    reliability: bucket.reliability,
    weight: round(weight, 3)
  };

  return {
    ...result,
    note: calibrationNote(result)
  };
}

export function applyProbabilityCalibration(idea, calibration) {
  if (!idea || !["LONG", "SHORT"].includes(idea.direction)) return idea;
  const result = calibrateProbability(calibration, idea.winProbability);

  return {
    ...idea,
    rawWinProbability: idea.rawWinProbability ?? idea.winProbability,
    winProbability: result.calibratedProbability,
    probabilityCalibration: result
  };
}
