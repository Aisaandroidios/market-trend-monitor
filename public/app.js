const rowsElement = document.querySelector("#tickerRows");
const searchInput = document.querySelector("#searchInput");
const sortSelect = document.querySelector("#sortSelect");
const cryptoCount = document.querySelector("#cryptoCount");
const stockCount = document.querySelector("#stockCount");
const commodityCount = document.querySelector("#commodityCount");
const signalCount = document.querySelector("#signalCount");
const lastUpdate = document.querySelector("#lastUpdate");
const statusWrap = document.querySelector(".status");
const connectionStatus = document.querySelector("#connectionStatus");
const binanceStatus = document.querySelector("#binanceStatus");
const stooqStatus = document.querySelector("#stooqStatus");
const stockCards = document.querySelector("#stockCards");
const commodityCards = document.querySelector("#commodityCards");
const signalList = document.querySelector("#signalList");
const tradeIdeaList = document.querySelector("#tradeIdeaList");
const bestSignalCard = document.querySelector("#bestSignalCard");
const bestSignalContext = document.querySelector("#bestSignalContext");
const activeMarketList = document.querySelector("#activeMarketList");
const paperAccountCard = document.querySelector("#paperAccountCard");
const paperAccountContext = document.querySelector("#paperAccountContext");
const attributionCard = document.querySelector("#attributionCard");
const attributionContext = document.querySelector("#attributionContext");
const calibrationCard = document.querySelector("#calibrationCard");
const calibrationContext = document.querySelector("#calibrationContext");

let tickers = [];
let stocks = [];
let commodities = [];
let signals = [];
let tradeIdeas = [];
let bestSignal = null;
let activeMarkets = { crypto: [], stocks: [], commodities: [] };
let paperAccount = null;
let strategyPolicy = null;
let performanceAttribution = null;
let probabilityCalibration = null;

function formatNumber(value, maximumFractionDigits = 8) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits
  }).format(value);
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(value);
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value ?? 0);
}

function statusLabel(status) {
  const labels = {
    connected: "已连接",
    connecting: "连接中",
    reconnecting: "重连中",
    error: "连接错误",
    disabled: "未启用",
    websocket_unavailable: "环境不支持"
  };
  return labels[status] ?? status;
}

function render() {
  const query = searchInput.value.trim().toUpperCase();
  const sortBy = sortSelect.value;

  const filtered = tickers
    .filter((ticker) => ticker.symbol.includes(query))
    .sort((left, right) => {
      if (sortBy === "symbol") return left.symbol.localeCompare(right.symbol);
      return Number(right[sortBy]) - Number(left[sortBy]);
    })
    .slice(0, 300);

  if (filtered.length === 0) {
    rowsElement.innerHTML = `<tr><td colspan="7" class="empty">没有匹配的交易对</td></tr>`;
    return;
  }

  rowsElement.innerHTML = filtered.map((ticker) => {
    const changeClass = ticker.changePercent >= 0 ? "positive" : "negative";
    const updatedAt = new Date(ticker.eventTime).toLocaleTimeString();

    return `
      <tr>
        <td class="symbol">${ticker.symbol}</td>
        <td>${formatNumber(ticker.price)}</td>
        <td class="${changeClass}">${ticker.changePercent.toFixed(2)}%</td>
        <td>${formatNumber(ticker.high)}</td>
        <td>${formatNumber(ticker.low)}</td>
        <td>${formatCompact(ticker.quoteVolume)}</td>
        <td>${updatedAt}</td>
      </tr>
    `;
  }).join("");
}

function renderCards(target, items) {
  if (items.length === 0) {
    target.innerHTML = `<p class="empty-inline">等待数据...</p>`;
    return;
  }

  target.innerHTML = items.map((ticker) => {
    const changeClass = ticker.changePercent >= 0 ? "positive" : "negative";
    return `
      <article class="quote-card">
        <div>
          <strong>${ticker.symbol}</strong>
          <span>${ticker.provider}</span>
        </div>
        <b>${formatNumber(ticker.price, 4)}</b>
        <em class="${changeClass}">${ticker.changePercent.toFixed(2)}%</em>
      </article>
    `;
  }).join("");
}

function renderSignals() {
  if (signals.length === 0) {
    signalList.innerHTML = `<p class="empty-inline">等待信号...</p>`;
    return;
  }

  signalList.innerHTML = signals.slice(0, 8).map((signal) => `
    <article class="signal ${signal.severity}">
      <strong>${signal.symbol} ${signal.label}</strong>
      <span>${signal.market} · ${signal.changePercent.toFixed(2)}% · ${new Date(signal.eventTime).toLocaleTimeString()}</span>
    </article>
  `).join("");
}

