import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldSendTopicStatusHeartbeat,
  tickerForTopicStatus,
  topicStatusCandidateSymbols,
  topicStatusStateKey
} from "../src/topic-status.js";

test("topic status candidates include metadata stocks with neutral or missing strategy only", () => {
  const candidates = topicStatusCandidateSymbols({
    topicMap: {
      MCDUSDT: 529,
      IBMUSDT: 523,
      DELLUSDT: 522,
      BTCUSDT: 11
    },
    tradeIdeas: new Map([
      ["IBMUSDT", { symbol: "IBMUSDT", direction: "NEUTRAL", action: "WAIT" }],
      ["DELLUSDT", { symbol: "DELLUSDT", direction: "LONG", action: "BUY" }]
    ])
  });

  assert.deepEqual(candidates, ["MCDUSDT", "IBMUSDT"]);
});

test("ticker lookup matches USDT topic symbols to stock snapshots", () => {
  const ticker = tickerForTopicStatus("MCDUSDT", [
    { symbol: "BTCUSDT", market: "crypto", price: 100 },
    { symbol: "MCD", market: "stocks", provider: "stooq", price: 300 }
  ]);

  assert.deepEqual(ticker, {
    symbol: "MCD",
    market: "stocks",
    provider: "stooq",
    price: 300
  });
});

test("topic status heartbeat sends on first run, state change, or cooldown", () => {
  const memory = new Map();
  const first = shouldSendTopicStatusHeartbeat({
    symbol: "MCDUSDT",
    stateKey: "NO_STRATEGY:stooq",
    memory,
    nowMs: 1000,
    cooldownMs: 30000
  });
  assert.equal(first, true);

  memory.set("MCDUSDT", { stateKey: "NO_STRATEGY:stooq", sentAt: 1000 });
  const cooledDown = shouldSendTopicStatusHeartbeat({
    symbol: "MCDUSDT",
    stateKey: "NO_STRATEGY:stooq",
    memory,
    nowMs: 2000,
    cooldownMs: 30000
  });
  assert.equal(cooledDown, false);

  const changed = shouldSendTopicStatusHeartbeat({
    symbol: "MCDUSDT",
    stateKey: "NEUTRAL:binance",
    memory,
    nowMs: 2000,
    cooldownMs: 30000
  });
  assert.equal(changed, true);

  const expired = shouldSendTopicStatusHeartbeat({
    symbol: "MCDUSDT",
    stateKey: "NO_STRATEGY:stooq",
    memory,
    nowMs: 32000,
    cooldownMs: 30000
  });
  assert.equal(expired, true);
});

test("topic status state records strategy availability and provider", () => {
  assert.equal(
    topicStatusStateKey({
      idea: {
        direction: "NEUTRAL",
        action: "WAIT",
        dataSource: { provider: "Binance USD-M Futures" }
      }
    }),
    "NEUTRAL:WAIT:Binance USD-M Futures"
  );

  assert.equal(
    topicStatusStateKey({
      ticker: { provider: "stooq" }
    }),
    "NO_STRATEGY:stooq"
  );
});
