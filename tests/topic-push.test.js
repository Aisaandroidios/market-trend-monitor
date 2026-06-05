import assert from "node:assert/strict";
import test from "node:test";

import { completeTopicPushPlan } from "../src/topic-push.js";

test("plans complete topic pushes for actionable, neutral, and missing strategy topics", () => {
  const plan = completeTopicPushPlan({
    topicMap: {
      BTCUSDT: 11,
      IBMUSDT: 22,
      MCDUSDT: 33
    },
    tradeIdeas: new Map([
      ["BTCUSDT", { symbol: "BTCUSDT", direction: "SHORT", action: "SELL" }],
      ["IBMUSDT", { symbol: "IBMUSDT", direction: "NEUTRAL", action: "WAIT" }]
    ]),
    tickers: [
      { symbol: "MCD", market: "stocks", provider: "finnhub", price: 273.29 }
    ]
  });

  assert.deepEqual(plan.map((item) => [item.symbol, item.kind]), [
    ["BTCUSDT", "trade_idea"],
    ["IBMUSDT", "topic_status"],
    ["MCDUSDT", "topic_status"]
  ]);
  assert.equal(plan[0].idea.direction, "SHORT");
  assert.equal(plan[2].ticker.price, 273.29);
});

test("complete topic push plan skips symbols already sent by change notifications", () => {
  const plan = completeTopicPushPlan({
    topicMap: {
      BTCUSDT: 11,
      ETHUSDT: 22
    },
    tradeIdeas: new Map([
      ["BTCUSDT", { symbol: "BTCUSDT", direction: "LONG", action: "BUY" }],
      ["ETHUSDT", { symbol: "ETHUSDT", direction: "SHORT", action: "SELL" }]
    ]),
    skipSymbols: new Set(["BTCUSDT"])
  });

  assert.deepEqual(plan.map((item) => item.symbol), ["ETHUSDT"]);
});
