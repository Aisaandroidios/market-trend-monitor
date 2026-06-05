# Market Trend Monitor

本项目是一个本地/服务器可运行的市场趋势监控系统，用于监控 crypto、Binance 合约、Hyperliquid USDC Perps、美股/ETF、黄金、白银、原油等活跃标的，并把交易计划推送到 Telegram Topic 或 Lark。

> 免责声明：本项目只做行情分析、策略研究和信号提醒，不是投资建议，也不保证收益。实盘交易请自行控制风险。

## 功能

- 多数据源：Binance Futures、Hyperliquid、Stooq、Yahoo Finance、Alpha Vantage、Finnhub、Twelve Data、Alpaca Market Data，TradingView adapter 预留。
- Telegram Topic 路由：每个标的可以推送到对应 Topic。
- 完整交易计划：方向、动作、入场、止盈、止损、胜率估算、风险收益比、支撑压力、执行条件。
- 策略因子：技术面、新闻面、资金流向、长期趋势、历史复盘、交易员检查、模型大脑。
- 开源模型大脑：Qlib-compatible、LightGBM-compatible、vectorbt-compatible、FinRL-compatible、Python Open Quant Brain。
- 模拟实盘账户：用虚拟余额跟随信号开/平仓，记录权益、盈亏、回撤、日/周/月/年胜率，不会真实下单。
- 策略归因：按标的、方向、市场状态、长期趋势、模型信心和模拟成交盈亏识别强项/弱项，并回流到历史反馈分。
- Walk-forward 验证：用过去窗口选参数，再在未来窗口验证，避免一次性回测过拟合。
- 胜率校准：按预测概率分桶复盘真实胜率，自动下调过度乐观的概率。
- 仓位引擎：单笔风险上限、日/周亏损闸门、连续亏损降仓、同类资产风险限额、波动/低流动性降仓，极端低流动性才拦截。
- 衍生品/盘口因子：open interest、全市场多空比、mark/index 基差、盘口失衡。
- 事件风险和模型治理：宏观/监管/财报/黑天鹅事件降权，最近 20/50/100 条表现漂移监控。
- 美股交易时段感知：盘中、盘前、盘后、非交易时段、周末使用不同推送/扫描频率。
- 本地 Dashboard：打开 `http://localhost:8787` 查看行情、策略和最高信号。

## 快速开始

### macOS

```bash
git clone https://github.com/Aisaandroidios/market-trend-monitor.git
cd market-trend-monitor
chmod +x scripts/install-macos.sh
./scripts/install-macos.sh
```

编辑 `.env.local`，填入 Telegram bot token、群 ID、Topic 映射和可选新闻 API key。修改后重启：

```bash
launchctl kickstart -k gui/$(id -u)/com.market-trend-monitor
```

### Windows PowerShell

先安装 Node.js 22+ 和 Python 3.11+，然后：