function renderTradeIdeas() {
  if (tradeIdeas.length === 0) {
    tradeIdeaList.innerHTML = `<p class="empty-inline">等待技术指标计算...</p>`;
    return;
  }

  tradeIdeaList.innerHTML = tradeIdeas.slice(0, 9).map((idea) => {
    const directionClass = idea.direction === "LONG" ? "positive" : idea.direction === "SHORT" ? "negative" : "";
    return `
      <article class="trade-card">
        <div class="trade-head">
          <strong>${idea.symbol}</strong>
          <span class="${directionClass}">${idea.direction} · ${idea.action}</span>
        </div>
        <div class="trade-main">
          <b>${Math.round(idea.winProbability * 100)}%</b>
          <span>${idea.probabilityCalibration?.status === "ok" ? "校准胜率" : "估算胜率"}</span>
        </div>
        <dl>
          <div><dt>综合分</dt><dd>${idea.convictionScore ?? "--"}</dd></div>
          <div><dt>入场</dt><dd>${idea.entry}</dd></div>
          <div><dt>止盈</dt><dd>${idea.takeProfit}</dd></div>
          <div><dt>止损</dt><dd>${idea.stopLoss}</dd></div>
          <div><dt>R/R</dt><dd>${idea.riskReward}</dd></div>
          <div><dt>WF</dt><dd>${idea.walkForward?.status === "ok" ? `${idea.walkForward.testMetrics?.winRate ?? 0}%` : "--"}</dd></div>
          <div><dt>原始胜率</dt><dd>${idea.rawWinProbability ? `${Math.round(idea.rawWinProbability * 100)}%` : "--"}</dd></div>
          <div><dt>支撑</dt><dd>${idea.support}</dd></div>
          <div><dt>压力</dt><dd>${idea.resistance}</dd></div>
          <div><dt>RSI</dt><dd>${idea.indicators?.rsi ?? "--"}</dd></div>
          <div><dt>ATR</dt><dd>${idea.indicators?.atr ?? "--"}</dd></div>
        </dl>
      </article>
    `;
  }).join("");
}

function renderActiveMarkets() {
  const items = [
    ...(activeMarkets.crypto ?? []).map((item) => ({ ...item, group: "crypto" })),
    ...(activeMarkets.stocks ?? []).map((item) => ({ ...item, group: "stock" })),
    ...(activeMarkets.commodities ?? []).map((item) => ({ ...item, group: "macro" }))
  ];

  if (items.length === 0) {
    activeMarketList.innerHTML = `<p class="empty-inline">等待活跃市场数据...</p>`;
    return;
  }

  activeMarketList.innerHTML = items.slice(0, 18).map((item) => {
    const changeClass = item.changePercent >= 0 ? "positive" : "negative";
    return `
      <article class="active-card">
        <div>
          <strong>${item.symbol}</strong>
          <span>${item.group}</span>
        </div>
        <b>${formatCompact(item.quoteVolume ?? 0)}</b>
        <em class="${changeClass}">${item.changePercent.toFixed(2)}%</em>
      </article>
    `;
  }).join("");
}

function renderBestSignal() {
  if (!bestSignal) {
    bestSignalCard.innerHTML = `<p class="empty-inline">等待多因子模型评分...</p>`;
    bestSignalContext.textContent = "等待计算";
    return;
  }

  const policyText = strategyPolicy
    ? ` · 执行≥${strategyPolicy.minConviction} RR≥${strategyPolicy.minRiskReward}`
    : "";
  bestSignalContext.textContent = `${bestSignal.marketContext?.riskMode ?? "mixed"} · ${bestSignal.confidence}${policyText}`;

  if (bestSignal.direction === "WAIT") {
    bestSignalCard.innerHTML = `
      <article class="best-main wait">
        <div>
          <strong>WAIT</strong>
          <span>${bestSignal.summary}</span>
        </div>
      </article>
    `;
    return;
  }

  const directionClass = bestSignal.direction === "LONG" ? "positive" : "negative";
  bestSignalCard.innerHTML = `
    <article class="best-main">
      <div class="best-heading">
        <div>
          <strong>${bestSignal.symbol}</strong>
          <span class="${directionClass}">${bestSignal.direction} · ${bestSignal.action}</span>
        </div>
        <b>${bestSignal.convictionScore}</b>
      </div>
      <p>${bestSignal.summary}</p>
      <div class="best-levels">
        <div><span>入场</span><strong>${bestSignal.entry}</strong></div>
        <div><span>止盈</span><strong>${bestSignal.takeProfit}</strong></div>
        <div><span>止损</span><strong>${bestSignal.stopLoss}</strong></div>
        <div><span>胜率</span><strong>${Math.round(bestSignal.winProbability * 100)}%</strong></div>
        <div><span>支撑</span><strong>${bestSignal.support}</strong></div>
        <div><span>压力</span><strong>${bestSignal.resistance}</strong></div>
      </div>
      <div class="factor-list">
        ${(bestSignal.supporting ?? []).slice(0, 3).map((item) => `<span>${item}</span>`).join("")}
        ${bestSignal.walkForward?.status === "ok" ? `<span>Walk-forward ${bestSignal.walkForward.testMetrics?.winRate ?? 0}% · ${bestSignal.walkForward.supportDirection}</span>` : ""}
      </div>
    </article>
  `;
}

