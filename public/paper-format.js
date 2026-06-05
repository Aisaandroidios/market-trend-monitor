function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function formatPaperMoney(value) {
  const number = finiteNumber(value);
  if (number === null) return "--";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(number);
}

export function formatPaperPercent(value) {
  const number = finiteNumber(value);
  if (number === null) return "--";
  return `${number.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function notionalForPosition(position) {
  const explicit = finiteNumber(position?.notional);
  if (explicit !== null) return explicit;

  const entry = finiteNumber(position?.entryPrice);
  const quantity = finiteNumber(position?.quantity);
  if (entry !== null && quantity !== null) return Math.abs(entry * quantity);
  return null;
}

function toneFor(value) {
  const number = finiteNumber(value, 0);
  return number >= 0 ? "positive" : "negative";
}

export function paperCapitalMetrics(position, account = {}) {
  const notional = notionalForPosition(position);
  const equity = finiteNumber(account?.equity, finiteNumber(account?.balance, finiteNumber(account?.initialBalance, 0)));
  const equityPercent = notional !== null && equity > 0 ? (notional / equity) * 100 : null;
  const notionalText = formatPaperMoney(notional);
  const equityPercentText = equityPercent === null ? "--" : formatPaperPercent(equityPercent);

  return {
    notional,
    notionalText,
    equityPercent,
    equityPercentText,
    line: `占用本金 ${notionalText} | 占权益 ${equityPercentText}`
  };
}

export function paperOpenPnlMetrics(position) {
  const pnl = finiteNumber(position?.unrealizedPnl);
  const pnlText = formatPaperMoney(pnl);
  const percentText = formatPaperPercent(position?.unrealizedPnlPercent);

  return {
    pnl,
    pnlText,
    percentText,
    tone: toneFor(pnl),
    line: `浮盈亏 ${pnlText} | 盈亏率 ${percentText}`
  };
}

export function paperClosedPnlMetrics(entry) {
  const pnl = finiteNumber(entry?.netPnl);
  const pnlText = formatPaperMoney(pnl);
  const percentText = formatPaperPercent(entry?.returnPercent);

  return {
    pnl,
    pnlText,
    percentText,
    tone: toneFor(pnl),
    line: `PnL ${pnlText} | 回报 ${percentText}`
  };
}
