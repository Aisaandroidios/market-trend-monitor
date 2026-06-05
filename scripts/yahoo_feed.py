#!/usr/bin/env python3
import argparse
import json
import math
import sys


def topic_to_yahoo(symbol):
    value = str(symbol or "").upper().replace("-", "").replace("_", "")
    if value.endswith("USDT"):
        value = value[:-4]
    if value.endswith("USDC"):
        value = value[:-4]

    aliases = {
        "APPLE": "AAPL",
        "GOOG": "GOOGL",
        "XAUUSD": "GC=F",
        "XAU": "GC=F",
        "GOLD": "GC=F",
        "PAXG": "GC=F",
        "XAGUSD": "SI=F",
        "XAG": "SI=F",
        "SILVER": "SI=F",
        "CL": "CL=F",
        "CLF": "CL=F",
        "WTIOIL": "CL=F",
        "OIL": "CL=F",
        "BZ": "BZ=F",
        "BRENTOIL": "BZ=F",
        "SP500": "^GSPC",
        "SPY": "SPY",
        "XYZ100": "^NDX",
        "NASDAQ100": "^NDX",
        "QQQ": "QQQ",
    }
    return aliases.get(value, value)


def finite_number(value, fallback=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if math.isnan(number) or math.isinf(number):
        return fallback
    return number


def flatten_columns(frame):
    if hasattr(frame.columns, "nlevels") and frame.columns.nlevels > 1:
        frame.columns = [col[0] for col in frame.columns]
    return frame


def period_for_interval(interval, limit):
    if interval in ("1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h"):
        return "60d"
    if interval in ("1d", "5d"):
        return "2y" if limit <= 500 else "5y"
    return "1y"


def yahoo_interval(interval):
    if interval == "1h":
        return "60m"
    return interval


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--limit", type=int, default=120)
    args = parser.parse_args()

    try:
        import yfinance as yf
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"missing_yfinance:{exc}"}))
        return 1

    yahoo_symbol = topic_to_yahoo(args.symbol)
    interval = yahoo_interval(args.interval)
    period = period_for_interval(interval, args.limit)

    try:
        data = yf.download(
            yahoo_symbol,
            period=period,
            interval=interval,
            progress=False,
            auto_adjust=False,
            threads=False,
        )
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"yahoo_download_failed:{exc}", "symbol": yahoo_symbol}))
        return 1

    if data is None or data.empty:
        print(json.dumps({"ok": False, "error": "yahoo_no_data", "symbol": yahoo_symbol}))
        return 0

    data = flatten_columns(data).tail(args.limit)
    candles = []
    for index, row in data.iterrows():
        close = finite_number(row.get("Close"))
        if close <= 0:
            continue
        candles.append({
            "open": finite_number(row.get("Open"), close),
            "high": finite_number(row.get("High"), close),
            "low": finite_number(row.get("Low"), close),
            "close": close,
            "volume": finite_number(row.get("Volume"), 0.0),
            "eventTime": int(index.timestamp() * 1000),
        })

    print(json.dumps({
        "ok": bool(candles),
        "provider": "Yahoo Finance",
        "exchange": "Yahoo",
        "reference": "chart",
        "symbol": yahoo_symbol,
        "interval": args.interval,
        "candles": candles,
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