function renderPaperAccount() {
  if (!paperAccount) {
    paperAccountCard.innerHTML = `<p class="empty-inline">等待策略账户同步...</p>`;
    paperAccountContext.textContent = "等待同步";
    return;
  }

  const totalStats = paperAccount.stats?.total ?? {};
  const dayStats = paperAccount.stats?.periods?.day ?? {};
  const pnl = (paperAccount.equity ?? 0) - (paperAccount.initialBalance ?? 0);
  const pnlClass = pnl >= 0 ? "positive" : "negative";
  const updatedAt = paperAccount.updatedAt ? new Date(paperAccount.updatedAt).toLocaleTimeString() : "--";
  paperAccountContext.textContent = `${paperAccount.openPositionCount ?? 0} 仓位 · ${updatedAt}`;

  const openPositions = paperAccount.openPositions ?? [];
  const openHistory = paperAccount.recentOpenHistory ?? [];
  const lastRiskEvent = paperAccount.recentRiskEvents?.[0];
  const positionHtml = openPositions.length === 0
    ? `<p class="paper-empty">当前无模拟持仓</p>`
    : openPositions.slice(0, 4).map((position) => {
        const directionClass = position.direction === "LONG" ? "positive" : "negative";
        return `
          <article class="paper-position">
            <div>
              <strong>${position.symbol}</strong>
              <span class="${directionClass}">${position.direction}</span>
            </div>
            <dl>
              <div><dt>入场</dt><dd>${position.entryPrice}</dd></div>
              <div><dt>风险</dt><dd>${formatMoney(position.riskAmount)}</dd></div>
              <div><dt>现价</dt><dd>${position.currentPrice}</dd></div>
              <div><dt>浮盈亏</dt><dd class="${(position.unrealizedPnl ?? 0) >= 0 ? "positive" : "negative"}">${formatMoney(position.unrealizedPnl)}</dd></div>
              <div><dt>RR</dt><dd>${position.riskReward}</dd></div>
            </dl>
          </article>
        `;
      }).join("");
  const historyHtml = openHistory.length === 0
    ? `<p class="paper-empty">暂无开仓历史</p>`
    : openHistory.slice(0, 8).map((entry) => {
        const directionClass = entry.direction === "LONG" ? "positive" : "negative";
        const statusClass = entry.status === "OPEN" ? "positive" : (entry.netPnl ?? 0) >= 0 ? "positive" : "negative";
        const openedAt = entry.openedAt ? new Date(entry.openedAt).toLocaleString() : "--";
        const result = entry.status === "CLOSED"
          ? `${entry.closeReason ?? "CLOSED"} · ${formatMoney(entry.netPnl)}`
          : `持仓中 · 风险 ${formatMoney(entry.riskAmount)}`;

        return `
          <article class="paper-history-row">
            <div>
              <strong>${entry.symbol}</strong>
              <span class="${directionClass}">${entry.direction}</span>
            </div>
            <div>
              <span>${openedAt}</span>
              <b class="${statusClass}">${result}</b>
            </div>
            <dl>
              <div><dt>入场</dt><dd>${entry.entryPrice}</dd></div>
              <div><dt>止盈</dt><dd>${entry.takeProfit}</dd></div>
              <div><dt>止损</dt><dd>${entry.stopLoss}</dd></div>
              <div><dt>分数</dt><dd>${entry.convictionScore ?? "--"}</dd></div>
            </dl>
          </article>
        `;
      }).join("");

  paperAccountCard.innerHTML = `
    <article class="paper-main">
      <div class="paper-summary">
        <div>
          <span>权益</span>
          <strong>${formatMoney(paperAccount.equity)}</strong>
        </div>
        <div>
          <span>累计盈亏</span>
          <strong class="${pnlClass}">${formatMoney(pnl)}</strong>
        </div>
        <div>
          <span>累计胜率</span>
          <strong>${totalStats.winRate ?? 0}%</strong>
        </div>
        <div>
          <span>最大回撤</span>
          <strong>${paperAccount.maxDrawdownPercent ?? 0}%</strong>
        </div>
        <div>
          <span>日累计</span>
          <strong>${dayStats.wins ?? 0}/${dayStats.trades ?? 0}</strong>
        </div>
        <div>
          <span>总交易</span>
          <strong>${totalStats.trades ?? 0}</strong>
        </div>
        <div>
          <span>风险上限</span>
          <strong>${Math.round((paperAccount.config?.positionRisk?.maxRiskPerTrade ?? 0) * 10000) / 100}%</strong>
        </div>
        <div>
          <span>连亏</span>
          <strong>${lastRiskEvent?.consecutiveLosses ?? 0}</strong>
        </div>
      </div>
      ${lastRiskEvent ? `<p class="risk-note">最近风控: ${lastRiskEvent.skippedSymbol ?? lastRiskEvent.symbol} · ${lastRiskEvent.summary}</p>` : ""}
      <div class="paper-positions">
        ${positionHtml}
      </div>
      <div class="paper-history">
        <div class="paper-subtitle">
          <h3>开仓历史</h3>
          <span>最近 ${Math.min(openHistory.length, 8)} / ${paperAccount.openHistoryCount ?? openHistory.length}</span>
        </div>
        <div class="paper-history-list">
          ${historyHtml}
        </div>
      </div>
    </article>
  `;
}

