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

let tickers = [];
let stocks = [];
let commodities = [];
let signals = [];
let tradeIdeas = [];
let bestSignal = null;
let activeMarkets = { crypto: [], stocks: [], commodities: [] };

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
          <span>估算胜率</span>
        </div>
        <dl>
          <div><dt>入场</dt><dd>${idea.entry}</dd></div>
          <div><dt>止盈</dt><dd>${idea.takeProfit}</dd></div>
          <div><dt>止损</dt><dd>${idea.stopLoss}</dd></div>
          <div><dt>R/R</dt><dd>${idea.riskReward}</dd></div>
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

  bestSignalContext.textContent = `${bestSignal.marketContext?.riskMode ?? "mixed"} · ${bestSignal.confidence}`;

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