```powershell
git clone https://github.com/Aisaandroidios/market-trend-monitor.git
cd market-trend-monitor
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

编辑 `.env.local` 后重启计划任务：

```powershell
Stop-ScheduledTask -TaskName MarketTrendMonitor
Start-ScheduledTask -TaskName MarketTrendMonitor
```

### 手动运行

```bash
cp .env.example .env.local
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm start
```

Windows 手动运行时使用：

```powershell
Copy-Item .env.example .env.local
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm start
```

## Telegram Topic 配置

`.env.local` 示例：

```env
TELEGRAM_BOT_TOKEN=replace-with-token
TELEGRAM_CHAT_ID=-100xxxxxxxxxx
TELEGRAM_TOPIC_MAP={"BTCUSDT":123,"ETHUSDT":124,"QQQUSDT":125,"MCDUSDT":126}
PAPER_ACCOUNT_TOPIC_ID=2597
PAPER_DAILY_SUMMARY_ENABLED=true
PAPER_DAILY_SUMMARY_TIME=08:30
STRATEGY_ATTRIBUTION_TOPIC_ID=2679
PROBABILITY_CALIBRATION_TOPIC_ID=2683
```

获取 Topic ID：

```bash
TELEGRAM_BOT_TOKEN=your-token node scripts/telegram-topics.js
```

在群里的每个 Topic 发一条消息，然后脚本会输出 `chat_id` 和 `message_thread_id`。

`PAPER_ACCOUNT_TOPIC_ID` 用于集中接收模拟账户、仓位、开仓历史和风控拦截信息。交易信号推送不会再附带仓位数据，避免每个标的 Topic 里消息过长。仓位 Topic 只在开仓、平仓或持仓结构变化时推送；也可以在群里发送 `/positions`、`/position`、`/account`、`/仓位`、`/持仓` 或 `/账户` 主动查看。

`PAPER_DAILY_SUMMARY_ENABLED=true` 会每天按北京时间 `PAPER_DAILY_SUMMARY_TIME` 自动把每日交易结果总结发到仓位 Topic。日报会按北京时间当天平仓单重新计算已实现盈亏、今日多单/空单胜率、当前持仓、风控拦截和下一交易日关注；也可以发送 `/daily`、`/summary`、`/日报` 或 `/每日总结` 主动查看。

`STRATEGY_ATTRIBUTION_TOPIC_ID` 用于集中接收策略归因数据。系统只在归因结果变化时推送；也可以发送 `/attribution`、`/performance` 或 `/归因` 主动查看。

`PROBABILITY_CALIBRATION_TOPIC_ID` 用于集中接收胜率校准数据。系统只在分桶真实胜率、校准误差、方向/标的校准结果变化时推送；也可以发送 `/calibration`、`/winrate`、`/胜率` 或 `/校准` 主动查看。

## API

- `GET /api/health`：数据源、调度、Python 模型大脑状态。
- `GET /api/tickers`：行情快照。
- `GET /api/trade-ideas`：全部交易计划。
- `GET /api/best-signal`：当前最高置信方向。
- `GET /api/signals`：最近趋势信号。
- `GET /api/paper-account`：模拟实盘账户、持仓和绩效统计。
- `GET /api/performance-attribution`：策略归因、强项/弱项和自动调参建议。
- `GET /api/probability-calibration`：预测胜率分桶、真实胜率、校准误差和 Brier 分数。
- `GET /api/model-governance`：最近 20/50/100 条表现、置信虚高、数据源异常和模型降权状态。
- `GET /api/health` 里的 `referenceData`：当前参考 K 线 provider 顺序和已配置状态。

## 配置

完整配置看 [.env.example](.env.example)。核心变量：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_TOPIC_MAP`
- `ALPHA_VANTAGE_API_KEY`
- `FINNHUB_API_KEY`
- `TWELVE_DATA_API_KEY`
- `ALPACA_API_KEY_ID`
- `ALPACA_API_SECRET_KEY`
- `REFERENCE_DATA_PROVIDERS`
- `PYTHON_MODEL_BRAIN_ENABLED`
- `YAHOO_DATA_ENABLED`
- `OPPORTUNITY_SCAN_ENABLED`
- `PAPER_TRADING_ENABLED`
- `PAPER_INITIAL_BALANCE`
- `WALK_FORWARD_ENABLED`
- `PROBABILITY_CALIBRATION_BUCKET_SIZE`
- `DERIVATIVES_DATA_ENABLED`
- `EVENT_RISK_ENABLED`
- `NOTIFICATION_SEND_ENABLED`
- `DATA_STORE`
- `SQLITE_DB_PATH`

固定完整推送使用 `US_MARKET_*_DECISION_INTERVAL_MS`，并按对应间隔对齐到纽约时间的整点网格，例如 5:00、5:30、5:45。机会/反转扫描由 `OPPORTUNITY_SCAN_*_INTERVAL_MS` 控制，默认是对应固定推送间隔的 1/4；扫描发现市场反转或新的高质量机会时，会独立触发机会提醒，不需要等下一次固定完整推送。

## 数据存储

