# Deployment Guide

这个文档用于把 Market Trend Monitor 部署到新电脑、服务器、macOS、Windows 或 Linux。

## 1. 基础要求

- Node.js 22+
- Python 3.11+
- Git
- 网络可以访问 Binance、Hyperliquid、Yahoo Finance、Stooq、Telegram API

## 2. 环境变量

复制示例文件：

```bash
cp .env.example .env.local
```

Windows：

```powershell
Copy-Item .env.example .env.local
```

必须配置：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_TOPIC_MAP`

可选配置：

- `ALPHA_VANTAGE_API_KEY`
- `FINNHUB_API_KEY`
- `LARK_WEBHOOK_URL`

## 3. macOS 常驻部署

```bash
chmod +x scripts/install-macos.sh
./scripts/install-macos.sh
```

查看状态：

```bash
launchctl print gui/$(id -u)/com.market-trend-monitor
curl http://localhost:8787/api/health
```

重启：

```bash
launchctl kickstart -k gui/$(id -u)/com.market-trend-monitor
```

停止：

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.market-trend-monitor.plist
```

日志：

```bash
tail -f /tmp/market-trend-monitor.log
tail -f /tmp/market-trend-monitor.err.log
```

## 4. Windows 常驻部署

用管理员或普通 PowerShell 执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

查看任务：

```powershell
Get-ScheduledTask -TaskName MarketTrendMonitor
```

重启：

```powershell
Stop-ScheduledTask -TaskName MarketTrendMonitor
Start-ScheduledTask -TaskName MarketTrendMonitor
```

检查服务：

```powershell
Invoke-RestMethod http://localhost:8787/api/health
```

## 5. Linux 服务器部署

```bash
git clone https://github.com/Aisaandroidios/market-trend-monitor.git
cd market-trend-monitor
cp .env.example .env.local
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm start
```

systemd 示例：

```ini
[Unit]
Description=Market Trend Monitor
After=network-online.target

[Service]
WorkingDirectory=/opt/market-trend-monitor
ExecStart=/usr/bin/node /opt/market-trend-monitor/src/server.js
Restart=always
RestartSec=5
Environment=HOME=/opt/market-trend-monitor

[Install]
WantedBy=multi-user.target
```

保存为 `/etc/systemd/system/market-trend-monitor.service` 后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now market-trend-monitor
sudo systemctl status market-trend-monitor
```

## 6. GitHub 开源发布

如果这是新仓库：

```bash
git init
git add .
git commit -m "open source market trend monitor"
gh repo create market-trend-monitor --public --source=. --remote=origin --push
```

如果已经有远程仓库：

```bash
git remote add origin https://github.com/Aisaandroidios/market-trend-monitor.git
git branch -M main
git push -u origin main
```

发布前再次确认没有提交真实密钥：

```bash
git status --short
git grep -n "TELEGRAM_BOT_TOKEN\\|ALPHA_VANTAGE_API_KEY\\|FINNHUB_API_KEY"
```
