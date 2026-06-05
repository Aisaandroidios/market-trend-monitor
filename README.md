# Market Trend Monitor

本项目是一个本地/服务器可运行的市场趋势监控系统，用于监控 crypto、Binance 合约、Hyperliquid USDC Perps、美股/ETF、黄金、白银、原油等活跃标的，并把交易计划推送到 Telegram Topic 或 Lark。

> 免责声明：本项目只做行情分析、策略研究和信号提醒，不是投资建议，也不保证收益。实盘交易请自行控制风险。

## 功能

- 多数据源：Binance Futures、Hyperliquid、Stooq、Finnhub、Yahoo Finance，TradingView adapter 预留。
- Telegram Topic 路由：每个标的可以推送到对应 Topic。
- 完整交易计划：方向、动作、入场、止盈、止损、胜率估算、风险收益比、支撑压力、执行条件。
- 策略因子：技术面、新闻面、资金流向、长期趋势、历史复盘、交易员检查、模型大脑。
- 开源模型大脑：Qlib-compatible、LightGBM-compatible、vectorbt-compatible、FinRL-compatible、Python Open Quant Brain。
- 模拟实盘账户：用虚拟余额跟随信号开/平仓，记录权益、盈亏、回撤、日/周/月/年胜率，不会真实下单。
- 策略归因：按标的、方向、市场状态、长期趋势、模型信心和模拟成交盈亏识别强项/弱项，并回流到历史反馈分。
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
```

获取 Topic ID：

```bash
TELEGRAM_BOT_TOKEN=your-token node scripts/telegram-topics.js
```

在群里的每个 Topic 发一条消息，然后脚本会输出 `chat_id` 和 `message_thread_id`。

## API

- `GET /api/health`：数据源、调度、Python 模型大脑状态。
- `GET /api/tickers`：行情快照。
- `GET /api/trade-ideas`：全部交易计划。
- `GET /api/best-signal`：当前最高置信方向。
- `GET /api/signals`：最近趋势信号。
- `GET /api/paper-account`：模拟实盘账户、持仓和绩效统计。
- `GET /api/performance-attribution`：策略归因、强项/弱项和自动调参建议。

## 配置

完整配置看 [.env.example](.env.example)。核心变量：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_TOPIC_MAP`
- `ALPHA_VANTAGE_API_KEY`
- `FINNHUB_API_KEY`
- `PYTHON_MODEL_BRAIN_ENABLED`
- `YAHOO_DATA_ENABLED`
- `OPPORTUNITY_SCAN_ENABLED`
- `PAPER_TRADING_ENABLED`
- `PAPER_INITIAL_BALANCE`
- `NOTIFICATION_SEND_ENABLED`
- `DATA_STORE`
- `SQLITE_DB_PATH`

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

## 模拟实盘账户

模拟账户只用于验证系统信号表现，不连接真实交易所账号，也不会发真实订单。默认配置使用虚拟本金 10000，每笔风险 2%，最多 6 个模拟持仓：

```env
PAPER_TRADING_ENABLED=true
PAPER_INITIAL_BALANCE=10000
PAPER_RISK_PER_TRADE=0.02
PAPER_MAX_OPEN_POSITIONS=6
PAPER_FEE_RATE=0
PAPER_SLIPPAGE_BPS=0
```

系统会在每轮信号计算后，用当前入场、止盈、止损更新虚拟持仓。命中止盈/止损或出现同标的反向高置信信号时，模拟账户会平仓并记录盈亏。Telegram 的完整策略消息和 `/signal`、`/best` 主动查询会带上模拟余额、权益、累计胜率和当前持仓。

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