默认 `DATA_STORE=auto`，系统会优先使用 Node 自带 `node:sqlite` 保存信号历史、模拟账户状态和模拟平仓记录；如果当前 Node 版本不支持 SQLite，会自动回退到 JSON/JSONL 文件。

```env
DATA_STORE=auto
SQLITE_DB_PATH=data/market-monitor.sqlite
```

可选模式：

- `DATA_STORE=auto`：优先 SQLite，失败回退文件。
- `DATA_STORE=sqlite`：优先使用本地 SQLite 数据库。
- `DATA_STORE=file`：只用 `data/*.jsonl` 和 `data/paper-account.json`。

第一次启用 SQLite 时，如果本地已有 `data/signal-history.jsonl`、`data/paper-account.json` 或 `data/paper-trades.jsonl`，系统会自动导入到 SQLite。`/api/health` 会显示当前存储模式和数据库路径。

## 免费参考数据源

当某个 Topic 没有可用 Binance/Hyperliquid 合约 K 线时，系统会按 `REFERENCE_DATA_PROVIDERS` 的顺序拉取美股、ETF、黄金、白银、原油参考 K 线。任意 provider 失败、限流或未配置 key 都会自动跳过，继续尝试下一个：

```env
REFERENCE_DATA_PROVIDERS=tradingview,yahoo,alpha_vantage,twelve_data,alpaca,finnhub
REFERENCE_DATA_TIMEOUT_MS=7000
YAHOO_DATA_ENABLED=true
TRADINGVIEW_DATA_ENABLED=false
ALPHA_VANTAGE_API_KEY=your-free-key
FINNHUB_API_KEY=your-free-key
TWELVE_DATA_API_KEY=optional-free-key
ALPACA_API_KEY_ID=optional-paper-or-broker-key
ALPACA_API_SECRET_KEY=optional-secret
ALPACA_DATA_FEED=iex
```

默认推荐顺序：

- `tradingview`：需要本地安装 `tvDatafeed`，适合你已经在本机维护 TradingView adapter 的情况；默认关闭，避免依赖不稳定。
- `yahoo`：通过 `yfinance` 免费拉取股票、ETF、期货连续合约参考 K 线，适合作为主 fallback。
- `alpha_vantage`：免费 key 可拉美股/ETF intraday/daily；有频率限制。
- `twelve_data`：免费 key 可作为股票/ETF/部分外汇/金属补充。
- `alpaca`：著名券商/数据平台，填入 Alpaca paper/broker market data key 后可拉 IEX feed 股票 bars。
- `finnhub`：保留为可配置补充源；不同账号权限可能限制 stock candle，失败时会自动 fallback。

推送里的“数据/报价”会显示实际命中的 provider、交易所/平台和 quote symbol，方便你知道这条策略到底参考了谁的数据。

## 模拟实盘账户

模拟账户只用于验证系统信号表现，不连接真实交易所账号，也不会发真实订单。默认配置使用虚拟本金 10000，最多 6 个模拟持仓。基础风险参数仍可设为 2%，但仓位引擎会把有效单笔风险按专业风控默认限制在 0.25%-1%：

```env
PAPER_TRADING_ENABLED=true
PAPER_INITIAL_BALANCE=10000
PAPER_RISK_PER_TRADE=0.02
PAPER_MAX_OPEN_POSITIONS=6
PAPER_REQUIRE_DATA_SOURCE=true
PAPER_FEE_RATE=0
PAPER_SLIPPAGE_BPS=0
PAPER_POSITION_RISK_ENABLED=true
PAPER_MIN_RISK_PER_TRADE=0.0025
PAPER_MAX_RISK_PER_TRADE=0.01
PAPER_DAILY_MAX_LOSS_PCT=0.03
PAPER_WEEKLY_MAX_LOSS_PCT=0.07
PAPER_MAX_CONSECUTIVE_LOSSES=4
```

系统会在每轮信号计算后，用当前入场、止盈、止损更新虚拟持仓。命中止盈/止损或出现同标的反向高置信信号时，模拟账户会平仓并记录盈亏。新开仓前会检查日/周亏损、连续亏损、同类资产风险、ATR/价格、成交量倍率和风险收益比；不合格的单会被记录为 `recentRiskEvents`。按当前需求，手续费、滑点和资金费率不参与模拟记账。