function bucketLine(bucket, tone = "") {
  const samples = (bucket.reviewed ?? 0) + (bucket.paperTrades ?? 0);
  const paperPnl = bucket.paperTrades > 0 ? ` · PnL ${formatMoney(bucket.netPnl)}` : "";
  const score = Math.round((bucket.score ?? 0.5) * 100);

  return `
    <article class="attribution-item ${tone}">
      <div>
        <strong>${bucket.label ?? bucket.key}</strong>
        <span>样本 ${samples} · 评分 ${score}%${paperPnl}</span>
      </div>
      <b>${bucket.successRate ?? 0}%</b>
    </article>
  `;
}

function renderAttribution() {
  const total = performanceAttribution?.total;
  if (!total) {
    attributionCard.innerHTML = `<p class="empty-inline">等待历史复盘和模拟成交...</p>`;
    attributionContext.textContent = "等待归因";
    return;
  }

  const samples = (total.reviewed ?? 0) + (total.paperTrades ?? 0);
  attributionContext.textContent = `样本 ${samples} · 总分 ${Math.round((total.score ?? 0.5) * 100)}%`;
  const strengths = performanceAttribution.strengths ?? [];
  const weaknesses = performanceAttribution.weaknesses ?? [];
  const recommendations = performanceAttribution.recommendations ?? [];

  attributionCard.innerHTML = `
    <article class="attribution-main">
      <div class="attribution-summary">
        <div>
          <span>复盘胜率</span>
          <strong>${total.successRate ?? 0}%</strong>
        </div>
        <div>
          <span>模拟胜率</span>
          <strong>${total.paperWinRate ?? 0}%</strong>
        </div>
        <div>
          <span>模拟PnL</span>
          <strong class="${(total.netPnl ?? 0) >= 0 ? "positive" : "negative"}">${formatMoney(total.netPnl)}</strong>
        </div>
        <div>
          <span>已复盘</span>
          <strong>${total.reviewed ?? 0}</strong>
        </div>
      </div>
      <div class="attribution-columns">
        <div>
          <h3>强项</h3>
          ${strengths.length ? strengths.slice(0, 3).map((bucket) => bucketLine(bucket, "positive-tint")).join("") : `<p class="paper-empty">强项样本不足</p>`}
        </div>
        <div>
          <h3>弱项</h3>
          ${weaknesses.length ? weaknesses.slice(0, 3).map((bucket) => bucketLine(bucket, "negative-tint")).join("") : `<p class="paper-empty">暂未识别明显弱项</p>`}
        </div>
      </div>
      <div class="attribution-notes">
        ${recommendations.slice(0, 3).map((item) => `<span>${item}</span>`).join("")}
      </div>
    </article>
  `;
}

