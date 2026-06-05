#!/usr/bin/env python3
import argparse
import json
import sys


def main():
    parser = argparse.ArgumentParser(description="Optional TradingView/tvDatafeed OHLC adapter")
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--exchange", default="NASDAQ")
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--limit", type=int, default=120)
    args = parser.parse_args()

    try:
        from tvDatafeed import TvDatafeed, Interval
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "error": "tvDatafeed is not installed",
            "detail": str(exc)
        }))
        return 0

    interval_map = {
        "1m": Interval.in_1_minute,
        "5m": Interval.in_5_minute,
        "15m": Interval.in_15_minute,
        "30m": Interval.in_30_minute,
        "1h": Interval.in_1_hour,
        "4h": Interval.in_4_hour,
        "1d": Interval.in_daily,
    }

    try:
        tv = TvDatafeed()
        data = tv.get_hist(
            symbol=args.symbol,
            exchange=args.exchange,
            interval=interval_map.get(args.interval, Interval.in_1_hour),
            n_bars=args.limit,
        )
        if data is None or data.empty:
            print(json.dumps({"ok": False, "error": "no data"}))
            return 0

        candles = []
        for timestamp, row in data.tail(args.limit).iterrows():
            open_time = int(timestamp.timestamp() * 1000)
            candles.append({
                "openTime": open_time,
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row.get("volume", 0) or 0),
                "closeTime": open_time + 3599999,
            })

        print(json.dumps({
            "ok": True,
            "provider": "TradingView tvDatafeed",
            "exchange": args.exchange,
            "symbol": args.symbol,
            "interval": args.interval,
            "candles": candles,
        }))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 0


if __name__ == "__main__":
    sys.exit(main())