小资金账户的流动性规则采用“软降仓”为主：`PAPER_MIN_QUOTE_VOLUME_24H` 和 `PAPER_LOW_VOLUME_RATIO` 低于阈值时会明显降低风险预算，不会直接禁止开仓。只有绝对成交额低于 `PAPER_HARD_MIN_QUOTE_VOLUME_24H` 的极端低流动性场景才会硬拦截；`PAPER_HARD_LOW_VOLUME_RATIO` 这类相对量能异常只用于进一步压低仓位。

默认 `PAPER_REQUIRE_DATA_SOURCE=true`，模拟账户只跟随带有明确行情来源的策略开仓，避免本地 smoke 或手工脚本把无来源测试价格写进真实模拟账户。

胜率、胜率校准、策略归因和模型治理只把触发计划止盈 `TAKE_PROFIT` 的信号计为成功，只把触发计划止损 `STOP_LOSS` 的信号计为失败。未触达止盈/止损的浮盈浮亏不进入胜率分母，只显示为观察中，避免把短期价格波动误当成策略胜负。

## 动态策略标准

系统不会固定死用某一个综合分或风险收益比阈值。每轮信号计算后，会根据本轮全部标的的评分分布、ATR/价格、成交量倍率和市场环境生成动态标准：

- `minConviction`：本轮最低可执行综合分。
- `minRiskReward`：本轮最低风险收益比。
- `confidenceThresholds`：本轮 MEDIUM / HIGH 置信度分界线。
- `minPlaybookScore`：交易员检查最低执行质量。

最高置信方向只会从可执行 `BUY` / `SELL` 里选；`WAIT` 标的也会有真实综合分，但只作为观察方向，不当成开单信号。模拟账户默认跟随动态标准；需要固定阈值时可设置：

```env
PAPER_ADAPTIVE_THRESHOLDS=false
```

## 策略归因闭环

系统会把每次推送后的复盘结果和模拟账户平仓结果做分组归因：

- 标的和方向：例如 `ETHUSDT:SHORT` 是否长期比 `ETHUSDT:LONG` 更有效。
- 市场状态：risk-on、risk-off、mixed 环境下哪些信号更可靠。
- 长期趋势：对应合约自己的牛熊/过渡结构，不用 BTC 代替所有标的。
- 模型信心：开源量化大脑高/中/低信心下的历史表现。
- 模拟成交：用虚拟账户的净盈亏补充单纯“止盈/止损复盘”的不足。

归因结果会显示在 Dashboard 的“策略归因”面板，也会通过 `/api/performance-attribution` 输出。样本足够时，强项会适度加权，弱项会自动降权，避免一直按固定参数推送。

## Walk-forward 回测

系统不会用单次全历史回测来证明策略有效。每个有足够 K 线的标的会做滚动验证：

- 训练窗口：只用过去 K 线选择 EMA/RSI/ATR 风控参数。
- 测试窗口：只在之后的 K 线上验证，不把未来数据带回训练。
- 入场规则：信号在当前 K 线收盘后确认，下一根 K 线开盘入场，降低 look-ahead bias。
- 输出指标：测试胜率、期望 R、利润因子、最大回撤 R、正收益窗口比例、支持方向。
- 风险提示：样本不足、训练为正但测试为负、测试回撤偏高、窗口数量太少。

默认配置：

```env
WALK_FORWARD_ENABLED=true
WALK_FORWARD_TRAIN_WINDOW=84
WALK_FORWARD_TEST_WINDOW=24
WALK_FORWARD_STEP_WINDOW=24
```

Walk-forward 结果会作为综合分里的独立因子，也会出现在 Telegram 完整策略消息和 Dashboard 的方向单卡片里。注意：当前实现针对正在监控的标的池做验证，不等同于完整历史成分股池回测，所以 survivorship bias 会在结果里作为模型治理风险保留。

## 胜率校准

