param(
  [string]$TaskName = "MarketTrendMonitor",
  [string]$Port = "8787"
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 22+ is required. Install it from https://nodejs.org/ and rerun this script."
}

if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python 3.11+ is required. Install it from https://www.python.org/ and rerun this script."
}

if (-not (Test-Path ".env.local")) {
  Copy-Item ".env.example" ".env.local"
  Write-Host "Created .env.local. Edit it with Telegram/API keys before enabling alerts."
}

$EnvText = Get-Content ".env.local" -Raw
$EnvText = $EnvText -replace "MODEL_BRAIN_PYTHON=\.venv/bin/python", "MODEL_BRAIN_PYTHON=.venv\Scripts\python.exe"
$EnvText = $EnvText -replace "TRADINGVIEW_PYTHON=\.venv/bin/python", "TRADINGVIEW_PYTHON=.venv\Scripts\python.exe"
$EnvText = $EnvText -replace "YAHOO_PYTHON=\.venv/bin/python", "YAHOO_PYTHON=.venv\Scripts\python.exe"
Set-Content ".env.local" $EnvText

if (-not (Test-Path ".venv")) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3 -m venv .venv
  } else {
    python -m venv .venv
  }
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt

$NodePath = (Get-Command node).Source
$ServerPath = Join-Path $RootDir "src\server.js"
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument "`"$ServerPath`"" -WorkingDirectory $RootDir
$Trigger = New-ScheduledTaskTrigger -AtLogOn
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Market Trend Monitor" | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Market Trend Monitor is running at http://localhost:$Port"
Write-Host "Edit .env.local for Telegram/API keys, then restart the task:"
Write-Host "Stop-ScheduledTask -TaskName $TaskName; Start-ScheduledTask -TaskName $TaskName"
