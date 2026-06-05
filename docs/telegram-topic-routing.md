# Telegram Topic Routing

Telegram forum topics are addressed by `message_thread_id`, not by the visible topic title.

## Required environment variables

```bash
export TELEGRAM_BOT_TOKEN="your-bot-token"
export TELEGRAM_CHAT_ID="-100xxxxxxxxxx"
export TELEGRAM_TOPIC_MAP='{
  "BTCUSDT": 123,
  "ETHUSDT": 456,
  "QQQUSDT": 789,
  "NVDAUSDT": 790,
  "MUUSDT": 791
}'
```

## How to collect IDs

1. Add the bot to the Telegram group.
2. Make sure the bot can read messages or send `/id` in each topic.
3. Send one message inside each topic you want to route.
4. Run:

```bash
TELEGRAM_BOT_TOKEN="your-bot-token" node scripts/telegram-topics.js
```

The output includes:

- `chat_id`: the group ID to use as `TELEGRAM_CHAT_ID`
- `message_thread_id`: the Topic ID
- `text` or `topic_created`: the clue for which topic it is

## How routing works

The app normalizes symbols:

- `BTC USDT` -> `BTCUSDT`
- `ETH USDT` -> `ETHUSDT`
- `QQQ` -> `QQQUSDT`
- `APPLE` -> `AAPLUSDT`

When a signal is sent for a symbol, the matching topic ID is passed to Telegram as `message_thread_id`.