function calibrationBucketLine(bucket) {
  const tone = bucket.realizedRate >= bucket.predictedAvg ? "positive-tint" : "negative-tint";
  return `
    <article class="attribution-item ${tone}">
      <div>
        <strong>${bucket.key}%</strong>
        <span>样本 ${bucket.samples} · 预测 ${bucket.predictedAvg}% · 真实 ${bucket.realizedRate}%</span>
      </div>
      <b>${bucket.calibrationError}%</b>
    </article>
  `;
}

function renderProbabilityCalibration() {
  const overall = probabilityCalibration?.overall;
  if (!overall) {
    calibrationCard.innerHTML = `<p class="empty-inline">等待分桶复盘样本...</p>`;
    calibrationContext.textContent = "等待校准";
    return;
  }

  calibrationContext.textContent = `${probabilityCalibration.status} · 样本 ${overall.samples}`;
  const buckets = probabilityCalibration.buckets ?? [];
  calibrationCard.innerHTML = `
    <article class="attribution-main">
      <div class="attribution-summary">
        <div>
          <span>真实胜率</span>
          <strong>${overall.realizedRate}%</strong>
        </div>
        <div>
          <span>平均预测</span>
          <strong>${overall.predictedAvg}%</strong>
        </div>
        <div>
          <span>校准误差</span>
          <strong>${overall.expectedCalibrationError}%</strong>
        </div>
        <div>
          <span>Brier</span>
          <strong>${overall.brierScore}</strong>
        </div>
      </div>
      <div class="attribution-columns">
        <div>
          <h3>概率分桶</h3>
          ${buckets.length ? buckets.slice(-4).map(calibrationBucketLine).join("") : `<p class="paper-empty">分桶样本不足</p>`}
        </div>
        <div>
          <h3>方向校准</h3>
          ${["long", "short"].map((key) => {
            const stats = probabilityCalibration.directions?.[key] ?? {};
            return `
              <article class="attribution-item">
                <div>
                  <strong>${key.toUpperCase()}</strong>
                  <span>样本 ${stats.samples ?? 0} · 成 ${stats.successes ?? 0} · 败 ${stats.failures ?? 0}</span>
                </div>
                <b>${stats.realizedRate ?? 0}%</b>
              </article>
            `;
          }).join("")}
        </div>
      </div>
    </article>
  `;
}

function applyPayload(payload) {
  tickers = payload.tickers;
  stocks = payload.stocks ?? [];
  commodities = payload.commodities ?? [];
  signals = payload.signals ?? [];
  tradeIdeas = payload.tradeIdeas ?? [];
  bestSignal = payload.bestSignal ?? null;
  activeMarkets = payload.activeMarkets ?? { crypto: [], stocks: [], commodities: [] };
  paperAccount = payload.paperAccount ?? null;
  strategyPolicy = payload.strategyPolicy ?? null;
  performanceAttribution = payload.performanceAttribution ?? null;
  probabilityCalibration = payload.probabilityCalibration ?? null;
  cryptoCount.textContent = String(payload.counts?.crypto ?? tickers.length);
  stockCount.textContent = String(payload.counts?.stocks ?? stocks.length);
  commodityCount.textContent = String(payload.counts?.commodities ?? commodities.length);
  signalCount.textContent = String(signals.length);
  lastUpdate.textContent = new Date(payload.generatedAt).toLocaleTimeString();
  statusWrap.dataset.status = payload.status;
  connectionStatus.textContent = statusLabel(payload.status);
  binanceStatus.textContent = `Binance ${statusLabel(payload.providers?.binance ?? payload.status)}`;
  stooqStatus.textContent = `Stooq ${statusLabel(payload.providers?.stooq ?? "connecting")}`;
  renderCards(stockCards, stocks);
  renderCards(commodityCards, commodities);
  renderSignals();
  renderBestSignal();
  renderPaperAccount();
  renderAttribution();
  renderProbabilityCalibration();
  renderTradeIdeas();
  renderActiveMarkets();
  render();
}

function connectEvents() {
  const events = new EventSource("/api/tickers/events");

  events.addEventListener("tickers", (event) => {
    applyPayload(JSON.parse(event.data));
  });

  events.onerror = () => {
    statusWrap.dataset.status = "reconnecting";
    connectionStatus.textContent = "重连中";
  };
}

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);
connectEvents();
