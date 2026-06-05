#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.market-trend-monitor.plist"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3)}"

cd "$ROOT_DIR"

if [[ -z "$NODE_BIN" ]]; then
  echo "node is required. Install Node.js 22+ first."
  exit 1
fi

if [[ ! -f ".env.local" ]]; then
  cp .env.example .env.local
  echo "Created .env.local. Edit it with Telegram/API keys before enabling alerts."
fi

if [[ ! -d ".venv" ]]; then
  "$PYTHON_BIN" -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.market-trend-monitor</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT_DIR/src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/market-trend-monitor.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/market-trend-monitor.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"

echo "Market Trend Monitor is running at http://localhost:8787"
echo "Logs: /tmp/market-trend-monitor.log and /tmp/market-trend-monitor.err.log"
