# Market Trend Monitor Requirements And Rollout

## What You Asked For

You want a market trend monitoring system that can run locally or on a server, watch mainstream crypto, active US stock market trends, gold, oil, and send signals to Telegram or Lark.

The system should not start as a complicated trading platform. The first useful version should connect to live data, show prices, detect obvious trend moves, and send alerts. It should be built so better data providers and more advanced signals can be added later.

## Practical First Version

First version data sources:

- Crypto: Binance Spot public WebSocket, no API key, real-time all-market mini ticker.
- US active stocks: Stooq delayed public quote polling for a fixed watchlist.
- Gold: `XAUUSD` spot quote from Stooq plus `GLD.US` ETF proxy.
- Oil: `CL.F` crude oil futures quote from Stooq plus `USO.US` ETF proxy.

First version watchlists:

- Crypto: Binance USDT pairs, sorted by quote volume.
- US stocks: `SPY`, `QQQ`, `NVDA`, `TSLA`, `AAPL`, `AMD`, `META`, `MSFT`, `GOOGL`, `AMZN`.
- Commodities: `XAUUSD`, `GLD.US`, `CL.F`, `USO.US`, `XAGUSD`.

First version signals:

- Strong gainer: 24h or session change is at least 5%.
- Strong loser: 24h or session change is at most -5%.
- Near high: price is within 0.5% of the current high and change is positive.
- Near low: price is within 0.5% of the current low and change is negative.

First version notifications:

- Telegram Bot API sender.
- Lark/Feishu custom bot webhook sender.
- Alert cooldown to avoid repeated messages for the same symbol and signal.

## Architecture

The backend has four layers:

1. Provider layer:
   - Binance WebSocket connector for crypto.
   - Stooq polling connector for stocks, gold, and oil.

2. Store layer:
   - Keeps the latest normalized market snapshots in memory.
   - Groups symbols by market: crypto, stocks, commodities.

3. Signal layer:
   - Evaluates latest tickers.
   - Deduplicates alerts by symbol, signal type, and cooldown window.

4. Delivery layer:
   - Browser dashboard through HTTP and Server-Sent Events.
   - Telegram and Lark senders.

## Deployment

Local:

```bash
npm start
```

Server:

```bash
PORT=8787 npm start
```

Recommended server setup later:

- Run behind Nginx or Caddy with HTTPS.
- Use `systemd` or Docker Compose for restart.
- Store API tokens in environment variables.

## Upgrade Path

When the first version is stable:

- Replace Stooq with Alpaca or Polygon for proper US market data.
- Add TimescaleDB/PostgreSQL for historical candles and signal history.
- Add strategy configuration in the UI.
- Add TradingView-style webhook input.
- Add backtesting and alert performance stats.
