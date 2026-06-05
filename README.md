# Market Trend Monitor

本项目是一个本地/服务器可运行的市场趋势监控系统，用于监控 crypto、Binance 合约、Hyperliquid USDC Perps、美股/ETF、黄金、白银、原油等活跃标的，并把交易计划推送到 Telegram Topic 或 Lark。

> 免责声明：本项目只做行情分析、策略研究和信号提醒，不是投资建议，也不保证收益。实盘交易请自行控制风险。

## 功能

- 多数据源：Binance Futures、Hyperliquid、Stooq、Finnhub、Yahoo Finance，TradingView adapter 预留。
- Telegram Topic 路由：每个标的可以推送到对应 Topic。
- 完整交易计划：方向、动作、入场、止盈、止损、胜率估算、风险收益比、支撑压力、执行条件。
- 策略因子：技术面、新闻面、资金流向、长期趋势、历史复盘、交易员检查、模型大脑。
- 开源模型大脑：Qlib-compatible、LightGBM-compatible、vectorbt-compatible、FinRL-compatible、Python Open Quant Brain。
- 美股交易时段感知：盘中、盘前、盘后、非交易时段、周末使用不同推送/扫描频率。
- 本地 Dashboard：打开 `http://localhost:8787` 查看行情、策略和最高信号。

## 快速开始

### macOS

```bash
git clone https://github.com/YOUR_NAME/market-trend-monitor.git
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
git clone https://github.com/YOUR_NAME/market-trend-monitor.git
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

不要提交 `.env.local`。真实 token、API key、群 ID 都应该只保存在部署机器上。

## 开源发布安全

提交 GitHub 前确认：

- `.env.local` 不在 git 里。
- `data/signal-history.jsonl` 不提交。
- `.venv/`、`node_modules/`、`__pycache__/` 不提交。
- 真实 Telegram token、群链接、API key 不写入 README 或 issue。

## License

MIT