`winProbability` 不是固定相信模型估算。系统会从信号历史里还原每条已复盘信号当时的预测胜率，并按概率分桶比较真实胜率：

- `60-65` 分桶：系统当时说 60%-65% 的信号，后续真实胜率是多少。
- `65-70` 分桶：如果真实胜率只有 50%，新信号会被自动下调。
- 样本不足时不调整，避免小样本噪声误导。
- 输出 `expectedCalibrationError` 和 `brierScore`，用于后续模型治理和漂移监控。

默认配置：

```env
PROBABILITY_CALIBRATION_BUCKET_SIZE=5
PROBABILITY_CALIBRATION_MIN_BUCKET_SAMPLES=4
PROBABILITY_CALIBRATION_MIN_TOTAL_SAMPLES=6
```

校准结果会写回每条交易计划：保留 `rawWinProbability`，同时把 `winProbability` 替换成校准后的概率。Telegram 完整消息会显示原始胜率、校准后胜率、分桶样本和真实胜率。

## 衍生品/盘口因子

系统会优先从 Binance USD-M Futures 读取衍生品数据作为信号因子：

- `openInterest`
- `globalLongShortAccountRatio`
- `markPrice / indexPrice` 基差
- order book imbalance

这些数据只用于判断合约拥挤度和盘口方向，不做资金费率扣费：

```env
DERIVATIVES_DATA_ENABLED=true
DERIVATIVES_DATA_LIMIT=20
DERIVATIVES_DATA_CONCURRENCY=4
```

## 事件风险

事件风险不是简单新闻加减分。高风险事件会把信号降权，严重时把动作改成 `WAIT`：

- FOMC / CPI / 非农 / PCE
- SEC / ETF / 监管新闻
- 财报和业绩指引
- 代币解锁、大额链上转账、安全事件
- 黑天鹅关键词

也可以用免费配置手动加事件窗口：

```env
EVENT_RISK_ENABLED=true
EVENT_RISK_WINDOWS_JSON=[{"name":"FOMC","start":"2026-06-10T17:30:00Z","end":"2026-06-10T19:30:00Z","symbols":["ALL"],"severity":"HIGH","action":"REDUCE"}]
```

## 模型治理和漂移监控

系统会持续监控模型是否失效：

- 最近 20 / 50 / 100 条复盘胜率。
- 高置信信号是否真实胜率偏低。
- 概率校准误差和 Brier 分数。
- 数据源是否连接异常。

当状态变成 `watch` 或 `degraded` 时，模型大脑分会自动降权，并在 Telegram 完整消息里显示“模型治理”区块。

## 机会扫描推送

系统不是只等固定时间。除了完整定时推送，还会按美股交易时段做低成本机会扫描：

- 市场/大盘信号反转。
- 新高置信机会。
- 综合分突然提升。
- 置信度升级。
- Walk-forward、胜率校准、衍生品/盘口和交易员检查同时共振。

默认扫描频率和定时信号一致：

- 美股盘中：15 分钟。
- 临近开盘盘前 07:00-09:30 ET：30 分钟。
- 普通盘前 04:00-07:00 ET：60 分钟。
- 盘后：60 分钟。
- 非交易时段：240 分钟。
- 周末：240 分钟。

这些触发会走对应 Telegram Topic，避免错过盘中突然出现的高质量策略。

升级或本地验证时如果不想往 Telegram/Lark 发消息，可以临时设置：

```env
NOTIFICATION_SEND_ENABLED=false
```

不要提交 `.env.local`。真实 token、API key、群 ID 都应该只保存在部署机器上。

## 开源发布安全

提交 GitHub 前确认：

- `.env.local` 不在 git 里。
- `data/signal-history.jsonl` 不提交。
- `data/paper-account.json` 和 `data/paper-trades.jsonl` 不提交。
- `data/*.sqlite` 和 `data/*.db` 不提交。
- `.venv/`、`node_modules/`、`__pycache__/` 不提交。
- 真实 Telegram token、群链接、API key 不写入 README 或 issue。

## License

MIT
