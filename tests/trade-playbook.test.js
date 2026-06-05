import assert from "node:assert/strict";
import test from "node:test";

import { buildProfessionalTradePlaybook } from "../src/trade-playbook.js";

test("grades a trade setup using professional execution checks", () => {
  const playbook = buildProfessionalTradePlaybook({
    symbol: "BTCUSDT",
    direction: "LONG",
    price: 100,
    takeProfit: 112,
    stopLoss: 94,
    support: 96,
    resistance: 118,
    indicators: {
      ema20: 101,
      ema60: 96,
      atr: 3,
      volumeRatio: 1.35,
      rsi: 56
    }
  });

  assert.equal(playbook.symbol, "BTCUSDT");
  assert.equal(playbook.direction, "LONG");
  assert.ok(playbook.score >= 0.7);
  assert.equal(playbook.decision, "EXECUTE");
  assert.equal(playbook.grade, "A");
  assert.ok(playbook.checks.every((check) => check.status !== "FAIL"));
  assert.ok(playbook.summary.includes("执行质量"));
});

test("penalizes setups that chase into poor location", () => {
  const playbook = buildProfessionalTradePlaybook({
    symbol: "ETHUSDT",
    direction: "LONG",
    price: 117,
    takeProfit: 121,
    stopLoss: 110,
    support: 94,
    resistance: 118,
    indicators: {
      ema20: 100,
      ema60: 96,
      atr: 2,
      volumeRatio: 0.72,
      rsi: 74
    }
  });

  assert.ok(playbook.score < 0.5);
  assert.equal(playbook.decision, "WAIT_FOR_BETTER_ENTRY");
  assert.ok(playbook.risks.some((risk) => risk.includes("追单")));
  assert.ok(playbook.checks.some((check) => check.name === "位置性价比" && check.status === "FAIL"));
});
